// 整理引擎的统一入口：按环境自动选择后端，代码里没有本地规则兜底。
//   workbuddy —— WorkBuddy 自带命令行（macOS 默认；Windows 装了 WorkBuddy 也能用）
//   deepseek  —— DeepSeek OpenAI 兼容接口（Windows 没有 WorkBuddy 时用，需在设置里填 Key）
//   queue     —— 只写整理请求，由外部 AI（如 DeepSeek Harness）用 wb-bridge.mjs 接手
//   none      —— 什么都没配，点整理会明确报错，不会静默生成卡片
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { organizeByOpenAI, checkOpenAI, openaiKey } from './model-openai.mjs';

const IS_WIN = process.platform === 'win32';
const TIMEOUT_MS = 240_000;
const CATEGORIES = ['作业', '兼职', '比赛', '活动', '志愿', '通知', '其他'];

const ITEM_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          title: { type: 'string' },
          summary: { type: 'string' },
          detail: { type: 'string' },
          deadline: { type: ['string', 'null'] },
          group: { type: 'string' },
          action: { type: ['string', 'null'] },
          sourceTime: { type: ['string', 'null'] },
        },
        required: ['category', 'title', 'summary', 'detail', 'deadline', 'group'],
      },
    },
  },
  required: ['items'],
});

const CLI_CANDIDATES = [
  process.env.WORKBUDDY_CLI,
  // 独立安装的完整版（带登录与 TUI），优先使用
  path.join(process.env.HOME || '', '.local/bin/codebuddy'),
  // WorkBuddy 自带的精简版（无 TUI，仅作兜底）
  '/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Programs', 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Programs', 'WorkBuddy AI', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
  process.env.ProgramFiles &&
    path.join(process.env.ProgramFiles, 'WorkBuddy', 'resources', 'app.asar.unpacked', 'cli', 'bin', 'codebuddy.cmd'),
].filter(Boolean);

