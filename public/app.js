/* 轻松日程 前端 */
const CAT_META = {
  '作业': { emoji: '📘', cls: 'sky' },
  '兼职': { emoji: '💼', cls: 'peach' },
  '比赛': { emoji: '🏆', cls: 'lilac' },
  '活动': { emoji: '🎪', cls: 'mint' },
  '志愿': { emoji: '🤝', cls: 'rose' },
  '通知': { emoji: '📢', cls: 'sand' },
  '其他': { emoji: '📎', cls: 'gray' },
};
const CATS = Object.keys(CAT_META);

const FUN_META = {
  '游戏': { emoji: '🎮', cls: 'game' },
  '动漫': { emoji: '📺', cls: 'anime' },
  '吃喝': { emoji: '🍜', cls: 'food' },
  '约玩': { emoji: '🎲', cls: 'play' },
  '二手': { emoji: '🛒', cls: 'trade' },
  '活动': { emoji: '🎉', cls: 'event' },
  '话题': { emoji: '💬', cls: 'topic' },
};
const FUN_CATS = Object.keys(FUN_META);

const app = {
  data: null,
  mode: 'notice',          // notice | fun
  tab: 'all',
  funTab: 'all',
  selectedId: null,
  groupCache: null,
  groupQuery: '',
  draft: null,
  pollTimer: null,
  tickTimer: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── 时间工具 ──────────────────────────────────────────────
function parseDeadline(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDeadline(s) {
  const d = parseDeadline(s);
  if (!d) return '没有明确截止时间';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = `${sameYear ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日`;
  const hasTime = /[:：]\d{2}/.test(String(s));
  return hasTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : `${date}`;
}

function countdownOf(s) {
  const d = parseDeadline(s);
  if (!d) return { text: '无截止', cls: 'none' };
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return { text: '已截止', cls: 'expired' };
  const mins = ms / 60000;
  if (mins < 60) return { text: `还剩 ${Math.ceil(mins)} 分钟`, cls: 'urgent' };
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return { text: `还剩 ${h} 小时${m ? ` ${m} 分` : ''}`, cls: mins < 6 * 60 ? 'urgent' : 'soon' };
  }
  const days = Math.floor(mins / 1440);
  const hh = Math.floor((mins % 1440) / 60);
  return { text: `还剩 ${days} 天${hh ? ` ${hh} 小时` : ''}`, cls: days <= 2 ? 'soon' : 'ok' };
}

function pad(n) { return String(n).padStart(2, '0'); }

/** "2026-11-11 23:59" / "2026-11-11" → datetime-local 输入值 */
function toLocalInput(s) {
  const d = parseDeadline(s);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextRunText(s) {
  const times = s.times || [];
  if (!times.length) return '未设置自动整理';
  const now = new Date();
  const cands = [];
  for (let d = 0; d < 9; d++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    if (s.days === 'weekday' && (day.getDay() === 0 || day.getDay() === 6)) continue;
    for (const t of times) {
      const [h, m] = t.split(':').map(Number);
      const dt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0);
      if (dt.getTime() > now.getTime() + 15000) cands.push(dt);
    }
  }
  cands.sort((a, b) => a - b);
  if (!cands.length) return '未设置自动整理';
  const dt = cands[0];
  return `下次整理 ${dt.getMonth() + 1}月${dt.getDate()}日 ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}


// ── 娱乐模式 ──────────────────────────────────────────────
function funItems() { return app.data?.fun?.items || []; }

function funNextRunText() {
  const f = app.data?.fun;
  if (f?.running) return '正在整理娱乐群…';
  if (f?.lastRunAt) {
    const d = new Date(f.lastRunAt);
    return `上次整理 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return '还没整理过娱乐群';
}

function renderModeSwitch() {
  const el = document.getElementById('modeSwitch');
  if (!el) return;
  el.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.mode === app.mode);
  });
}

function funTabsHtml() {
  const list = funItems();
  const total = app.data?.settings?.funGroups?.length || 0;
  return `<div class="fun-stat">👥 ${total} 个娱乐群${list.length ? ` · 已总结 ${list.length} 个` : ''}</div>`;
}

