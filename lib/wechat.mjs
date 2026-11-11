// 读取微信本地聊天记录（复用 wechat-decrypt 技能的 venv 与 query.py）
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const HOME = os.homedir();
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

// 技能目录优先级：环境变量 > 安装包自带的 vendor/wechat-decrypt > ~/.dsh 技能目录。
// Windows 安装包会把解密技能一起带上，不依赖目标机器已有的 ~/.dsh。
// 注意：vendor 里只有脚本、没有 .venv 时不能选它，否则会误判成「读取环境不存在」，
// 所以要求「脚本 + 解释器」同时存在才算可用。
const VENDOR_SKILL = path.join(ROOT, 'vendor', 'wechat-decrypt');

function pythonOf(dir) {
  return IS_WIN
    ? path.join(dir, '.venv', 'Scripts', 'python.exe')
    : path.join(dir, '.venv', 'bin', 'python');
}

function skillUsable(dir) {
  return fs.existsSync(pythonOf(dir)) && fs.existsSync(path.join(dir, 'scripts', 'common', 'query.py'));
}

export const SKILL_DIR =
  process.env.WECHAT_DECRYPT_DIR ||
  (skillUsable(VENDOR_SKILL) ? VENDOR_SKILL : path.join(HOME, '.dsh', 'skills', 'wechat-decrypt'));
const PYTHON = pythonOf(SKILL_DIR);
const QUERY = path.join(SKILL_DIR, 'scripts', 'common', 'query.py');

export function wechatReady() {
  return fs.existsSync(PYTHON) && fs.existsSync(QUERY);
}

// macOS：固定走 arm64 的 sqlcipher（见 tools/sqlcipher-arm64.sh），并清掉宿主注入的 PYTHONPATH。
// Windows：config.py 走 sqlite3 后端，直接读 decrypt_all.py 解密出来的明文库，不需要 sqlcipher。
const SQLCIPHER = path.join(ROOT, 'tools', 'sqlcipher-arm64.sh');

export function queryEnv() {
  const env = { ...process.env };
  delete env.PYTHONPATH;
  // Windows 下 Python 用管道输出时按系统 ANSI 代码页（简体中文为 GBK）编码，
  // 群名里只要有一个 emoji 就会 UnicodeEncodeError 崩掉。强制 UTF-8。
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  if (!IS_WIN && fs.existsSync(SQLCIPHER)) env.WECHAT_SQLCIPHER_PATH = SQLCIPHER;
  return env;
}

