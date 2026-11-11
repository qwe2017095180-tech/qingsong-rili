// 轻松日程 — 本地服务：点「立即整理」当场跑完，不排队、不等外部会话。
// 整理判断全部交给 WorkBuddy 命令行模型（lib/workbuddy-model.mjs），
// 不读 lib/ai.mjs、不碰 codex / ds / 任何第三方 API，也没有本地规则兜底。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { store, cryptoId, norm, textSim } from './lib/store.mjs';
import { listChats, readChat, messagesToText, wechatReady } from './lib/wechat.mjs';
import { organizeWithModel, backendStatus } from './lib/workbuddy-model.mjs';
import { summarizeFun } from './lib/fun-summary.mjs';
import { pending, recent, complete } from './lib/queue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');

const state = {
  running: false,
  phase: '',
  lastRunAt: store.settings.lastRunAt,
  lastResult: null,
  error: null,
  startedAt: null,
  funRunning: false,
  funPhase: '',
  funError: null,
  funLastResult: null,
};

const PORT_START = 7788;

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
  } catch {
    return { version: '0.0.0', repo: '' };
  }
}

/** 比较 x.y.z；a 比 b 新返回 1，旧返回 -1，相同返回 0 */
function compareVersion(a, b) {
  const pa = String(a).split('.').map((x) => Number(x) || 0);
  const pb = String(b).split('.').map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 跨平台打开浏览器：macOS 用 open，Windows 用 start，Linux 用 xdg-open */
function openUrl(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

function finishRun(run) {
  run.at = Date.now();
  store.reloadRuns();
  store.runs.unshift(run);
  store.saveRuns();
  store.settings.lastRunAt = run.at;
  store.settings.lastRunDate = dayKey(new Date(run.at));
  store.saveSettings();
  state.lastRunAt = run.at;
  state.lastResult = run;
  state.running = false;
  state.phase = '';
  if (run.error) state.error = run.error;
}

/** 并发读多个来源的消息（SQLCipher 只读，互不干扰） */
async function readGroupChats(groups, hours, onProgress) {
  const days = Math.max(1, Math.ceil(hours / 24));
  const sinceMs = Date.now() - hours * 3600 * 1000;
  const limit = Number(store.settings.limitPerGroup) || 400;
  const results = new Array(groups.length);
  const queue = groups.map((g, i) => ({ g, i }));
  let done = 0;
  async function worker() {
    while (queue.length) {
      const { g, i } = queue.shift();
      try {
        const r = await readChat(g.wxid, { days, limit });
        const msgs = (r.messages || []).filter(
          (m) => m._ts * 1000 >= sinceMs && !m.is_system && m.content && String(m.content).trim()
        );
        results[i] = { name: g.name || r.display || g.wxid, messages: msgs };
      } catch (e) {
        results[i] = { name: g.name || g.wxid, messages: [], error: e.message };
      }
      done++;
      onProgress?.(done, groups.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, groups.length) }, worker));
  return results;
}

// ── 通知整理：同步跑完 ────────────────────────────────────
async function runOrganize({ trigger = 'manual' } = {}) {
  if (state.running) return;
  const groups = store.settings.groups || [];
  if (!groups.length) {
    state.error = '还没有选择要整理的群，先去「设置」里勾选。';
    return;
  }
  state.running = true;
  state.phase = '准备读取微信消息…';
  state.error = null;
  const runId = cryptoId();
  const startedAt = Date.now();
  state.startedAt = startedAt;

  try {
    const hours = Number(store.settings.lookbackHours) || 24;
    state.phase = `读取微信消息… (0/${groups.length})`;
    const chats = await readGroupChats(groups, hours, (d, n) => {
      state.phase = `读取微信消息… (${d}/${n})`;
    });
    const totalMsgs = chats.reduce((s, c) => s + c.messages.length, 0);
    const failedGroups = chats.filter((c) => c.error).length;

    if (!totalMsgs) {
      finishRun({ runId, trigger, totalMsgs: 0, items: 0, added: 0, updated: 0, engine: 'none', note: '这段时间没有新消息', groups: groups.length });
      return;
    }

    state.phase = '正在由 WorkBuddy 整理…';
    const packed = messagesToText(chats.filter((c) => c.messages.length), { maxCharsPerGroup: 12000 });
    let dismissed = [];
    try {
      dismissed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'dismissed.json'), 'utf8'));
    } catch {}
    const existingTitles = store.notices.map((n) => n.title);
    const items = await organizeWithModel({
      chatText: packed.text,
      hours,
      existingTitles,
      dismissed,
      termStart: store.settings.termStart,
      now: new Date(),
      settings: store.settings,
    });
    // 这里只做「别把用户删过/已有事项再建一次」的保护，不参与整理判断
    const seen = [...existingTitles, ...dismissed].map(String);
    const fresh = items.filter(
      (it) => !seen.some((t) => norm(t) === norm(it.title) || textSim(t, it.title) >= 0.72)
    );
    state.phase = '保存结果…';
    const { added, updated } = fresh.length
      ? store.upsertNotices(fresh, { runId })
      : { added: 0, updated: 0 };
    finishRun({
      runId, trigger, totalMsgs, items: fresh.length, added, updated,
      engine: 'workbuddy',
      note: fresh.length ? null : '这段时间没有可整理的新通知',
      groups: groups.length, failedGroups,
      durationMs: Date.now() - startedAt,
    });
  } catch (e) {
    state.error = e.message;
    finishRun({ runId, trigger, totalMsgs: 0, items: 0, added: 0, updated: 0, engine: 'error', error: e.message });
  }
}

