// 轻松打卡连接服务：手机端使用的局域网接口。
// - 独立端口（默认 7790），只暴露 /bridge/v1/* 日程读写，不暴露设置、API Key、群列表和聊天内容
// - 默认关闭；在 http://127.0.0.1:7788/bridge.html 手动开启，或用 QS_BRIDGE=1 启动
// - 每个请求都要带 Authorization: Bearer <配对码>
// 协议说明见 iBetter 仓库 docs/QINGSONG_INTEGRATION.md
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store, cryptoId } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BRIDGE_PORT = Number(process.env.QS_BRIDGE_PORT) || 7790;
export const PROTOCOL = 1;

const CATEGORIES = ['作业', '兼职', '比赛', '活动', '志愿', '通知', '其他'];
const TOKEN_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 0/O、1/I/L，方便手机上手输
const MAX_ITEMS = 50;

const runtime = {
  server: null,
  listening: false,
  lastError: null,
  lastClientAt: null,
  lastClientIp: null,
  failures: new Map(), // ip -> { count, since }
};

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

function newToken() {
  const bytes = crypto.randomBytes(8);
  return [...bytes].map((b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length]).join('');
}

export function ensureToken() {
  store.reloadSettings();
  if (!store.settings.bridgeToken) {
    store.settings.bridgeToken = newToken();
    store.saveSettings();
  }
  return store.settings.bridgeToken;
}

export function resetToken() {
  store.reloadSettings();
  store.settings.bridgeToken = newToken();
  store.saveSettings();
  return store.settings.bridgeToken;
}

/** 本机局域网 IPv4 地址（手机填这个） */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  // 常见家用/校园网段排前面
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((x, y) => rank(x.address) - rank(y.address));
}

export function bridgeInfo() {
  store.reloadSettings();
  return {
    enabled: Boolean(store.settings.bridgeEnabled),
    listening: runtime.listening,
    port: BRIDGE_PORT,
    token: ensureToken(),
    addresses: lanAddresses(),
    lastError: runtime.lastError,
    lastClientAt: runtime.lastClientAt,
    lastClientIp: runtime.lastClientIp,
    protocol: PROTOCOL,
  };
}

// ── 数据转换 ──────────────────────────────────────────────

/** 对外只给日程需要的字段，不带原文 raw / runId */
export function publicNotice(n) {
  return {
    id: n.id,
    title: n.title || '',
    summary: n.summary || '',
    detail: n.detail || '',
    category: n.category || '其他',
    deadline: n.deadline || null,
    status: n.status || 'new',
    group: n.group || '',
    action: n.action || null,
    externalId: n.externalId || null,
    createdAt: n.createdAt || null,
    updatedAt: n.updatedAt || n.createdAt || null,
  };
}

/** 校验并转换一条上行日程；不合法返回字符串错误 */
export function normalizeIncoming(it) {
  if (!it || typeof it !== 'object') return '条目格式不对';
  const clientId = String(it.clientId || '').trim();
  if (!clientId || clientId.length > 64) return '缺少 clientId';
  const title = String(it.title || '').trim().slice(0, 60);
  if (!title) return '标题不能为空';
  const date = String(it.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '日期格式应为 YYYY-MM-DD';
  const parsedDate = new Date(date + 'T00:00:00Z');
  if (Number.isNaN(parsedDate.valueOf()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return '请选择有效日期';
  }
  const time = it.time == null || it.time === '' ? null : String(it.time).trim();
  if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return '时间格式应为 HH:mm';
  const note = String(it.note || '').trim().slice(0, 500);
  const category = CATEGORIES.includes(it.category) ? it.category : '其他';
  return {
    clientId,
    title,
    note,
    category,
    deadline: time ? `${date} ${time}` : date,
  };
}

/** 把新建的日程写成待办卡片；按 externalId 幂等 */
export function createAgendaNotices(items, { group = '轻松打卡', runId = 'ibetter' } = {}) {
  store.reloadNotices();
  const results = [];
  const errors = [];
  let added = 0;
  for (const raw of items) {
    const it = normalizeIncoming(raw);
    if (typeof it === 'string') {
      errors.push({ clientId: raw?.clientId ?? null, error: it });
      continue;
    }
    const hit = store.notices.find((n) => n.externalId === it.clientId);
    if (hit) {
      results.push({ clientId: it.clientId, id: hit.id, existed: true });
      continue;
    }
    const now = Date.now();
    const notice = {
      id: cryptoId(),
      status: 'todo',
      createdAt: now,
      updatedAt: now,
      category: it.category,
      title: it.title,
      summary: it.note.slice(0, 40),
      detail: it.note,
      deadline: it.deadline,
      group,
      action: null,
      runId,
      sourceTime: null,
      raw: '',
      externalId: it.clientId,
    };
    store.notices.unshift(notice);
    results.push({ clientId: it.clientId, id: notice.id, existed: false });
    added++;
  }
  if (added) store.saveNotices();
  return { results, errors, added };
}

/** 与 server.mjs /api/notice 相同的状态切换规则 */
export function applyStatus(id, status) {
  store.reloadNotices();
  const n = store.findNotice(id);
  if (!n) return null;
  const prev = n.status;
  n.status = status;
  if (status === 'done' || status === 'skip') {
    n.archivedAt = n.archivedAt || Date.now();
    n.prevStatus = prev === 'done' || prev === 'skip' ? (n.prevStatus || 'new') : prev;
  } else {
    delete n.archivedAt;
    delete n.prevStatus;
  }
  n.updatedAt = Date.now();
  store.saveNotices();
  return n;
}

// ── HTTP ──────────────────────────────────────────────────

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('请求太大'), { status: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 });
  }
}

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && b.length > 0 && crypto.timingSafeEqual(a, b);
}