export async function runQuery(args) {
  if (!wechatReady()) {
    throw new Error('未找到微信读取环境（~/.dsh/skills/wechat-decrypt/.venv）');
  }
  const { stdout } = await execFileP(PYTHON, [QUERY, ...args], {
    env: queryEnv(),
    cwd: SKILL_DIR,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return JSON.parse(stdout);
}

/** 列出真实会话（按最近活跃倒序）[{wxid, display, isGroup, isFriend, kind, ts}] */
export async function listChats() {
  // 首选 session.db：只包含聊天列表里真实存在的会话，
  // 不会把群成员（只发过言的 wxid）混进联系人里。
  const sessions = await runQuery(['sessions', '--json']).catch(() => null);
  if (Array.isArray(sessions) && sessions.length) {
    return sessions.map((c) => {
      const isGroup = Boolean(c.isGroup);
      return {
        wxid: c.wxid,
        display: c.display,
        isGroup,
        isFriend: Boolean(c.isFriend),
        kind: c.kind || (isGroup ? 'group' : 'other'),
        ts: Number(c.ts) || 0,
      };
    });
  }

  // 回退：没有 session.db 时用旧路径，此时无法区分好友与群成员，
  // 非群会话一律标记为 other，由界面过滤，避免把群友当联系人。
  const data = await runQuery(['list', '--json', '-n', '2000']);
  return (data.chats || []).map((c) => {
    const isGroup = String(c.wxid).endsWith('@chatroom');
    return {
      wxid: c.wxid,
      display: c.display,
      isGroup,
      isFriend: false,
      kind: isGroup ? 'group' : 'other',
      ts: 0,
    };
  });
}

/**
 * 读取某个群/联系人的消息
 * @param {string} contact wxid 或群名
 */
export async function readChat(contact, { days = 1, limit = 400 } = {}) {
  const data = await runQuery(['read', contact, '-d', String(days), '-n', String(limit), '--json']);
  if (data.error) throw new Error(data.error);
  const chat = (data.chats || [])[0];
  if (!chat) return { display: contact, messages: [] };
  return { display: chat.display, messages: chat.messages || [] };
}

// 无信息量的短消息/寒暄，直接丢掉
const NOISE_RE = /^(收到|好的?|谢谢|感谢|辛苦了|哈哈哈+|嗯+|哦+|ok|OK|在吗|有人吗|[\d\s.,，。!！?？~～]*)$/;
const MEDIA_RE = /^\[(图片|表情|语音|视频|动画表情|链接|文件)\]\s*$/;

/** 判断一条消息是否值得送给模型 */
export function isInformative(text) {
  const t = text.trim();
  if (t.length < 10) return false;
  if (NOISE_RE.test(t)) return false;
  if (MEDIA_RE.test(t)) return false;
  if (/^(@\S+\s*)+$/.test(t)) return false;           // 纯 @人
  if (/^(\d+[.、)）]?\s*)+$/.test(t)) return false;     // 纯接龙序号
  // 引用消息：去掉标记后仍有实质内容就保留
  if (/^\S{1,12}分享了/.test(t)) return false;            // "某某 分享了活动"
  if (/\S{1,12}\s*分享了/.test(t)) return false;         // 任意位置的分享卡片
  if (/^\[链接分享\]/.test(t)) return false;
  if (/\.(pptx?|docx?|pdf|xlsx?|zip|rar)\s*$/i.test(t)) return false;   // 纯文件名
  if (/^(今天|明天|后天|昨天).{0,10}(ppt|课件|文件|材料|资料)/i.test(t)) return false;
  // @所有人 开头的寒暄/收作业通知，不算事项
  if (/^@所有人/.test(t)) {
    const rest = t.replace(/^@所有人\s*/, '');
    if (rest.length < 25) return false;
    if (/^(同学们?好|大家好|注意|温馨提示|我已收到|已经收到)/.test(rest)) return false;
  }
  if (/分享了一(个|条)/.test(t) && t.length < 40) return false;
  // 第一人称对话：没有日期和报名类关键词，基本是聊天
  if (/^(我们|你|我|他|她|那|这|对|嗯|就是|可以|行|好)/.test(t) &&
      !/\d{1,2}[月日号]|周[一二三四五六日]|截止|报名|提交|截止|面试|集合|缴费/.test(t)) {
    return false;
  }
  return true;
}

/**
 * 把消息压成给模型看的文本：过滤噪声 + 去重 + 截断
 * @returns {{text: string, kept: number, dropped: number}}
 */
/** 去掉消息开头的通知抬头，避免模型直接照抄成标题 */
export function stripHeader(t) {
  return String(t)
    .replace(/^\[引用消息\]\s*/g, '')
    .replace(/^@所有人\s*/g, '')
    .replace(/^[【\[]\s*[^】\]]{0,40}[】\]]\s*/g, '')
    .replace(/^(各位同学|同学们|大家好|通知|提醒)[：:,，\s]+/g, '')
    .replace(/^关于[^，。]{0,40}(的)?通知[：:,，\s]*/g, '')
    .trim();
}

export function messagesToText(chats, { maxCharsPerGroup = 14000 } = {}) {
  let out = '';
  let kept = 0;
  let dropped = 0;
  for (const { name, messages } of chats) {
    if (!messages.length) continue;
    const seen = new Set();
    let block = `\n\n===== 群：${name} =====\n`;
    for (const m of messages) {
      if (m.is_system || !m.content) { dropped++; continue; }
      const t = String(m.content).replace(/\s+/g, ' ').trim();
      if (!isInformative(t)) { dropped++; continue; }
      const key = t.slice(0, 40);
      if (seen.has(key)) { dropped++; continue; }   // 同一段话刷屏
      seen.add(key);
      block += `[${m.time}] ${stripHeader(t).slice(0, 500)}\n`;
      kept++;
      if (block.length > maxCharsPerGroup) break;
    }
    out += block;
  }
  return { text: out, kept, dropped };
}
/** 找某个群最近缓存的图片（缩略图），返回 [{ts, file, size}] */
export async function findImages(wxid, sinceSec, limit = 3) {
  if (!wechatReady()) return [];
  const script = path.join(ROOT, 'tools/find_images.py');
  const { stdout } = await execFileP(PYTHON, [script, wxid, String(sinceSec), String(limit)], {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    return [];
  }
}