function visibleFun() {
  const list = funItems().slice();
  list.sort((a, b) => {
    const ae = (a.messageCount || 0) === 0 ? 1 : 0;
    const be = (b.messageCount || 0) === 0 ? 1 : 0;
    if (ae !== be) return ae - be;          // 没消息的群排最后
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return list;
}

function funCardHtml(n) {
  const hi = (n.highlights || []).slice(0, 3);
  const when = n.updatedAt
    ? (() => { const d = new Date(n.updatedAt); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()
    : '';
  return `<article class="card fun group-card" data-funid="${n.id}" style="animation-delay:${Math.random() * 0.08}s">
    <div class="card-top">
      <span class="badge fun-badge">👥 群聊</span>
      <span class="src">${n.messageCount ? `${n.messageCount} 条消息` : '暂无新消息'}</span>
    </div>
    <h3 class="card-title">${esc(n.group)}</h3>
    <p class="summary">${esc(n.summary || '')}</p>
    ${hi.length ? `<ul class="fun-hi">${hi.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="card-foot"><span class="deadline none">🕒 更新于 ${when}</span></div>
  </article>`;
}

function renderFunEmpty() {
  const empty = $('empty');
  const list = funItems();
  const groups = app.data?.settings?.funGroups || [];
  if (!groups.length) {
    empty.hidden = false;
    $('emptyTitle').textContent = '先选几个娱乐群';
    $('emptyText').innerHTML = '游戏群、动漫群、桌游群、吃喝群…<br/>选好了我就帮你看大家在聊什么、有什么局。';
    $('emptyAction').textContent = '去选择群';
    return;
  }
  if (!list.length) {
    empty.hidden = false;
    $('emptyTitle').textContent = '还没有群总结';
    $('emptyText').innerHTML = `已经选好 ${groups.length} 个娱乐群，点「立即整理」，<br/>我会给每个群写一份这段时间都在聊什么的总结。`;
    $('emptyAction').textContent = '立即整理';
    return;
  }
  empty.hidden = true;
}

// ── 数据 ──────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

let prevRunning = false;

function afterRun(data) {
  const was = prevRunning;
  prevRunning = Boolean(data.state?.running);
  if (!was || data.state?.running) return;
  const r = data.state?.lastResult;
  if (!r) return;
  if (r.engine === 'none') {
    toast(r.note || '整理完成，这段时间没有新内容');
    return;
  }
  if (r.error) {
    toast(r.error, 5000);
  }
  if ((r.items || 0) > 0) {
    const isManualAdd = r.type === 'manual';
    toast(isManualAdd
      ? `整理完成 · ${r.items} 条待办已加入 🎉`
      : `整理完成 · ${r.items} 条通知${r.added ? `（新增 ${r.added}）` : ''} 🎉`);
    app.tab = isManualAdd ? 'todo' : 'all';
    render();
  }
}

async function load({ quiet = false } = {}) {
  try {
    const data = await api('/api/state');
    app.data = data;
    render();
    afterRun(data);
    schedulePoll();
  } catch (e) {
    if (!quiet) toast('连不上本地服务，请确认启动窗口还开着');
  }
}

function schedulePoll() {
  clearTimeout(app.pollTimer);
  const running = app.data?.state?.running;
  app.pollTimer = setTimeout(() => load({ quiet: true }), running ? 1800 : 30000);
}

// ── 渲染 ──────────────────────────────────────────────────
function notices() { return app.data?.notices || []; }

function isArchived(n) { return n.status === 'skip' || n.status === 'done'; }

function tabCount(id) {
  const list = notices();
  if (id === 'all') return list.filter((n) => !isArchived(n)).length;
  if (id === 'todo') return list.filter((n) => n.status === 'todo').length;
  if (id === 'archive') return list.filter(isArchived).length;
  return list.filter((n) => n.category === id && !isArchived(n)).length;
}

/** 归档条目还剩几天自动删除 */
function archiveDaysLeft(n) {
  if (!n.archivedAt) return 7;
  return Math.max(0, Math.ceil((n.archivedAt + 7 * 86400000 - Date.now()) / 86400000));
}

/** 把 sourceTime（字符串）或 createdAt（毫秒时间戳）统一成 YYYY-MM-DD HH:mm */
function formatNoticeTime(v) {
  if (!v) return '';
  const raw = String(v).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const d = new Date(Number(raw.length === 10 ? raw + '000' : raw));
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return '';
  }
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return raw.slice(0, 20);
  return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}${m[4] ? ` ${pad(+m[4])}:${m[5]}` : ''}`;
}

/** 归档页顶部的一键清理条 */
function renderArchiveBar() {
  const bar = $('archiveBar');
  if (!bar) return;
  const count = notices().filter(isArchived).length;
  const show = app.mode === 'notice' && app.tab === 'archive' && count > 0;
  bar.hidden = !show;
  if (show) {
    $('archiveBarText').textContent = `归档里共 ${count} 条（已完成 / 已忽略），原本会在归档 7 天后自动清理`;
  }
}

async function clearArchive() {
  const count = notices().filter(isArchived).length;
  if (!count) return;
  if (!window.confirm(`确定删除归档里的全部 ${count} 条吗？\n删除后无法恢复；活跃列表和待办不受影响。`)) return;
  const res = await api('/api/archive/clear', { method: 'POST' });
  if (!res.ok) { toast(res.error || '删除失败'); return; }
  if (!$('drawer').hidden) closeDetail();
  toast(`已删除 ${res.removed} 条归档`);
  load({ quiet: true });
}

function render() {
  if (!app.data) return;
  const { settings, state } = app.data;

  $('nextRun').textContent = app.mode === 'fun' ? funNextRunText() : nextRunText(settings);
  $('runBtn').disabled = app.mode === 'fun' ? Boolean(app.data.fun?.running) : state.running;
  updateRunBar(state);
  renderModeSwitch();

  if (app.mode === 'fun') {
    $('tabs').innerHTML = funTabsHtml();
    $('grid').innerHTML = visibleFun().map((n) => funCardHtml(n)).join('');
    renderFunEmpty();
    $('archiveBar').hidden = true;
  } else {
    renderTabs();
    renderGrid();
    renderEmpty(state);
    renderArchiveBar();
  }
  if (app.selectedId) renderDetail();

  if (state.error && !state.running) {
    if (!app._lastErr || app._lastErr !== state.error) {
      app._lastErr = state.error;
      toast(state.error, 4200);
    }
  } else if (!state.error) {
    app._lastErr = null;
  }
}

function updateRunBar(state) {
  const bar = $('runBar');
  const fun = app.data?.fun;
  const running = app.mode === 'fun' ? Boolean(fun?.running) : state.running;
  const phase = app.mode === 'fun' ? fun?.phase : state.phase;
  if (!running) {
    bar.hidden = true;
    bar.classList.remove('queued');
    return;
  }
  bar.hidden = false;

  // 点按钮后应用真的在调 WorkBuddy 模型，进度条按阶段推进，不再是排队等待
  bar.classList.remove('queued');
  const pulse = bar.querySelector('.pulse');
  const track = bar.querySelector('.runbar-track');
  if (pulse) pulse.style.display = '';
  if (track) track.style.display = '';
  $('runText').textContent = phase || '正在整理…';
  let pct = 12;
  const m = String(phase || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (m) pct = 8 + (+m[1] / +m[2]) * 66;
  else if (/WorkBuddy|分类整理|整理娱乐|正在整理/.test(phase)) pct = 78;
  else if (/保存/.test(phase)) pct = 94;
  $('runFill').style.width = pct + '%';
}

function renderTabs() {
  const tabs = [
    { id: 'all', label: '全部', emoji: '🗂' },
    { id: 'todo', label: '待办', emoji: '⏳' },
    ...CATS.map((c) => ({ id: c, label: c, emoji: CAT_META[c].emoji })),
    { id: 'archive', label: '归档', emoji: '🗃️' },
  ];
  $('tabs').innerHTML = tabs.map((t) => {
    const n = tabCount(t.id);
    return `<button class="tab ${app.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
      <span>${t.emoji}</span>${t.label}${n ? `<span class="n">${n}</span>` : ''}
    </button>`;
  }).join('');
}

function visibleNotices() {
  const list = notices().slice();
  const statusRank = { todo: 0, new: 1, done: 2, skip: 3 };
  const dl = (n) => { const d = parseDeadline(n.deadline); return d ? d.getTime() : 9e15; };
  if (app.tab === 'all') {
    list.sort((a, b) => (statusRank[a.status] - statusRank[b.status]) || (dl(a) - dl(b)));
  } else if (app.tab === 'todo') {
    list.sort((a, b) => dl(a) - dl(b));
  } else if (app.tab === 'archive') {
    list.sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  } else {
    list.sort((a, b) => dl(a) - dl(b));
  }
  return list.filter((n) => {
    if (app.tab === 'all') return !isArchived(n);
    if (app.tab === 'todo') return n.status === 'todo';
    if (app.tab === 'archive') return isArchived(n);
    return n.category === app.tab && !isArchived(n);
  });
}

function renderGrid() {
  const list = visibleNotices();
  const grid = $('grid');
  grid.innerHTML = list.map((n) => cardHtml(n)).join('');
  if (!list.length) grid.innerHTML = '';
}

function cardHtml(n) {
  const meta = CAT_META[n.category] || CAT_META['其他'];
  const cd = countdownOf(n.deadline);
  const hasDl = Boolean(parseDeadline(n.deadline));
  const archived = isArchived(n);
  const statusCls = archived ? 'status-archived' : '';
  const actions = archived
    ? `<button class="act main" data-act="restore">↩ 恢复到列表</button>
       <button class="act warn" data-act="delete">删除</button>`
    : n.status === 'todo'
      ? `<button class="act main" data-act="done">✓ 完成</button>
         <button class="act" data-act="new">移回通知</button>`
      : `<button class="act main" data-act="todo">加入待办</button>
         <button class="act warn" data-act="skip">不参加 / 忽略</button>`;

  const footLeft = archived
    ? `<span class="archive-note">🗃️ ${n.status === 'done' ? '已完成' : '已忽略'} · ${archiveDaysLeft(n)} 天后自动清理</span>`
    : `<span class="deadline ${hasDl ? '' : 'none'}">🕒 ${hasDl ? fmtDeadline(n.deadline) : '没有明确截止时间'}</span>`;
  const footRight = archived ? '' : `<span class="countdown ${n.status === 'todo' ? 'todo-' + cd.cls : cd.cls}">${cd.text}</span>`;

  return `<article class="card cat-${meta.cls} ${statusCls}" data-id="${n.id}" style="animation-delay:${Math.random() * 0.08}s">
    <div class="card-top">
      <span class="badge">${meta.emoji} ${esc(n.category)}</span>
      <span class="src">${esc(n.group || '来源未知')}</span>
    </div>
    <h3 class="card-title">${esc(n.title)}${n.status === 'todo' ? '<span class="todo-flag">⏳ 待办中</span>' : ''}</h3>
    <p class="summary">${esc(n.summary || n.detail || '')}</p>
    <div class="card-foot">
      ${footLeft}
      ${footRight}
    </div>
    <div class="card-actions">${actions}</div>
  </article>`;
}

function renderEmpty(state) {
  const list = notices();
  const empty = $('empty');
  const gridEmpty = visibleNotices().length === 0;
  const groups = app.data?.settings?.groups || [];
  if (!groups.length) {
    empty.hidden = false;
    $('emptyTitle').textContent = '先选几个要整理的群';
    $('emptyText').innerHTML = '微信群那么多，先挑出重要的几个：班群、通知群、兼职群…<br/>我只读这些群，不会乱翻你的聊天。';
    $('emptyAction').textContent = '去选择群';
  } else if (state.running) {
    empty.hidden = true;
  } else if (!list.length) {
    empty.hidden = false;
    $('emptyTitle').textContent = '还没有整理过';
    $('emptyText').innerHTML = `已经选好 ${groups.length} 个群，点「立即整理」，<br/>我会把作业、兼职、比赛、活动都捞出来。`;
    $('emptyAction').textContent = '立即整理';
  } else if (gridEmpty) {
    empty.hidden = false;
    if (app.tab === 'archive') {
      $('emptyTitle').textContent = '归档还是空的';
      $('emptyText').innerHTML = '完成或忽略的通知会放到这里，保留 7 天后自动清理。';
      $('emptyAction').textContent = '回到全部';
    } else {
      $('emptyTitle').textContent = '这一栏是空的';
      $('emptyText').innerHTML = '换个分类看看，或者点「立即整理」抓点新消息。';
      $('emptyAction').textContent = '立即整理';
    }
  } else {
    empty.hidden = true;
  }
}

// ── 卡片交互 ──────────────────────────────────────────────
async function restoreNotice(id) {
  const res = await api('/api/notice/restore', { method: 'POST', body: JSON.stringify({ id }) });
  if (!res.ok) { toast('恢复失败'); return; }
  const n = notices().find((x) => x.id === id);
  if (n) { n.status = res.notice.status; delete n.archivedAt; delete n.prevStatus; }
  render();
  toast('已恢复到列表');
}

async function deleteNotice(id) {
  const n = notices().find((x) => x.id === id);
  if (!n) return;
  if (!window.confirm(`删除「${n.title}」？删了就找不回来了`)) return;
  const res = await api('/api/notice/delete', { method: 'POST', body: JSON.stringify({ id }) });
  if (!res.ok) { toast('删除失败'); return; }
  app.data.notices = notices().filter((x) => x.id !== id);
  if (app.selectedId === id) closeDetail();
  render();
  toast('已删除');
}

async function setStatus(id, status) {
  const n = notices().find((x) => x.id === id);
  if (!n) return;
  n.status = status;
  render();
  const res = await api('/api/notice', { method: 'POST', body: JSON.stringify({ id, status }) });
  if (!res.ok) { toast('保存失败'); load(); return; }
  if (status === 'todo') toast(parseDeadline(n.deadline) ? '已加入待办，倒计时开始 ⏳' : '已加入待办 ✓');
  if (status === 'skip') toast('已归档，7 天后自动清理');
  if (status === 'done') toast('完成一件 🎉 已归档，7 天后自动清理');
  if (status === 'new') toast('已移回通知');
}

// ── 详情抽屉 ──────────────────────────────────────────────
function openDetail(id) {
  app.selectedId = id;
  $('mask').hidden = false;
  $('drawer').hidden = false;
  renderDetail();
}

function closeDetail() {
  app.selectedId = null;
  $('drawer').hidden = true;
  if ($('settingsDrawer').hidden) $('mask').hidden = true;
}

function renderFunDetail(n) {
  const when = n.updatedAt
    ? (() => { const d = new Date(n.updatedAt); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()
    : '';
  $('drawer').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="d-meta">
          <span class="badge fun-badge">👥 群聊总结</span>
          <span class="d-src">${n.messageCount ? `${n.messageCount} 条消息 · ` : ''}${when}</span>
        </div>
        <h2 class="d-title">${esc(n.group)}</h2>
      </div>
      <button class="close" id="closeDrawer">×</button>
    </div>
    <div class="drawer-body">
      <div class="d-section">
        <div class="d-label">这段时间</div>
        <div class="d-text">${esc(n.summary || '（没有总结）')}</div>
      </div>
      ${n.hotspot ? `<div class="d-section">
        <div class="d-label">最热话题</div>
        <div class="d-action"><span class="ico">🔥</span><span>${esc(n.hotspot)}</span></div>
      </div>` : ''}
      ${(n.highlights || []).length ? `<div class="d-section">
        <div class="d-label">要点</div>
        <ul class="fun-hi big">${n.highlights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>` : ''}
      <div class="d-buttons">
        <button class="btn ghost" data-funact="delete">删除这份总结</button>
      </div>
    </div>`;
  $('closeDrawer').onclick = closeDetail;
  $('drawer').querySelector('[data-funact="delete"]').onclick = async () => {
    if (!window.confirm(`删除「${n.group}」的总结？`)) return;
    const res = await api('/api/fun/delete', { method: 'POST', body: JSON.stringify({ id: n.id }) });
    if (res.ok) {
      app.data.fun.items = app.data.fun.items.filter((x) => x.id !== n.id);
      closeDetail();
      render();
      toast('已删除');
    }
  };
}

function renderDetail() {
  if (app.mode === 'fun') {
    const f = funItems().find((x) => x.id === app.selectedId);
    if (f) return renderFunDetail(f);
    return closeDetail();
  }
  const n = notices().find((x) => x.id === app.selectedId);
  if (!n) return closeDetail();
  const meta = CAT_META[n.category] || CAT_META['其他'];
  const cd = countdownOf(n.deadline);
  const hasDl = Boolean(parseDeadline(n.deadline));
  const archived = isArchived(n);
  const buttons = archived
    ? `<button class="btn primary" data-dact="restore">↩ 恢复到列表</button>
       <button class="btn ghost" data-dact="delete">删除</button>`
    : n.status === 'todo'
      ? `<button class="btn primary" data-dact="done">✓ 标记完成</button>
         <button class="btn ghost" data-dact="new">移回通知</button>`
      : `<button class="btn primary" data-dact="todo">加入待办</button>
         <button class="btn ghost" data-dact="skip">不参加 / 忽略</button>`;

  $('drawer').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="d-meta">
          <span class="badge cat-${meta.cls}">${meta.emoji} ${esc(n.category)}</span>
          <span class="d-src">来自「${esc(n.group || '未知群')}」</span>
        </div>
        <h2 class="d-title">${esc(n.title)}</h2>
      </div>
      <button class="close" id="closeDrawer">×</button>
    </div>
    <div class="drawer-body">
      <div class="d-countdown ${archived ? 'archived' : cd.cls}">
        <div>
          <div class="big">${archived ? '已归档' : cd.text}</div>
          <div class="sub">${archived ? `${n.status === 'done' ? '已完成' : '已忽略'} · ${archiveDaysLeft(n)} 天后自动清理` : (hasDl ? '截止时间 · ' + fmtDeadline(n.deadline) : '这条通知没有写截止时间')}</div>
        </div>
        <div style="font-size:26px">${archived ? '🗃️' : (hasDl ? '⏳' : '🌿')}</div>
      </div>

      ${archived ? '' : `<div class="d-deadline-edit">
        <div class="d-label">截止时间（可以自己改）</div>
        <div class="dl-row">
          <input type="datetime-local" id="dlInput" value="${toLocalInput(n.deadline)}" />
          <button class="btn primary" id="saveDl">保存</button>
          <button class="btn ghost" id="clearDl">清除</button>
        </div>
        <div class="dl-hint">AI 拿不准的（比如「第十周」「期末」），自己定个日子就行</div>
      </div>`}

      <div class="d-section">
        <div class="d-label">时间信息</div>
        <div class="d-text d-time">
          📢 发布时间：${formatNoticeTime(n.sourceTime) ? esc(formatNoticeTime(n.sourceTime)) : '未记录原始消息时间'}<br/>
          📥 收录时间：${esc(formatNoticeTime(n.createdAt) || '—')}
          ${n.updatedAt && formatNoticeTime(n.updatedAt) !== formatNoticeTime(n.createdAt) ? `<br/>🔄 最近更新：${esc(formatNoticeTime(n.updatedAt))}` : ''}
          ${archived && n.archivedAt ? `<br/>🗃️ 归档时间：${esc(formatNoticeTime(n.archivedAt))}` : ''}
        </div>
      </div>

      <div class="d-section">
        <div class="d-label">完整内容</div>
        <div class="d-text">${esc(n.detail || n.summary || '（没有更多细节）')}</div>
      </div>

      ${n.action ? `<div class="d-section">
        <div class="d-label">我要做什么</div>
        <div class="d-action"><span class="ico">👉</span><span>${esc(n.action)}</span></div>
      </div>` : ''}

      <div class="d-buttons">${buttons}</div>

      ${n.raw ? `<button class="raw-toggle" id="rawToggle">查看群里的原始消息 ›</button>
        <div class="raw-box" id="rawBox" hidden>${esc(n.raw)}</div>` : ''}
    </div>`;

  $('closeDrawer').onclick = closeDetail;

  const saveDl = $('saveDl');
  if (saveDl) {
    saveDl.onclick = async () => {
      const v = $('dlInput').value;
      const n2 = notices().find((x) => x.id === n.id);
      const res = await api('/api/notice', {
        method: 'POST',
        body: JSON.stringify({ id: n.id, deadline: v ? v.replace('T', ' ') : null }),
      });
      if (!res.ok) return toast('保存失败');
      if (n2) n2.deadline = res.notice.deadline;
      render();
      renderDetail();
      toast(v ? '截止时间已更新 ⏳' : '已清除截止时间');
    };
    $('clearDl').onclick = () => { $('dlInput').value = ''; saveDl.click(); };
  }

  const rt = $('rawToggle');
  if (rt) rt.onclick = () => {
    const box = $('rawBox');
    box.hidden = !box.hidden;
    rt.textContent = box.hidden ? '查看群里的原始消息 ›' : '收起原始消息 ‹';
  };
}

// ── 设置抽屉 ──────────────────────────────────────────────
function openSettings() {
  const s = app.data.settings;
  app.draft = {
    times: [...(s.times || [])],
    days: s.days || 'daily',
    groups: (s.groups || []).map((g) => ({ ...g })),
    funGroups: (s.funGroups || []).map((g) => ({ ...g })),
  };
  $('mask').hidden = false;
  $('settingsDrawer').hidden = false;
  renderSettings();
  loadGroups();
}

function closeSettings() {
  $('settingsDrawer').hidden = true;
  if ($('drawer').hidden) $('mask').hidden = true;
  app.draft = null;
}

async function loadGroups() {
  if (app.groupCache) return renderSettings();
  $('settingsBody').querySelector('#grpList')?.classList.add('loading');
  try {
    const res = await api('/api/groups', { method: 'POST' });
    app.groupCache = res.chats || [];
    if (!Array.isArray(app.groupCache)) app.groupCache = [];
  } catch {
    app.groupCache = [];
  }
  renderSettings();
}

function renderSettings() {
  const d = app.draft;
  if (!d) return;
  const groups = app.groupCache || [];
  const chosen = new Map(d.groups.map((g) => [g.wxid, g]));
  const q = app.groupQuery.toLowerCase();
  const filtered = groups.filter((g) => !q || g.display.toLowerCase().includes(q) || (g.isGroup ? '群' : '人').includes(q));

  $('settingsBody').innerHTML = `
    <div class="s-block">
      <div class="s-title">⏰ 什么时候自动整理</div>
      <div class="s-desc">到点我会去读你选的群，把新通知整理好。可以设多个时间。</div>
      <div class="chips" id="timeChips">
        ${d.times.map((t) => `<span class="time-chip">${t}<button data-del="${t}">×</button></span>`).join('')}
        <input type="time" id="newTime" value="08:00" />
        <button class="btn ghost" id="addTime" style="padding:8px 14px">+ 添加</button>
      </div>
      <div style="margin-top:14px" class="seg" id="daysSeg">
        <button data-days="daily" class="${d.days === 'daily' ? 'on' : ''}">每天</button>
        <button data-days="weekday" class="${d.days === 'weekday' ? 'on' : ''}">仅工作日</button>
      </div>
    </div>

    <div class="s-block">
      <div class="s-title">📚 整理哪些群 <span style="font-weight:400;color:var(--muted);font-size:12.5px">已选 ${d.groups.length} 个</span></div>
      <div class="s-desc">只读你勾选的群。可以搜群名，比如"班群""通知""兼职"。</div>
      <input class="s-input grp-search" id="grpSearch" placeholder="搜索群名…" value="${esc(app.groupQuery)}" />
      <div class="grp-list" id="grpList">
        ${groups.length === 0
          ? `<div class="grp-empty">正在读取微信群列表…</div>`
          : filtered.length === 0
            ? `<div class="grp-empty">没有匹配的群</div>`
            : filtered.map((g) => `<label class="grp-row">
                <input type="checkbox" data-wxid="${esc(g.wxid)}" ${chosen.has(g.wxid) ? 'checked' : ''} />
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.display)}</span>
                <span class="tag">${g.isGroup ? '群聊' : '联系人'}</span>
              </label>`).join('')}
      </div>
    </div>

    <div class="s-block">
      <div class="s-title">🎮 娱乐群 <span style="font-weight:400;color:var(--muted);font-size:12.5px">已选 ${d.funGroups.length} 个</span></div>
      <div class="s-desc">游戏、动漫、吃喝、桌游这些群单独整理，不会混进上面的通知。</div>
      <input class="s-input grp-search" id="funSearch" placeholder="搜索娱乐群…" />
      <div class="grp-list" id="funList">
        ${groups.length === 0
          ? `<div class="grp-empty">正在读取微信群列表…</div>`
          : (() => {
              const fq = (app.funQuery || '').toLowerCase();
              const fh = new Map(d.funGroups.map((g) => [g.wxid, g]));
              const list = groups.filter((g) => !fq || g.display.toLowerCase().includes(fq));
              return list.length === 0
                ? `<div class="grp-empty">没有匹配的群</div>`
                : list.map((g) => `<label class="grp-row">
                    <input type="checkbox" data-funwxid="${esc(g.wxid)}" ${fh.has(g.wxid) ? 'checked' : ''} />
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.display)}</span>
                    <span class="tag">${g.isGroup ? '群聊' : '联系人'}</span>
                  </label>`).join('');
            })()}
      </div>
    </div>

    <div class="s-block">
      <div class="s-title">📅 学期开始日期</div>
      <div class="s-desc">填第一周的周一。这样通知里写「第十周」「第十五周」时，AI 能自己换算成具体日期。</div>
      <input type="date" class="s-input" id="termStart" value="${app.data.settings.termStart || ''}" style="width:100%" />
      <div class="dl-hint" style="margin-top:8px">不知道的话留空，周次类通知的截止时间会变成「待定」，你可以手动改。</div>
    </div>

    <div class="s-block">
      <div class="s-title">🔎 往回看多久</div>
      <div class="s-desc">每次整理读取最近这段时间的消息。太短可能漏，太长会慢。</div>
      <select class="s-select" id="lookback">
        ${[[6,'最近 6 小时'],[12,'最近 12 小时'],[24,'最近 1 天'],[48,'最近 2 天'],[72,'最近 3 天'],[168,'最近 7 天'],[720,'最近 30 天'],[8760,'全部历史']].map(([h, label]) => `<option value="${h}" ${Number(app.data.settings.lookbackHours) === h ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>

    <div class="s-block">
      <div class="s-title">🖼️ 图片里的文字</div>
      <div class="s-desc">已停用。原来的图片文字识别走的是本机 codex 多模态，会消耗 ds token；现在整理全部由 WorkBuddy 完成，只处理文字消息。以后要看图时会由 WorkBuddy 自己识别。</div>
      <label class="switch" hidden><input type="checkbox" id="ocrToggle" /></label>
    </div>

    <div class="s-block">
      <div class="s-title">🤖 谁来整理</div>
      <div class="s-desc">点「立即整理」或到点自动整理时，应用会直接调用模型当场完成分类、总结和截止判断，结果立刻写回。没有本地规则兜底，也不调用 codex / ds。</div>
      <select class="s-select" id="organizeBackend" style="width:100%;margin-top:8px">
        ${[['auto','自动（优先 WorkBuddy，其次 DeepSeek）'],['workbuddy','WorkBuddy 命令行'],['deepseek','DeepSeek API'],['queue','只写请求，交给外部 AI 接手']]
          .map(([v,label]) => `<option value="${v}" ${String(app.data.settings.organizeBackend||'auto') === v ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      <div class="s-desc" style="margin-top:8px">当前后端：<strong>${esc(app.data.env?.backend || '未知')}</strong>${app.data.env?.workbuddyCli ? ' · 已找到 WorkBuddy 命令行' : ''}${app.data.env?.deepseekConfigured ? ' · 已配置 DeepSeek Key' : ''}</div>
      <input class="s-input" id="deepseekKey" type="password" placeholder="DeepSeek API Key（只存本机，留空则不启用）" value="${esc(app.data.settings.deepseekApiKey || '')}" style="width:100%;margin-top:8px" />
      <input class="s-input" id="deepseekModel" placeholder="模型名，默认 deepseek-chat" value="${esc(app.data.settings.deepseekModel || 'deepseek-chat')}" style="width:100%;margin-top:8px" />
      <div class="dl-hint" style="margin-top:8px">用 WorkBuddy 命令行需先完成一次 /login；用 DeepSeek API 会产生接口费用。</div>
      <label class="switch" hidden><input type="checkbox" id="aiToggle" /></label>
    </div>

    <div class="s-block">
      <div class="s-title">🔄 检查更新</div>
      <div class="s-desc">当前版本 <strong>${esc(app.data.env?.version || '—')}</strong>。从 GitHub 仓库读取最新版本；只提示，不会自动覆盖你的代码和 data 数据。</div>
      <button class="btn ghost" id="checkUpdateBtn" style="margin-top:8px">检查更新</button>
      <div class="dl-hint" id="updateResult" style="margin-top:8px"></div>
    </div>

    <div class="s-block">
      <div class="s-title">📋 最近整理</div>
      <div class="run-log">${renderRunLog()}</div>
    </div>

  `;

  bindSettings();
}

function renderRunLog() {
  const runs = app.data.runs || [];
  if (!runs.length) return '还没有整理记录。';
  return runs.slice(0, 5).map((r) => {
    const t = new Date(r.at);
    const when = `${t.getMonth() + 1}/${t.getDate()} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    if (r.engine === 'none') return `<div>${when} · 没有新消息</div>`;
    return `<div>${when} · 读了 <b>${r.totalMsgs || 0}</b> 条，整理出 <b>${r.items || 0}</b> 条通知${r.added ? `（新增 ${r.added}）` : ''}</div>`;
  }).join('');
}

function bindSettings() {
  const d = app.draft;
  $('addTime').onclick = () => {
    const v = $('newTime').value;
    if (v && !d.times.includes(v)) { d.times.push(v); d.times.sort(); renderSettings(); }
  };
  $('timeChips').addEventListener('click', (e) => {
    const t = e.target.dataset?.del;
    if (t) { d.times = d.times.filter((x) => x !== t); renderSettings(); }
  });
  $('daysSeg').onclick = (e) => {
    const v = e.target.dataset?.days;
    if (v) { d.days = v; renderSettings(); }
  };
  const search = $('grpSearch');
  search.oninput = () => {
    app.groupQuery = search.value;
    const sel = document.getElementById('grpList');
    const q = search.value.toLowerCase();
    const groups = app.groupCache || [];
    const chosen = new Map(d.groups.map((g) => [g.wxid, g]));
    const filtered = groups.filter((g) => !q || g.display.toLowerCase().includes(q));
    sel.innerHTML = filtered.length === 0
      ? `<div class="grp-empty">没有匹配的群</div>`
      : filtered.map((g) => `<label class="grp-row">
          <input type="checkbox" data-wxid="${esc(g.wxid)}" ${chosen.has(g.wxid) ? 'checked' : ''} />
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.display)}</span>
          <span class="tag">${g.isGroup ? '群聊' : '联系人'}</span>
        </label>`).join('');
  };
  // 娱乐群搜索与勾选
  const funSearch = $('funSearch');
  if (funSearch) {
    funSearch.oninput = () => {
      const q = funSearch.value.toLowerCase();
      const list = (app.groupCache || []).filter((g) => !q || g.display.toLowerCase().includes(q));
      const chosen = new Map(d.funGroups.map((g) => [g.wxid, g]));
      $('funList').innerHTML = list.length === 0
        ? `<div class="grp-empty">没有匹配的群</div>`
        : list.map((g) => `<label class="grp-row">
            <input type="checkbox" data-funwxid="${esc(g.wxid)}" ${chosen.has(g.wxid) ? 'checked' : ''} />
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.display)}</span>
            <span class="tag">${g.isGroup ? '群聊' : '联系人'}</span>
          </label>`).join('');
    };
  }
  const funList = $('funList');
  if (funList) {
    funList.addEventListener('change', (e) => {
      const cb = e.target;
      if (cb.type !== 'checkbox') return;
      const wxid = cb.dataset.funwxid;
      const g = (app.groupCache || []).find((x) => x.wxid === wxid);
      if (!g) return;
      if (cb.checked) {
        if (!d.funGroups.some((x) => x.wxid === wxid)) d.funGroups.push({ wxid, name: g.display });
      } else {
        d.funGroups = d.funGroups.filter((x) => x.wxid !== wxid);
      }
      const t = funList.parentElement.querySelector('.s-title span');
      if (t) t.textContent = `已选 ${d.funGroups.length} 个`;
    });
  }

  $('grpList').addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox') return;
    const wxid = cb.dataset.wxid;
    const g = (app.groupCache || []).find((x) => x.wxid === wxid);
    if (!g) return;
    if (cb.checked) {
      if (!d.groups.some((x) => x.wxid === wxid)) d.groups.push({ wxid, name: g.display });
    } else {
      d.groups = d.groups.filter((x) => x.wxid !== wxid);
    }
    const cnt = document.querySelector('.s-title span');
    if (cnt) cnt.textContent = `已选 ${d.groups.length} 个`;
  });
  const checkBtn = $('checkUpdateBtn');
  if (checkBtn) {
    checkBtn.onclick = async () => {
      const box = $('updateResult');
      box.textContent = '正在检查…';
      const r = await api('/api/update/check', { method: 'POST' });
      if (!r.ok) { box.textContent = r.error || '检查失败'; return; }
      if (!r.hasUpdate) { box.textContent = `已是最新版本（${r.current}）`; return; }
      box.innerHTML = `发现新版本 <strong>${esc(r.latest)}</strong>（当前 ${esc(r.current)}）<br/>${esc(r.notes || '')}`;
      const go = document.createElement('button');
      go.className = 'btn primary';
      go.textContent = '打开 GitHub';
      go.style.marginTop = '8px';
      go.onclick = () => api('/api/open', { method: 'POST', body: JSON.stringify({ url: r.url }) });
      box.appendChild(document.createElement('br'));
      box.appendChild(go);
    };
  }

  $('saveSettings').onclick = async () => {
    const body = {
      times: d.times,
      days: d.days,
      groups: d.groups,
      lookbackHours: Number($('lookback').value),
      funGroups: d.funGroups,
      aiEnabled: $('aiToggle').checked,
      ocrImages: $('ocrToggle').checked,
      termStart: $('termStart').value || null,
      organizeBackend: $('organizeBackend').value,
      deepseekApiKey: $('deepseekKey').value.trim(),
      deepseekModel: $('deepseekModel').value.trim(),
    };
    const res = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) {
      toast('设置已保存');
      closeSettings();
      load({ quiet: true });
    } else {
      toast('保存失败');
    }
  };
  $('cancelSettings').onclick = closeSettings;
}

// ── 杂项 ──────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function updateCountdowns() {
  document.querySelectorAll('.card').forEach((card) => {
    const n = notices().find((x) => x.id === card.dataset.id);
    if (!n) return;
    const cd = countdownOf(n.deadline);
    const el = card.querySelector('.countdown');
    if (el) {
      el.textContent = cd.text;
      el.className = 'countdown ' + (n.status === 'todo' ? 'todo-' + cd.cls : cd.cls);
    }
  });
  if (app.selectedId && !$('drawer').hidden) renderDetail();
}

// ── 事件绑定 ──────────────────────────────────────────────
$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  if (btn.dataset.funtab) { app.funTab = btn.dataset.funtab; render(); return; }
  app.tab = btn.dataset.tab;
  render();
});

$('modeSwitch').addEventListener('click', (e) => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.dataset.mode === app.mode) return;
  app.mode = b.dataset.mode;
  app.selectedId = null;
  closeDetail();
  render();
});

$('grid').addEventListener('click', (e) => {
  const funCard = e.target.closest('[data-funid]');
  if (funCard) { openDetail(funCard.dataset.funid); return; }
  const act = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!card) return;
  if (act) {
    e.stopPropagation();
    const a = act.dataset.act;
    if (a === 'restore') restoreNotice(card.dataset.id);
    else if (a === 'delete') deleteNotice(card.dataset.id);
    else setStatus(card.dataset.id, a);
    return;
  }
  openDetail(card.dataset.id);
});

$('drawer').addEventListener('click', (e) => {
  const act = e.target.closest('[data-dact]');
  if (act && app.selectedId) {
    const a = act.dataset.dact;
    if (a === 'restore') restoreNotice(app.selectedId);
    else if (a === 'delete') deleteNotice(app.selectedId);
    else { setStatus(app.selectedId, a); renderDetail(); }
  }
});

$('mask').onclick = () => {
  if (!$('settingsDrawer').hidden) closeSettings();
  else closeDetail();
};

$('runBtn').onclick = async () => {
  if (app.mode === 'fun') {
    if (!(app.data.settings.funGroups || []).length) { openSettings(); toast('先选几个娱乐群'); return; }
    const res = await api('/api/fun/run', { method: 'POST' });
    if (res.ok) { toast('正在整理娱乐群…'); load({ quiet: true }); }
    else toast(res.error || '开始失败');
    return;
  }
  if (!app.data.settings.groups.length) { openSettings(); toast('先选几个要整理的群'); return; }
  const res = await api('/api/run', { method: 'POST' });
  if (res.ok) { toast('正在由 WorkBuddy 整理…'); load({ quiet: true }); }
  else toast(res.error || '开始失败');
};

$('settingsBtn').onclick = openSettings;
$('closeSettings').onclick = closeSettings;
$('clearArchiveBtn').onclick = clearArchive;
$('emptyAction').onclick = () => {
  if (app.mode === 'fun') {
    if (!(app.data?.settings?.funGroups || []).length) openSettings();
    else $('runBtn').click();
    return;
  }
  if (app.tab === 'archive') { app.tab = 'all'; render(); return; }
  if (!(app.data?.settings?.groups || []).length) openSettings();
  else $('runBtn').click();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('settingsDrawer').hidden) closeSettings();
    else if (!$('drawer').hidden) closeDetail();
  }
});

// ── 启动 ──────────────────────────────────────────────────
load();
app.tickTimer = setInterval(updateCountdowns, 20000);