function findOnPath(name) {
  for (const dir of String(process.env.PATH || '').split(IS_WIN ? ';' : ':')) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

/** 返回 WorkBuddy 命令行路径，找不到返回 null */
export function workbuddyCli() {
  for (const p of CLI_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return findOnPath(IS_WIN ? 'codebuddy.cmd' : 'codebuddy') || findOnPath('codebuddy');
}

export function cliExists() {
  return Boolean(workbuddyCli());
}

export function modelName(settings = {}) {
  // 不写死模型名：留空就用命令行自己的默认模型，避免指定了一个不存在的模型
  return String(settings.model || '').trim();
}

/** 决定这次整理走哪条通道（deepseek 是旧值，统一按 openai 处理） */
export function pickBackend(settings = {}) {
  const forced = String(settings.organizeBackend || 'auto').toLowerCase();
  if (forced === 'deepseek') return 'openai';
  if (['workbuddy', 'openai', 'queue', 'none'].includes(forced)) return forced;
  if (workbuddyCli()) return 'workbuddy';
  if (openaiKey(settings)) return 'openai';
  return 'none';
}

export function backendStatus(settings = {}) {
  return {
    backend: pickBackend(settings),
    workbuddyCli: workbuddyCli() || null,
    apiConfigured: Boolean(openaiKey(settings)),
    deepseekConfigured: Boolean(openaiKey(settings)), // 兼容旧前端字段
    platform: process.platform,
  };
}

/** 从模型输出里稳妥地取出条目数组（容忍 markdown 围栏、前后解释文字） */
export function parseItems(out) {
  const t = String(out || '').replace(/```(?:json)?/gi, '').trim();
  const starts = [];
  for (let i = 0; i < t.length; i++) if (t[i] === '[' || t[i] === '{') starts.push(i);
  for (const i of starts) {
    for (let j = t.length - 1; j > i; j--) {
      if (t[j] !== ']' && t[j] !== '}') continue;
      try {
        const v = JSON.parse(t.slice(i, j + 1));
        const arr = Array.isArray(v) ? v : (v && Array.isArray(v.items) ? v.items : null);
        if (arr) return arr;
      } catch {}
    }
  }
  throw new Error('模型没有返回可解析的整理结果');
}

/**
 * 命令行要在一个干净的环境里启动：
 *  - NODE_OPTIONS 带着 WorkBuddy 的语言 shim，会让 CLI 启动即崩（setProxy instanceof 报错）
 *  - SERVER__PORT 被宿主占成 61156，CLI 会因端口冲突直接退出
 *  - 代理变量会让它去连本机代理而不是直连
 * 这几项必须清掉，否则「没登录」和「启动失败」会混在一起看不出来。
 */
function cliEnv() {
  const env = { ...process.env };
  for (const k of [
    'NODE_OPTIONS', 'SERVER__PORT',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
    'http_proxy', 'https_proxy', 'all_proxy',
    'NO_PROXY', 'no_proxy',
  ]) delete env[k];
  return env;
}

function runCli(cli, args, input, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { stdio: ['pipe', 'pipe', 'pipe'], env: cliEnv() });
    let stdout = '';
    let stderr = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('WorkBuddy 模型响应超时'));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); if (!done) { done = true; reject(e); } });
    child.on('close', () => {
      clearTimeout(timer);
      if (done) return;
      done = true;
      const all = `${stdout}\n${stderr}`;
      if (/Authentication required|Please use \/login|401\b/i.test(all)) {
        reject(new Error('WorkBuddy 命令行还没登录：双击项目里的 workbuddy-login.command，输入 /login 完成一次性授权即可'));
      } else if (!stdout.trim()) {
        reject(new Error(`WorkBuddy 模型没有返回内容：${stderr.trim().slice(0, 160) || '无输出'}`));
      } else {
        resolve(stdout);
      }
    });
    child.stdin.end(input);
  });
}

function buildPrompt({ chatText, hours, existingTitles, dismissed, termStart, now, todo }) {
  const skip = [...new Set([...(existingTitles || []), ...(dismissed || [])].map(String))].slice(0, 200);
  return [
    '你在替本机应用「轻松日程」整理微信消息。请只输出一个 JSON 对象，形如 {"items":[...]}，不要输出解释、不要输出 markdown 代码块。',
    '',
    hours
      ? `现在是 ${now.toLocaleString('zh-CN')}，下面内容覆盖最近 ${hours} 小时。`
      : `现在是 ${now.toLocaleString('zh-CN')}，下面是用户手动粘贴的一段内容。`,
    `本学期第一周周一是 ${termStart || '2026-09-14'}，出现「第 N 周」要换算成具体日期。`,
    '',
    '整理规则：',
    '1. category 只能取 作业 / 兼职 / 比赛 / 活动 / 志愿 / 通知 / 其他。',
    '2. title 是 14 字以内的事项名，不能照抄原文（【关于…】、各位同学：、@所有人 这类抬头一律去掉）。',
    '3. summary 一句话说清「要做什么」，40 字以内。',
    '4. detail 100-200 字，写清时间、地点、方式、联系人；原文没写的不要编造。',
    '5. deadline 用 YYYY-MM-DD HH:mm 或 YYYY-MM-DD，判断不出填 null；已经过截止时间的事项直接丢弃。',
    '6. group 填来源群名；同一件事在多个群转发只写一条，用最早出现的群。',
    '7. action 写「我要做什么」；sourceTime 填该消息的原始时间（YYYY-MM-DD HH:mm:ss），没有就 null。',
    '8. 聊天寒暄、问答讨论、接龙、表情包、纯文件名/链接、AI 提示词、密钥串、宿舍报修闲聊一律不要输出。',
    `9. ${todo ? '这是用户手动粘贴的内容，每条都要带 "status":"todo"，卡片直接进「待办」栏；一段里有几件事就拆成几条。' : '不要输出下面「已存在」列表里已有的事项。'}`,
    '10. 没有值得整理的新事项时输出 {"items":[]}。',
    '',
    '已存在 / 已删除过的事项标题（不要重复输出）：',
    skip.length ? skip.map((x) => `- ${x}`).join('\n') : '（暂无）',
    '',
    '聊天内容：',
    String(chatText || '').slice(0, 60000),
  ].join('\n');
}

function normalize(items, todo) {
  return (items || [])
    .filter((x) => x && typeof x === 'object' && String(x.title || '').trim())
    .map((x) => ({
      category: CATEGORIES.includes(x.category) ? x.category : '其他',
      title: String(x.title).trim().slice(0, 14),
      summary: String(x.summary || '').trim().slice(0, 40),
      detail: String(x.detail || '').trim().slice(0, 400),
      deadline: x.deadline === null || x.deadline === undefined ? null : String(x.deadline).trim() || null,
      group: String(x.group || '').trim(),
      action: x.action ? String(x.action).trim().slice(0, 80) : null,
      sourceTime: x.sourceTime ? String(x.sourceTime).trim() : null,
      ...(todo ? { status: 'todo' } : {}),
    }));
}

async function organizeByWorkbuddy(o) {
  const cli = workbuddyCli();
  if (!cli) throw new Error('找不到 WorkBuddy 命令行');
  const model = modelName(o.settings);
  const args = [
    '-p',
    '--output-format', 'text',
    '--json-schema', ITEM_SCHEMA,
    '--tools', '',
    ...(model ? ['--model', model] : []),
    '--max-turns', '1',
    '--no-session-persistence',
    '--port', '0',
  ];
  const raw = await runCli(cli, args, buildPrompt(o));
  return normalize(parseItems(raw), o.todo);
}

/**
 * 调模型整理一段文本，返回规范化后的条目数组。
 * @param {object} o
 * @param {string} o.chatText   已拼好的聊天文本
 * @param {string[]} o.existingTitles 已有卡片标题
 * @param {string[]} o.dismissed      用户删过/归档过的标题
 */
export async function organizeWithModel(o = {}) {
  const backend = pickBackend(o.settings);
  if (backend === 'workbuddy') return organizeByWorkbuddy(o);
  if (backend === 'openai') {
    const raw = await organizeByOpenAI({ prompt: buildPrompt(o), settings: o.settings });
    return normalize(parseItems(raw), o.todo);
  }
  if (backend === 'queue') {
    throw new Error('当前设置为「只写整理请求」：请让外部 AI 用 wb-bridge.mjs 接手，或在设置里改用 WorkBuddy / AI 接口');
  }
  throw new Error('没有可用的整理通道：请安装 WorkBuddy，或在设置里填写 AI 接口的 Base URL、API Key 和模型名');
}

/** 一次性自检：确认当前后端能用 */
export async function checkBackend(settings = {}) {
  const backend = pickBackend(settings);
  if (backend === 'workbuddy') {
    const model = modelName(settings);
    const raw = await runCli(workbuddyCli(), [
      '-p', '--output-format', 'text', '--tools', '',
      ...(model ? ['--model', model] : []),
      '--max-turns', '1', '--no-session-persistence', '--port', '0',
    ], '只回复两个字：好的', 90_000);
    return { backend, text: raw.trim().slice(0, 80) };
  }
  if (backend === 'openai') {
    return { backend, text: await checkOpenAI(settings) };
  }
  throw new Error('还没有配置整理通道');
}