/** 同一 IP 10 分钟内配对码错 10 次就先拒绝，防止局域网里被暴力猜 */
function tooManyFailures(ip) {
  const f = runtime.failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 10 * 60_000) {
    runtime.failures.delete(ip);
    return false;
  }
  return f.count >= 10;
}

function recordFailure(ip) {
  const f = runtime.failures.get(ip);
  if (!f || Date.now() - f.since > 10 * 60_000) runtime.failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

export async function handleBridge(req, res) {
  const url = new URL(req.url, 'http://bridge');
  const p = url.pathname.replace(/\/+$/, '');
  const ip = req.socket.remoteAddress || '';

  if (!p.startsWith('/bridge/v1')) return send(res, 404, { ok: false, error: 'not found' });
  if (tooManyFailures(ip)) return send(res, 429, { ok: false, error: '配对码错误次数太多，请 10 分钟后再试' });

  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim().toUpperCase() : '';
  if (!tokenMatches(token, ensureToken())) {
    recordFailure(ip);
    return send(res, 401, { ok: false, error: '配对码不对' });
  }
  runtime.failures.delete(ip);
  runtime.lastClientAt = Date.now();
  runtime.lastClientIp = ip;

  try {
    if (p === '/bridge/v1/ping' && req.method === 'GET') {
      return send(res, 200, { ok: true, app: 'qingsong-rili', version: readVersion(), protocol: PROTOCOL, serverTime: Date.now() });
    }

    if (p === '/bridge/v1/notices' && req.method === 'GET') {
      store.reloadNotices();
      return send(res, 200, { ok: true, serverTime: Date.now(), notices: store.notices.map(publicNotice) });
    }

    if (p === '/bridge/v1/notices' && req.method === 'POST') {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return send(res, 400, { ok: false, error: 'items 不能为空' });
      if (items.length > MAX_ITEMS) return send(res, 400, { ok: false, error: `一次最多 ${MAX_ITEMS} 条` });
      const { results, errors, added } = createAgendaNotices(items);
      if (added) console.log(`[轻松打卡] 新增 ${added} 条待办`);
      return send(res, 200, { ok: true, items: results, errors, added });
    }

    if (p === '/bridge/v1/notices/status' && req.method === 'POST') {
      const body = await readBody(req);
      if (!['todo', 'done'].includes(body.status)) return send(res, 400, { ok: false, error: 'status 只能是 todo 或 done' });
      const n = applyStatus(String(body.id || ''), body.status);
      if (!n) return send(res, 404, { ok: false, error: '找不到这条通知' });
      return send(res, 200, { ok: true, notice: publicNotice(n) });
    }

    return send(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    return send(res, e.status || 500, { ok: false, error: e.message });
  }
}

// ── 启停 ──────────────────────────────────────────────────

function startServer() {
  if (runtime.server) return Promise.resolve(runtime.listening);
  ensureToken();
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      handleBridge(req, res).catch((e) => send(res, 500, { ok: false, error: e.message }));
    });
    server.once('error', (err) => {
      runtime.lastError = err.code === 'EADDRINUSE' ? `端口 ${BRIDGE_PORT} 被占用` : err.message;
      runtime.server = null;
      runtime.listening = false;
      console.error('[轻松打卡连接] 启动失败:', runtime.lastError);
      resolve(false);
    });
    server.listen(BRIDGE_PORT, '0.0.0.0', () => {
      runtime.server = server;
      runtime.listening = true;
      runtime.lastError = null;
      const ips = lanAddresses().map((a) => `${a.address}:${BRIDGE_PORT}`).join('  ') || `本机:${BRIDGE_PORT}`;
      console.log(`  轻松打卡连接已开启 → ${ips}  配对码 ${ensureToken()}\n`);
      resolve(true);
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!runtime.server) return resolve();
    runtime.server.close(() => resolve());
    runtime.server.closeAllConnections?.();
    runtime.server = null;
    runtime.listening = false;
  });
}

export async function setBridgeEnabled(on) {
  store.reloadSettings();
  store.settings.bridgeEnabled = Boolean(on);
  store.saveSettings();
  if (on) await startServer();
  else await stopServer();
  return bridgeInfo();
}

/** 服务启动时调用：设置里开着，或 QS_BRIDGE=1，就开始监听 */
export async function initBridge() {
  store.reloadSettings();
  if (process.env.QS_BRIDGE === '1' && !store.settings.bridgeEnabled) {
    store.settings.bridgeEnabled = true;
    store.saveSettings();
  }
  if (store.settings.bridgeEnabled) await startServer();
}