// ── 娱乐群整理：同步跑完 ──────────────────────────────────
async function runFun() {
  if (state.funRunning) return;
  const groups = store.settings.funGroups || [];
  if (!groups.length) { state.funError = '还没有选择娱乐群，先去设置里勾选。'; return; }
  state.funRunning = true;
  state.funError = null;
  state.funPhase = '读取娱乐群消息…';
  const startedAt = Date.now();
  try {
    const hours = Number(store.settings.lookbackHours) || 24;
    const sinceMs = Date.now() - hours * 3600 * 1000;
    const chats = await readGroupChats(groups, hours, (d, n) => { state.funPhase = `读取娱乐群消息… (${d}/${n})`; });
    let ok = 0;
    for (const c of chats) {
      const msgs = c.messages.filter((m) => m._ts * 1000 >= sinceMs);
      const fresh = summarizeFun(msgs);
      const prev = store.funItems.find((x) => x.group === c.name);
      if (prev && prev.curated && prev.summary) {
        // 已经由 WorkBuddy 会话写好的总结：点整理只更新消息数，绝不用原文把它冲掉
        store.upsertFunGroup({ group: c.name, messageCount: fresh.messageCount, updatedAt: Date.now() });
      } else {
        store.upsertFunGroup({ group: c.name, ...fresh, updatedAt: Date.now() });
      }
      ok++;
    }
    store.settings.funLastRunAt = Date.now();
    store.saveSettings();
    state.funLastResult = { at: Date.now(), groups: groups.length, ok, durationMs: Date.now() - startedAt };
  } catch (e) {
    state.funError = e.message;
  } finally {
    state.funRunning = false;
    state.funPhase = '';
  }
}

// ── 定时调度：到点直接跑，不再排队 ────────────────────────
const ARCHIVE_TTL = 7 * 86400 * 1000;

function purgeArchived() {
  store.reloadNotices();
  const cutoff = Date.now() - ARCHIVE_TTL;
  const before = store.notices.length;
  store.notices = store.notices.filter((n) => !(n.archivedAt && n.archivedAt < cutoff));
  if (store.notices.length !== before) {
    store.saveNotices();
    console.log(`[归档] 清理 ${before - store.notices.length} 条超过 7 天的归档`);
  }
}

