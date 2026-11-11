#!/usr/bin/env node
// 轻松日程 · MCP 服务器：让 WorkBuddy 等 MCP 客户端直接调用整理能力
// 传输：stdio，每行一个 JSON-RPC 消息
import { store } from './lib/store.mjs';
import { readChat, messagesToText, wechatReady } from './lib/wechat.mjs';

const TOOLS = [
  {
    name: 'get_pending_messages',
    description:
      '读取「轻松日程」里配置的微信群，返回最近一段时间合并后的聊天文本。拿到文本后用你自己的能力整理成通知条目，再调用 submit_notices 写回。',
    inputSchema: {
      type: 'object',
      properties: {
        hours: { type: 'number', description: '往回看多少小时，默认用应用里保存的设置（24）' },
      },
    },
  },
  {
    name: 'submit_notices',
    description:
      '把整理好的通知条目写回「轻松日程」。只做追加与去重合并，不会删除用户已有通知；过滤过期/低质量条目由调用方在整理时完成。',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '通知条目数组',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string', enum: ['作业', '兼职', '比赛', '活动', '志愿', '通知', '其他'] },
              title: { type: 'string', description: '14 字以内的事项名，不能照抄原文' },
              summary: { type: 'string', description: '一句话说清要做什么，40 字以内' },
              detail: { type: 'string', description: '完整信息，100-200 字' },
              deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD HH:mm 或 YYYY-MM-DD，没有就 null' },
              group: { type: 'string' },
              action: { type: ['string', 'null'] },
              status: { type: 'string', enum: ['new', 'todo'], description: '新增时的状态；手动添加待办时填 todo，默认 new' },
            },
            required: ['category', 'title', 'summary', 'detail', 'deadline', 'group'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'list_notices',
    description: '查看「轻松日程」里已有的通知，用来避免重复。',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['all', 'new', 'todo', 'done', 'skip'], description: '默认 all' },
        limit: { type: 'number', description: '最多返回几条，默认 50' },
      },
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

async function getPending(args = {}) {
  if (!wechatReady()) throw new Error('微信读取环境不可用');
  store.reloadSettings();                 // 设置可能被界面或 WorkBuddy 改过，每次重新读
  const s = store.settings;
  const hours = Number(args.hours) || Number(s.lookbackHours) || 24;
  const groups = s.groups || [];
  if (!groups.length) throw new Error('应用里还没有选择要整理的群');
  const sinceMs = Date.now() - hours * 3600 * 1000;
  const days = Math.max(1, Math.ceil(hours / 24));
  const chats = [];
  const failed = [];
  for (const g of groups) {
    try {
      const r = await readChat(g.wxid, { days, limit: 400 });
      const msgs = (r.messages || []).filter(
        (m) => m._ts * 1000 >= sinceMs && !m.is_system && m.content && String(m.content).trim()
      );
      if (!msgs.length) continue;
      chats.push({ name: g.name || r.display || g.wxid, messages: msgs });
    } catch (e) {
      // 不再静默吞掉：读失败的群要明确告诉整理方，避免被误当成「这段时间没通知」
      failed.push(`${g.name || g.wxid}：${e.message}`);
    }
  }
  const packed = messagesToText(chats, { maxCharsPerGroup: 18000 });
  let head = `范围：最近 ${hours} 小时，${chats.length} 个群，${packed.kept} 条消息。\n` +
    `整理要求：category 只能取 作业/兼职/比赛/活动/志愿/通知/其他；title 是 14 字以内的事项名（不能照抄原文）；` +
    `summary 一句话 40 字内；detail 100-200 字；deadline 为 YYYY-MM-DD HH:mm 或 null。` +
    (store.settings.termStart ? `本学期第一周周一是 ${store.settings.termStart}，「第 N 周」要换算成具体日期。` : '') +
    `\n聊天、问候、接龙、表情包、纯文件名、已过截止时间的事项一律不要输出；同一件事在多群转发只写一条，group 填最早出现的群。\n` +
    `整理完调用 submit_notices 写回。\n`;
  if (failed.length) {
    head += `\n⚠️ 以下来源这次读取失败（不要据此判断它们没有通知）：\n${failed.slice(0, 10).join('\n')}\n`;
  }
  return head + packed.text;
}

function submitNotices(args = {}) {
  const items = Array.isArray(args.items) ? args.items : [];
  if (!items.length) throw new Error('items 为空');
  store.reloadNotices();                 // 界面上可能刚改过状态，先对齐磁盘再写
  const { added, updated } = store.upsertNotices(items, { runId: 'mcp-' + Date.now().toString(36) });
  return `已写入：新增 ${added} 条，更新 ${updated} 条。当前共 ${store.notices.length} 条。`;
}

function listNotices(args = {}) {
  const status = args.status || 'all';
  const limit = Math.min(Number(args.limit) || 50, 200);
  store.reloadNotices();
  const list = store.notices
    .filter((n) => status === 'all' || n.status === status)
    .slice(0, limit);
  if (!list.length) return '没有通知。';
  return list
    .map((n) => `- [${n.status}][${n.category}] ${n.title}${n.deadline ? `（截止 ${n.deadline}）` : ''}`)
    .join('\n');
}

async function handle(msg) {
  const { id, method, params } = msg || {};
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'qingsong-rili', version: '1.0.0' } } };
  }
  if (method === 'notifications/initialized' || method === 'initialized') return null;
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    try {
      let text;
      if (name === 'get_pending_messages') text = await getPending(args);
      else if (name === 'submit_notices') text = submitNotices(args);
      else if (name === 'list_notices') text = listNotices(args);
      else throw new Error('未知工具: ' + name);
      return { jsonrpc: '2.0', id, result: textResult(text) };
    } catch (e) {
      return { jsonrpc: '2.0', id, result: { ...textResult('错误：' + e.message), isError: true } };
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } };
}

let buf = '';
let stdinEnded = false;
let inFlight = 0;

function maybeExit() {
  // 一次性管道会在 EOF 时关闭 stdin；但读微信是异步的，必须等所有请求完成再退出
  if (stdinEnded && inFlight === 0) process.exit(0);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    inFlight++;
    Promise.resolve(handle(msg))
      .then((res) => { if (res) send(res); })
      .catch((e) => send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: String(e.message || e) } }))
      .finally(() => { inFlight--; maybeExit(); });
  }
});
process.stdin.on('end', () => { stdinEnded = true; maybeExit(); });