function tick() {
  purgeArchived();
  if (state.running) return;
  const s = store.settings;
  const now = new Date();
  const wd = now.getDay();
  if (s.days === 'weekday' && (wd === 0 || wd === 6)) return;
  if (!(s.groups || []).length) return;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = dayKey(now);
  const slots = Array.isArray(s.lastRunSlots) ? s.lastRunSlots : [];
  const dueTime = (s.times || []).find((t) => hhmm >= t && !slots.includes(`${today}T${t}`));
  if (dueTime) {
    const keepFrom = dayKey(new Date(now.getTime() - 3 * 86400_000));
    s.lastRunSlots = [...slots.filter((x) => x.slice(0, 10) >= keepFrom), `${today}T${dueTime}`];
    store.saveSettings();
    console.log(`[调度] ${today} ${hhmm} 开始自动整理`);
    runOrganize({ trigger: 'auto' });
  }
}

// ── HTTP ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  try {
    if (p === '/api/state' && req.method === 'GET') {
      store.reloadAll();
      return send(res, 200, {
        settings: store.settings,
        notices: store.notices,
        runs: store.runs.slice(0, 20),
        state: {
          running: state.running,
          phase: state.phase,
          lastRunAt: state.lastRunAt,
          lastResult: state.lastResult,
          error: state.error,
          startedAt: state.startedAt,
        },
        fun: {
          items: store.funItems,
          running: state.funRunning,
          phase: state.funPhase,
          error: state.funError,
          lastRunAt: store.settings.funLastRunAt || null,
          lastResult: state.funLastResult,
        },
        env: (() => {
          const b = backendStatus(store.settings);
          return {
            wechatReady: wechatReady(),
            aiAvailable: b.backend !== 'none',
            aiEnabled: true,
            ocrAvailable: false,
            engine: b.backend,
            backend: b.backend,
            workbuddyCli: b.workbuddyCli,
            apiConfigured: b.apiConfigured,
            deepseekConfigured: b.deepseekConfigured,
            platform: b.platform,
            version: readVersion().version,
          };
        })(),
      });
    }

    // 检查 GitHub 上的新版本：读仓库根目录的 version.json
    if (p === '/api/update/check' && req.method === 'POST') {
      const local = readVersion();
      const repo = String(local.repo || process.env.GITHUB_REPO || '').trim();
      if (!repo) {
        return send(res, 200, { ok: false, error: '还没有配置 GitHub 仓库（version.json 的 repo 字段）' });
      }
      try {
        // 用 api.github.com 读文件内容：部分网络环境访问不了 raw.githubusercontent.com
        const r = await fetch(`https://api.github.com/repos/${repo}/contents/version.json`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'qingsong-rili' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const body = await r.json();
        const remote = JSON.parse(Buffer.from(body.content || '', 'base64').toString('utf8'));
        return send(res, 200, {
          ok: true,
          current: local.version,
          latest: remote.version,
          hasUpdate: compareVersion(remote.version, local.version) > 0,
          notes: remote.notes || '',
          releasedAt: remote.releasedAt || '',
          url: remote.download || `https://github.com/${repo}/releases/latest`,
        });
      } catch (e) {
        return send(res, 200, { ok: false, error: `检查更新失败：${e.message}` });
      }
    }

    if (p === '/api/settings' && req.method === 'POST') {
      const body = await readBody(req);
      const s = store.settings;
      if (Array.isArray(body.times)) {
        s.times = body.times.map((t) => String(t).trim()).filter((t) => /^\d{2}:\d{2}$/.test(t)).sort();
      }
      if (body.days === 'daily' || body.days === 'weekday') s.days = body.days;
      if (Array.isArray(body.groups)) {
        s.groups = body.groups.filter((g) => g && g.wxid)
          .map((g) => ({ wxid: String(g.wxid), name: String(g.name || g.display || g.wxid) }));
      }
      if (body.lookbackHours) s.lookbackHours = Math.min(8760, Math.max(1, Number(body.lookbackHours) || 24));
      if (Array.isArray(body.funGroups)) {
        s.funGroups = body.funGroups.filter((g) => g && g.wxid)
          .map((g) => ({ wxid: String(g.wxid), name: String(g.name || g.display || g.wxid) }));
      }
      if (typeof body.ocrImages === 'boolean') s.ocrImages = body.ocrImages;
      if (typeof body.organizeBackend === 'string') {
        s.organizeBackend = ['auto', 'workbuddy', 'openai', 'deepseek', 'queue', 'none'].includes(body.organizeBackend)
          ? body.organizeBackend : 'auto';
      }
      if (typeof body.apiBaseUrl === 'string') s.apiBaseUrl = body.apiBaseUrl.trim().slice(0, 300);
      if (typeof body.apiKey === 'string') s.apiKey = body.apiKey.trim().slice(0, 300);
      if (typeof body.apiModel === 'string') s.apiModel = body.apiModel.trim().slice(0, 80);
      // 兼容旧字段
      if (typeof body.deepseekApiKey === 'string') s.apiKey = body.deepseekApiKey.trim().slice(0, 300);
      if (typeof body.deepseekModel === 'string') s.apiModel = body.deepseekModel.trim().slice(0, 80);
      if (typeof body.deepseekBaseUrl === 'string') s.apiBaseUrl = body.deepseekBaseUrl.trim().slice(0, 300);
      if (typeof body.termStart === 'string' || body.termStart === null) {
        s.termStart = body.termStart && /^\d{4}-\d{2}-\d{2}$/.test(body.termStart) ? body.termStart : null;
      }
      store.saveSettings();
      return send(res, 200, { ok: true, settings: s });
    }

    if (p === '/api/groups' && req.method === 'POST') {
      const chats = await listChats();
      return send(res, 200, { chats });
    }

    if (p === '/api/fun/run' && req.method === 'POST') {
      if (state.funRunning) return send(res, 409, { ok: false, error: '正在整理娱乐群，请稍候' });
      runFun();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/run' && req.method === 'POST') {
      if (state.running) return send(res, 409, { ok: false, error: '正在整理中，请稍候' });
      state.error = null;
      runOrganize({ trigger: 'manual' });     // 后台跑，前端轮询状态
      return send(res, 200, { ok: true });
    }

    // 手动添加：粘贴的文本当场交给 WorkBuddy 整理成待办，不排队、不用本地规则兜底
    if (p === '/api/manual/add' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (!text) return send(res, 400, { ok: false, error: '先粘贴一段内容' });
      if (text.length > 20000) return send(res, 400, { ok: false, error: '内容太长（上限 2 万字）' });
      const source = String(body.source || '').trim().slice(0, 80) || '手动添加';
      const now = new Date();
      let dismissed = [];
      try { dismissed = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'dismissed.json'), 'utf8')); } catch {}
      try {
        const items = await organizeWithModel({
          chatText: `[${now.toLocaleString('zh-CN')}] ${text}`,
          hours: 0,
          existingTitles: store.notices.map((n) => n.title),
          dismissed,
          termStart: store.settings.termStart,
          now, todo: true, settings: store.settings,
        });
        const todos = items.map((x) => ({ ...x, status: 'todo', group: x.group || source }));
        if (!todos.length) {
          return send(res, 200, { ok: true, added: 0, updated: 0, items: 0, note: '这段内容里没有要做的具体事项' });
        }
        const { added, updated } = store.upsertNotices(todos, { runId: 'paste-' + cryptoId() });
        finishRun({
          runId: 'paste-' + cryptoId(), trigger: 'paste', type: 'manual',
          totalMsgs: 1, items: todos.length, added, updated,
          engine: 'workbuddy', groups: 1, durationMs: 0,
        });
        return send(res, 200, { ok: true, added, updated, items: todos.length });
      } catch (e) {
        state.error = e.message;
        return send(res, 503, { ok: false, error: e.message });
      }
    }

    // 旧队列接口保留做排查用，主流程已不再往里写请求
    if (p === '/api/organize/queue' && req.method === 'GET') {
      return send(res, 200, { pending: pending(), recent: recent(20) });
    }
    if (p === '/api/organize/complete' && req.method === 'POST') {
      const body = await readBody(req);
      const job = complete(body.id, body.result || {});
      if (!job) return send(res, 404, { ok: false, error: '找不到这个整理请求' });
      return send(res, 200, { ok: true, job });
    }

    if (p === '/api/notice' && req.method === 'POST') {
      const body = await readBody(req);
      store.reloadNotices();
      const n = store.findNotice(body.id);
      if (!n) return send(res, 404, { ok: false, error: '找不到这条通知' });
      if (['new', 'todo', 'done', 'skip'].includes(body.status)) {
        const prev = n.status;
        n.status = body.status;
        if (body.status === 'done' || body.status === 'skip') {
          n.archivedAt = n.archivedAt || Date.now();
          n.prevStatus = prev === 'done' || prev === 'skip' ? (n.prevStatus || 'new') : prev;
        } else {
          delete n.archivedAt;
          delete n.prevStatus;
        }
      }
      if (typeof body.deadline === 'string' || body.deadline === null) {
        if (body.deadline !== undefined) n.deadline = body.deadline || null;
      }
      n.updatedAt = Date.now();
      store.saveNotices();
      return send(res, 200, { ok: true, notice: n });
    }

    if (p === '/api/fun/delete' && req.method === 'POST') {
      const body = await readBody(req);
      store.reloadFun();
      store.funItems = store.funItems.filter((n) => n.id !== body.id);
      store.saveFun();
      return send(res, 200, { ok: true });
    }

    if (p === '/api/notice/restore' && req.method === 'POST') {
      const body = await readBody(req);
      store.reloadNotices();
      const n = store.findNotice(body.id);
      if (!n) return send(res, 404, { ok: false, error: '找不到这条通知' });
      n.status = n.prevStatus && n.prevStatus !== 'done' && n.prevStatus !== 'skip' ? n.prevStatus : 'new';
      delete n.archivedAt;
      delete n.prevStatus;
      n.updatedAt = Date.now();
      store.saveNotices();
      return send(res, 200, { ok: true, notice: n });
    }

    if (p === '/api/notice/delete' && req.method === 'POST') {
      const body = await readBody(req);
      store.reloadNotices();
      store.notices = store.notices.filter((n) => n.id !== body.id);
      store.saveNotices();
      return send(res, 200, { ok: true });
    }

    // 一键清空归档：只删已忽略 / 已完成的卡片，活跃与待办一律保留
    if (p === '/api/archive/clear' && req.method === 'POST') {
      store.reloadNotices();
      const before = store.notices.length;
      const removedNotices = store.notices.filter(
        (n) => n.status === 'done' || n.status === 'skip' || n.archivedAt
      );
      store.notices = store.notices.filter((n) => !removedNotices.includes(n));
      const removed = before - store.notices.length;
      store.saveNotices();
      // 记下被删的标题，后续自动整理不再把它们加回来
      try {
        const file = path.join(__dirname, 'data', 'dismissed.json');
        let list = [];
        try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
        list = [...new Set([...list, ...removedNotices.map((n) => String(n.title))])].slice(-500);
        fs.writeFileSync(file + '.tmp', JSON.stringify(list, null, 2));
        fs.renameSync(file + '.tmp', file);
      } catch {}
      return send(res, 200, { ok: true, removed, remaining: store.notices.length });
    }

    if (p === '/api/open' && req.method === 'POST') {
      const body = await readBody(req);
      const target = String(body.url || '');
      if (/^https?:\/\//.test(target)) {
        openUrl(target);
        return send(res, 200, { ok: true });
      }
      return send(res, 400, { ok: false });
    }

    let file = p === '/' ? '/index.html' : p;
    const full = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return send(res, 404, 'Not found', 'text/plain');
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    console.error('[error]', e);
    send(res, 500, { ok: false, error: e.message });
  }
});

function listen(port, attempt = 0) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 20) {
      listen(port + 1, attempt + 1);
    } else {
      console.error('启动失败:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`\n  轻松日程已启动 → ${url}\n`);
    if (process.env.NO_OPEN !== '1') openUrl(url);
    setInterval(tick, 20_000);
    tick();
  });
}

listen(PORT_START);
