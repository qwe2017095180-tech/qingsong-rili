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
  tab: 'today',
  selectedDay: new Date(),
  calendarExpanded: false,
  funTab: 'all',
  selectedId: null,
  settingsTab: 'groups',   // groups | ai | connect | updates
  settingsGroupMode: 'notice', // notice | fun
  groupCache: null,
  groupLoading: false,
  groupQuery: '',
  disconnected: false,
  draft: null,
  pollTimer: null,
  tickTimer: null,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 会话最后活跃时间：秒级时间戳 → 相对描述
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  const d = new Date(ts * 1000);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── 时间工具 ──────────────────────────────────────────────
function parseDeadline(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59, 0, 0);
  return isNaN(d.getTime()) ? null : d;
}

function localDayKey(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
}

function noticeDayKey(notice) {
  if (!['new', 'todo', 'done'].includes(notice.status)) return null;
  const deadline = parseDeadline(notice.deadline);
  const date = deadline || (notice.status !== 'new' && notice.createdAt ? new Date(notice.createdAt) : null);
  return date ? localDayKey(date) : null;
}

function isOnSelectedDay(notice) {
  return noticeDayKey(notice) === localDayKey(app.selectedDay);
}

function dayAtOffset(date, offset) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
}

function renderDayBar() {
  const shown = app.mode === 'notice' && app.tab === 'today';
  $('dayBar').hidden = !shown;
  if (!shown) return;

  const selected = localDayKey(app.selectedDay);
  const today = localDayKey(new Date());
  const date = app.selectedDay.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  $('dayTitle').textContent = date;
  $('agendaTitleHeading').textContent = selected === today ? '今日日程' : '当日日程';

  const days = new Map();
  for (const notice of notices()) {
    const key = noticeDayKey(notice);
    if (key === null) continue;
    const counts = days.get(key) || { total: 0, done: 0 };
    counts.total++;
    if (notice.status === 'done') counts.done++;
    days.set(key, counts);
  }
  const counts = days.get(selected);
  $('dayProgress').textContent = counts ? `已完成 ${counts.done}/${counts.total} 项` : '';
  const expanded = app.calendarExpanded;
  const start = dayAtOffset(app.selectedDay, -app.selectedDay.getDay() - (expanded ? 7 : 0));
  $('calendarDays').innerHTML = Array.from({ length: expanded ? 35 : 7 }, (_, index) => {
    const day = dayAtOffset(start, index);
    const key = localDayKey(day);
    const state = days.get(key);
    const allDone = state && state.done === state.total;
    return `<button type="button" class="calendar-day" data-day="${key}" aria-pressed="${key === selected}"
      aria-label="${key}${allDone ? '，日程已全部完成' : ''}" ${key === today ? 'aria-current="date"' : ''}>
      ${day.getDate() === 1 ? `<small>${day.getMonth() + 1}月</small>` : ''}
      <span>${day.getDate()}</span>${allDone ? '<i class="calendar-done" aria-hidden="true"></i>' : ''}
    </button>`;
  }).join('');
  $('calendarToggle').setAttribute('aria-expanded', expanded);
  $('calendarToggle').textContent = expanded ? '收起日历' : '展开日历';
  $('prevDay').setAttribute('aria-label', expanded ? '向前五周' : '上一周');
  $('nextDay').setAttribute('aria-label', expanded ? '向后五周' : '下一周');
}

function shiftCalendar(direction) {
  app.selectedDay = dayAtOffset(app.selectedDay, direction * (app.calendarExpanded ? 35 : 7));
  render();
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
  $('navDate').textContent = new Date().getDate();
  const view = app.tab === 'today' ? 'today' : 'all';
  for (const button of $('modeSwitch').querySelectorAll('[data-mode]')) {
    const active = button.dataset.mode === app.mode && (button.dataset.view ?? view) === view;
    button.classList.toggle('on', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
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
  const meetups = (n.meetups || []).slice(0, 2);
  const when = n.updatedAt
    ? (() => { const d = new Date(n.updatedAt); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()
    : '';
  const vibe = n.vibe || '群聊';
  return `<article class="card fun group-card" data-funid="${n.id}" style="animation-delay:${Math.random() * 0.08}s">
    <div class="card-top">
      <span class="badge fun-vibe">💬 ${esc(vibe)}</span>
      <span class="src">${n.messageCount ? `${n.messageCount} 条消息` : '暂无新消息'}</span>
    </div>
    <h3 class="card-title">${esc(n.group)}</h3>
    ${n.hotspot ? `<div class="fun-hotspot">🔥 ${esc(n.hotspot)}</div>` : ''}
    <p class="summary">${esc(n.summary || '')}</p>
    ${meetups.length ? `<div class="fun-meetup">📅 ${meetups.map((m) => esc(m)).join(' · ')}</div>` : ''}
    ${hi.length ? `<ul class="fun-hi">${hi.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <div class="card-foot"><span class="deadline none">🕒 更新于 ${when}${n.engine && n.engine !== 'none' ? ` · ${esc(n.engine)}` : ''}</span></div>
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
    $('emptyText').innerHTML = `已经选好 ${groups.length} 个娱乐群，点「立即整理」，<br/>我会用 AI 给每个群写一份像真人群友复盘一样的省流总结。`;
    $('emptyAction').textContent = '立即整理';
    return;
  }
  empty.hidden = true;
}

// ── 数据 ──────────────────────────────────────────────────
function isNetworkFetchError(err) {
  const msg = String((err && err.message) || err || '');
  return err?.name === 'TypeError' || /failed to fetch|load failed|networkerror|network request failed/i.test(msg);
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch (err) {
    if (isNetworkFetchError(err)) {
      const netErr = new Error('连不上本地服务，请确认「轻松日程」启动窗口还在运行');
      netErr.isNetwork = true;
      throw netErr;
    }
    throw err;
  }
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`服务返回异常（HTTP ${res.status}）`);
  }
}

let prevRunning = false;
let lastSeenRunId = null;   // 已提示过的整理批次；首次加载只记录不提示
let lastSeenFunRunAt = null;

function afterRun(data) {
  const running = Boolean(data.state?.running);
  prevRunning = running;
  if (!running) {
    const r = data.state?.lastResult;
    if (r && r.runId) {
      // 首次加载：把当前结果记为已读，避免一进页面就弹上一次的提示
      if (lastSeenRunId === null) {
        lastSeenRunId = r.runId;
      } else if (r.runId !== lastSeenRunId) {
        lastSeenRunId = r.runId;
        if (r.engine === 'none') {
          toast(r.note || '整理完成，这段时间没有新内容', 3600);
        } else if (r.error) {
          toast(r.error, 5000);
        } else if ((r.items || 0) > 0) {
          const isManualAdd = r.type === 'manual';
          toast(isManualAdd
            ? `整理完成 · ${r.items} 条待办已加入 🎉`
            : `整理完成 · ${r.items} 条通知${r.added ? `（新增 ${r.added}）` : ''} 🎉`);
          app.tab = isManualAdd ? 'todo' : 'all';
          render();
        } else {
          toast(`整理完成 · 读了 ${r.totalMsgs || 0} 条消息，${r.note || '没有可整理的新通知'}`, 3600);
        }
      }
    }
  }

  const fun = data.fun;
  if (fun && !fun.running && fun.lastResult?.at) {
    if (lastSeenFunRunAt === null) {
      lastSeenFunRunAt = fun.lastResult.at;
    } else if (fun.lastResult.at !== lastSeenFunRunAt) {
      lastSeenFunRunAt = fun.lastResult.at;
      if (fun.error) {
        toast(fun.error, 5000);
      } else {
        toast(`娱乐群总结完成 · 已更新 ${fun.lastResult.ok || 0} 个群 🎉`, 3200);
      }
    }
  }
}

async function load({ quiet = false } = {}) {
  try {
    const data = await api('/api/state');
    const wasDisconnected = app.disconnected;
    app.disconnected = false;
    app.data = data;
    render();
    afterRun(data);
    if (typeof maybeOpenOnboarding === 'function') maybeOpenOnboarding();
    if (wasDisconnected) {
      toast('已重新连上本地服务');
      if ($('settingsDialog')?.open && app.groupError) retryGroups();
    }
  } catch (e) {
    const firstDisconnect = !app.disconnected;
    app.disconnected = true;
    if (!quiet || firstDisconnect) {
      toast(e?.isNetwork ? '连不上本地服务，请确认启动窗口还开着' : (e?.message || '读取状态失败'));
    }
  } finally {
    schedulePoll();
  }
}

function schedulePoll() {
  clearTimeout(app.pollTimer);
  const running = Boolean(app.data?.state?.running || app.data?.fun?.running);
  const ms = app.disconnected ? 5000 : (running ? 1800 : 30000);
  app.pollTimer = setTimeout(() => load({ quiet: true }), ms);
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
  const { settings, state, env } = app.data;

  $('nextRun').textContent = app.mode === 'fun' ? funNextRunText() : nextRunText(settings);
  $('runBtn').disabled = app.mode === 'fun' ? Boolean(app.data.fun?.running) : state.running;

  const strip = $('setupStrip');
  if (strip) {
    const needsSetup = !env?.ready || !env?.wechatReady;
    const dismissed = sessionStorage.getItem('qs_strip_dismissed') === '1';
    strip.hidden = !needsSetup || dismissed;
    if (!strip.hidden && $('setupStripText')) {
      $('setupStripText').textContent = !env?.wechatReady
        ? '👋 本机微信读取环境尚未就绪，点右侧「打开向导」2 分钟配置好。'
        : '👋 还没配置 AI 整理渠道（默认 DeepSeek），点右侧「打开向导」填入 Key 即可。';
    }
  }

  updateRunBar(state);
  renderDayBar();
  renderModeSwitch();

  if (app.mode === 'fun') {
    $('tabs').hidden = false;
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

  const activeErr = app.mode === 'fun'
    ? (app.data?.fun?.running ? null : app.data?.fun?.error)
    : (state.running ? null : state.error);
  if (activeErr) {
    if (!app._lastErr || app._lastErr !== activeErr) {
      app._lastErr = activeErr;
      toast(activeErr, 4200);
    }
  } else {
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

  bar.classList.remove('queued');
  const pulse = bar.querySelector('.pulse');
  const track = bar.querySelector('.runbar-track');
  if (pulse) pulse.style.display = '';
  if (track) track.style.display = '';
  $('runText').textContent = phase || '正在整理…';
  let pct = 12;
  const m = String(phase || '').match(/(\d+)\s*\/\s*(\d+)/);
  if (m) pct = 22 + (+m[1] / +m[2]) * 52;
  else if (/同步/.test(phase)) pct = 16;
  else if (/正在由|总结|WorkBuddy|分类整理|整理娱乐|正在整理/.test(phase)) pct = 78;
  else if (/保存/.test(phase)) pct = 94;
  $('runFill').style.width = pct + '%';
}

function renderTabs() {
  const tabs = [
    { id: 'all', label: '全部', emoji: '' },
    { id: 'todo', label: '待办', emoji: '⏳' },
    ...CATS.map((c) => ({ id: c, label: c, emoji: CAT_META[c].emoji })),
    { id: 'archive', label: '归档', emoji: '🗃️' },
  ];
  $('tabs').hidden = app.tab === 'today';
  $('tabs').innerHTML = tabs.map((t) => {
    const n = tabCount(t.id);
    return `<button class="tab ${app.tab === t.id ? 'active' : ''}" data-tab="${t.id}">
      ${t.emoji ? `<span>${t.emoji}</span>` : ''}${t.label}${n ? `<span class="n">${n}</span>` : ''}
    </button>`;
  }).join('');
}

function visibleNotices() {
  const list = notices().slice();
  const statusRank = { new: 0, todo: 1, done: 2, skip: 3 };   // 未处理的新通知排最前
  const dl = (n) => { const d = parseDeadline(n.deadline); return d ? d.getTime() : 9e15; };
  if (app.tab === 'today') {
    const order = (n) => /[:：]\d{2}/.test(n.deadline || '') ? dl(n) : Infinity;
    return list.filter(isOnSelectedDay).sort((a, b) =>
      Number(a.status === 'done') - Number(b.status === 'done')
      || order(a) - order(b)
      || a.title.localeCompare(b.title, 'zh-CN'));
  }
  if (app.tab === 'all') {
    list.sort((a, b) => {
      const ra = statusRank[a.status] ?? 1;
      const rb = statusRank[b.status] ?? 1;
      if (ra !== rb) return ra - rb;
      // 新通知没有截止时间，按收录时间倒序，刚整理出来的排最上面
      if (a.status === 'new' && b.status === 'new') return (b.createdAt || 0) - (a.createdAt || 0);
      return dl(a) - dl(b);
    });
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
  const agenda = app.tab === 'today';
  const done = n.status === 'done';
  const statusCls = agenda ? 'status-agenda' : archived ? 'status-archived' : '';
  const check = agenda ? `<button class="card-check" data-act="${done ? 'restore' : 'done'}"
    aria-pressed="${done}" title="${done ? '标为未完成' : '标为完成'}"
    aria-label="${done ? '标为未完成' : '标为完成'}：${esc(n.title)}">${done ? '✓' : ''}</button>` : '';
  const actions = agenda ? '' : archived
    ? `<button class="act main" data-act="restore">↩ 恢复到列表</button>
       <button class="act warn" data-act="delete">删除</button>`
    : n.status === 'todo'
      ? `<button class="act main" data-act="done">✓ 完成</button>
         <button class="act" data-act="new">移回通知</button>`
      : `<button class="act main" data-act="todo">加入待办</button>
         <button class="act warn" data-act="skip">不参加 / 忽略</button>`;

  const footLeft = archived && !agenda
    ? `<span class="archive-note">🗃️ ${n.status === 'done' ? '已完成' : '已忽略'} · ${archiveDaysLeft(n)} 天后自动清理</span>`
    : `<span class="deadline ${hasDl ? '' : 'none'}">🕒 ${hasDl ? fmtDeadline(n.deadline) : '没有明确截止时间'}</span>`;
  const footRight = archived || agenda ? '' : `<span class="countdown ${n.status === 'todo' ? 'todo-' + cd.cls : cd.cls}">${cd.text}</span>`;

  return `<article class="card cat-${meta.cls} ${statusCls}" data-id="${esc(n.id)}">
    <div class="card-top">
      <span class="badge">${meta.emoji} ${esc(n.category)}</span>
      <span class="src">${esc(n.group === 'iBetter' ? '轻松打卡' : n.group || '来源未知')}</span>
      ${check}
    </div>
    <h3 class="card-title"><a href="#" data-open-detail>${esc(n.title)}</a>${!agenda && n.status === 'todo' ? '<span class="todo-flag">待办中</span>' : ''}</h3>
    <p class="summary">${esc(n.summary || n.detail || '')}</p>
    <div class="card-foot">
      ${footLeft}
      ${footRight}
    </div>
    ${actions ? `<div class="card-actions">${actions}</div>` : ''}
  </article>`;
}

function renderEmpty(state) {
  const list = notices();
  const empty = $('empty');
  const gridEmpty = visibleNotices().length === 0;
  const groups = app.data?.settings?.groups || [];
  if (app.tab === 'today') {
    empty.hidden = !gridEmpty;
    $('emptyTitle').textContent = '这一天还没有日程';
    $('emptyText').textContent = '可以添加一条日程，或在「全部」查看整理出的通知。';
    $('emptyAction').textContent = '添加日程';
  } else if (!groups.length && gridEmpty) {
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
  if (n) { Object.assign(n, res.notice); delete n.archivedAt; delete n.prevStatus; }
  render();
  toast(app.tab === 'today' ? '已标为未完成' : '已恢复到列表');
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
  try {
    const res = await api('/api/notice', { method: 'POST', body: JSON.stringify({ id, status }) });
    if (!res.ok) throw new Error(res.error);
    const notice = notices().find((x) => x.id === id);
    if (notice) {
      Object.assign(notice, res.notice);
      if (!res.notice.archivedAt) delete notice.archivedAt;
      if (!res.notice.prevStatus) delete notice.prevStatus;
    }
    render();
    if (status === 'todo') toast(parseDeadline(res.notice.deadline) ? '已加入待办，倒计时开始 ⏳' : '已加入待办 ✓');
  } catch (error) {
    toast(error.message || '保存失败');
    load({ quiet: true });
    return;
  }
  if (status === 'skip') toast('已归档，7 天后自动清理');
  if (status === 'done') toast('已完成');
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
  if ($('addDrawer').hidden) $('mask').hidden = true;
}

function renderFunDetail(n) {
  const when = n.updatedAt
    ? (() => { const d = new Date(n.updatedAt); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()
    : '';
  const topics = Array.isArray(n.topics) ? n.topics : [];
  const meetups = Array.isArray(n.meetups) ? n.meetups : [];
  $('drawer').innerHTML = `
    <div class="drawer-head">
      <div>
        <div class="d-meta">
          <span class="badge fun-vibe">💬 ${esc(n.vibe || '群聊总结')}</span>
          <span class="d-src">${n.messageCount ? `${n.messageCount} 条消息 · ` : ''}${when}${n.engine && n.engine !== 'none' ? ` · ${esc(n.engine)}` : ''}</span>
        </div>
        <h2 class="d-title">${esc(n.group)}</h2>
      </div>
      <button class="close" id="closeDrawer">×</button>
    </div>
    <div class="drawer-body">
      <div class="d-section">
        <div class="d-label">省流总述</div>
        <div class="d-text">${esc(n.summary || '（没有总结）')}</div>
      </div>
      ${n.hotspot ? `<div class="d-section">
        <div class="d-label">最热话题</div>
        <div class="d-action"><span class="ico">🔥</span><span>${esc(n.hotspot)}</span></div>
      </div>` : ''}
      ${meetups.length ? `<div class="d-section">
        <div class="d-label">约局与活动</div>
        ${meetups.map((m) => `<div class="fun-meetup">📅 ${esc(m)}</div>`).join('')}
      </div>` : ''}
      ${topics.length ? `<div class="d-section">
        <div class="d-label">聊了什么</div>
        <div class="fun-topics">
          ${topics.map((t) => `<div class="fun-topic-card">
            <div class="fun-topic-title">${esc(t.title)}</div>
            <div class="fun-topic-detail">${esc(t.detail)}</div>
          </div>`).join('')}
        </div>
      </div>` : ''}
      ${(n.highlights || []).length ? `<div class="d-section">
        <div class="d-label">看点与结论</div>
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
          <span class="d-src">来自「${esc(n.group === 'iBetter' ? '轻松打卡' : n.group || '未知群')}」</span>
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

// ── 设置弹窗 ──────────────────────────────────────────────
function openSettings() {
  const s = app.data?.settings;
  if (!s) return;
  app.draft = {
    times: [...(s.times || [])],
    days: s.days || 'daily',
    groups: (s.groups || []).map((g) => ({ ...g })),
    funGroups: (s.funGroups || []).map((g) => ({ ...g })),
    updateMirror: s.updateMirror || '',
  };
  renderSettings();
  const dlg = $('settingsDialog');
  if (dlg && !dlg.open) dlg.showModal();
  loadGroups();
}

function closeSettings() {
  const dlg = $('settingsDialog');
  if (dlg?.open) dlg.close();
  app.draft = null;
}

ModalQueue.bindBackdropClose($('settingsDialog'), { onClose: closeSettings });
$('settingsDialog')?.addEventListener('close', () => {
  app.draft = null;
});

function updateSettingsGroupListUi() {
  const listEl = $('settingsGrpList');
  if (listEl) listEl.innerHTML = renderSettingsGroupListHtml();
  const d = app.draft;
  if (d) {
    if ($('settingsGrpNoticeTab')) $('settingsGrpNoticeTab').textContent = `📚 通知群 (${d.groups.length})`;
    if ($('settingsGrpFunTab')) $('settingsGrpFunTab').textContent = `🎮 娱乐群 (${d.funGroups.length})`;
  }
}

async function loadGroups({ force = false } = {}) {
  if (!force && app.groupCache && app.groupCache.length) {
    updateSettingsGroupListUi();
    return true;
  }
  if (app.groupLoading) return false;
  app.groupLoading = true;
  if (force) {
    app.groupCache = null;
    app.groupError = null;
    const listEl = $('settingsGrpList');
    if (listEl) listEl.innerHTML = '<div class="grp-empty">正在重新拉取微信群列表…</div>';
  }
  $('settingsGrpList')?.classList.add('loading');
  app.groupError = null;
  try {
    const res = await api('/api/groups', { method: 'POST' });
    app.groupCache = Array.isArray(res.chats) ? res.chats : [];
    if (res.ok === false) app.groupError = res.error || '读取失败';
  } catch (err) {
    app.groupCache = [];
    app.groupError = err?.isNetwork
      ? '连不上本地服务，请确认「轻松日程」启动窗口还在运行'
      : String((err && err.message) || err || '读取失败').slice(0, 200);
  } finally {
    app.groupLoading = false;
    $('settingsGrpList')?.classList.remove('loading');
    updateSettingsGroupListUi();
  }
  return !app.groupError;
}

// 供设置弹窗里的「🔄 刷新群聊」与「重试」按钮调用
async function retryGroups() {
  const btn = $('settingsGrpRefresh');
  if (app.groupLoading) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '刷新中…';
  }
  try {
    if (app.disconnected || !app.data) await load({ quiet: true });
    const ok = await loadGroups({ force: true });
    if (ok) toast(`已刷新，读取到 ${(app.groupCache || []).length} 个微信会话`);
    else if (app.groupError) toast(`刷新群聊失败：${app.groupError}`);
  } finally {
    const curBtn = $('settingsGrpRefresh');
    if (curBtn) {
      curBtn.disabled = false;
      curBtn.textContent = '🔄 刷新群聊';
    }
  }
}

function groupEmptyHtml() {
  if (!app.groupError) return '<div class="grp-empty">正在读取微信群列表…</div>';
  return `<div class="grp-empty">读取失败：${esc(app.groupError)}<br/><button class="btn ghost" onclick="retryGroups()" style="margin-top:10px;padding:6px 14px">重试</button></div>`;
}

function renderSettingsGroupListHtml() {
  const d = app.draft;
  if (!d) return '<div class="grp-empty">正在读取微信群列表…</div>';
  const all = app.groupCache || [];
  if (!all.length) return groupEmptyHtml();
  const isFun = app.settingsGroupMode === 'fun';
  return buildGroupListHtml({
    chats: all,
    chosenList: isFun ? d.funGroups : d.groups,
    isFun,
    query: app.groupQuery,
    emptyHtml: groupEmptyHtml(),
    checkboxAttr: 'data-sgwxid',
  });
}

function renderSettings() {
  const d = app.draft;
  if (!d) return;
  const env = app.data?.env || {};
  const tab = app.settingsTab || 'groups';
  const activePid = env.provider || 'deepseek';
  const bridge = app.data?.bridge;

  $('settingsBody').innerHTML = `
    <div class="seg settings-tabs" id="settingsTabs" role="tablist">
      <button type="button" class="${tab === 'groups' ? 'on' : ''}" data-stab="groups">群聊与定时</button>
      <button type="button" class="${tab === 'ai' ? 'on' : ''}" data-stab="ai">AI 渠道</button>
      <button type="button" class="${tab === 'connect' ? 'on' : ''}" data-stab="connect">联动与向导</button>
      <button type="button" class="${tab === 'updates' ? 'on' : ''}" data-stab="updates">更新与日志</button>
    </div>

    <!-- 1. 群聊与定时 -->
    <div class="settings-pane" data-spane="groups" ${tab === 'groups' ? '' : 'hidden'}>
      <div class="s-block">
        <div class="s-title">👥 监听哪些群</div>
        ${renderGroupPickerHtml({
          idPrefix: 'settingsGrp',
          activeMode: app.settingsGroupMode,
          noticeCount: d.groups.length,
          funCount: d.funGroups.length,
          query: app.groupQuery,
          listHtml: renderSettingsGroupListHtml(),
        })}
      </div>

      <div class="s-block">
        <div class="s-title">⏰ 自动整理与范围</div>
        <div class="s-desc">到点自动读取群消息并整理通知。可以添加多个时刻。</div>
        <div class="chips" id="timeChips">
          ${d.times.map((t) => `<span class="time-chip">${t}<button type="button" data-del="${t}">×</button></span>`).join('')}
          <input type="time" id="newTime" value="08:00" />
          <button type="button" class="btn ghost" id="addTime" style="padding:8px 14px">+ 添加</button>
        </div>
        <div style="margin-top:12px" class="seg" id="daysSeg">
          <button type="button" data-days="daily" class="${d.days === 'daily' ? 'on' : ''}">每天</button>
          <button type="button" data-days="weekday" class="${d.days === 'weekday' ? 'on' : ''}">仅工作日</button>
        </div>
        <div class="settings-inline-grid" style="margin-top:14px">
          <label>
            <span>🔎 往回看多久</span>
            <select class="s-select" id="lookback">
              ${[[6,'最近 6 小时'],[12,'最近 12 小时'],[24,'最近 1 天'],[48,'最近 2 天'],[72,'最近 3 天'],[168,'最近 7 天'],[720,'最近 30 天'],[8760,'全部历史']].map(([h, label]) => `<option value="${h}" ${Number(app.data.settings.lookbackHours) === h ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>📅 学期第一周周一（可选）</span>
            <input type="date" class="s-input" id="termStart" value="${app.data.settings.termStart || ''}" />
          </label>
        </div>
      </div>
    </div>

    <!-- 2. AI 渠道 -->
    <div class="settings-pane" data-spane="ai" ${tab === 'ai' ? '' : 'hidden'}>
      <div class="s-block">
        <div class="s-title">🤖 模型渠道商（默认 DeepSeek）</div>
        <div class="s-desc">通知提取与娱乐群总结都会使用当前选择的渠道；各渠道的 Key 独立保存在本机，切换不丢失。</div>
        <div class="ai-status-row">
          <span class="ai-status-name">${providerIconHtml(activePid, 20)}<span>当前：<strong>${esc(env.providerFullName || 'DeepSeek')}</strong> ${env.ready ? '<span class="ok-dot">● 已就绪</span>' : '<span class="warn-dot">● 待配置</span>'}</span></span>
          <button type="button" class="btn ghost mirror-chip" id="openSetupGuideBtn">配置引导</button>
        </div>
        <input type="hidden" id="aiProvider" value="${esc(activePid)}" />
        <div class="provider-grid settings-provider-grid" id="settingsProviderGrid">
          ${buildProviderGridHtml({ providers: env.providers || [], activeId: activePid, attrName: 'data-settings-provider' })}
        </div>
        <div id="settingsApiFields">
          <div class="provider-tip" id="settingsProviderTip" style="margin-top:10px"></div>
          <div style="display:flex;justify-content:flex-end;margin-top:8px">
            <a id="settingsConsoleLink" class="setup-link" target="_blank" rel="noopener noreferrer" hidden>获取 API Key ↗</a>
          </div>
          <div class="key-input-wrap" style="margin-top:6px">
            <input class="s-input" id="apiKey" type="password" placeholder="API Key（只存本机 data/settings.json）" value="" />
            <button type="button" class="btn ghost key-eye" id="settingsKeyToggle">显示</button>
          </div>
          <input class="s-input" id="apiModel" placeholder="模型名，例如 deepseek-chat" value="" style="width:100%;margin-top:8px" />
          <div class="mirror-chips" id="settingsModelChips"></div>
          <details class="prompt-preview" id="settingsBaseUrlDetails">
            <summary>高级选项：接口地址（Base URL）</summary>
            <div style="margin-top:8px">
              <input class="s-input" id="apiBaseUrl" placeholder="Base URL，例如 https://api.deepseek.com" value="" style="width:100%" />
            </div>
          </details>
        </div>
        <div id="settingsWorkbuddyFields" hidden style="margin-top:10px">
          <div class="provider-tip">${env.workbuddyCli ? `已检测到本机 WorkBuddy 命令行（${esc(env.workbuddyCli)}），点下方按钮打开终端输入 /login 完成授权。` : '本机未检测到 WorkBuddy 命令行，建议切换 DeepSeek 等 API Key 渠道。'}</div>
          <div class="ai-action-row">
            <button type="button" class="btn ghost" id="settingsWorkbuddyLogin" ${env.workbuddyCli ? '' : 'disabled'}>打开账号登录终端</button>
          </div>
        </div>
        <div class="ai-action-row">
          <button type="button" class="btn ghost" id="testAiBtn">测试连接</button>
        </div>
        <div class="setup-feedback" id="settingsAiFeedback" hidden></div>
      </div>
    </div>

    <!-- 3. 联动与向导 -->
    <div class="settings-pane" data-spane="connect" ${tab === 'connect' ? '' : 'hidden'}>
      <div class="s-block wizard-banner-block">
        <div class="wizard-banner">
          <div>
            <div class="s-title" style="margin-bottom:4px">🧭 4 步配置向导与环境体检</div>
            <div class="s-desc" style="margin-bottom:0">
              本地微信 ${env.wechatReady ? '<span class="ok-dot">● 已就绪</span>' : '<span class="warn-dot">● 待配置</span>'} ·
              AI ${env.ready ? `<span class="ok-dot">● ${esc(env.providerName || 'DeepSeek')}</span>` : '<span class="warn-dot">● 待配置</span>'} ·
              群聊 ${(d.groups.length + d.funGroups.length) ? `<span class="ok-dot">● 已选 ${d.groups.length + d.funGroups.length} 个</span>` : '<span class="warn-dot">● 未选</span>'}
            </div>
          </div>
          <button type="button" class="btn primary" id="openWizardFromSettings">打开向导</button>
        </div>
      </div>

      <div class="s-block">
        <div class="wizard-card">
          <div class="wizard-card-head" style="margin-bottom:6px">
            <div>
              <div class="wizard-card-title">📱 连接手机「轻松打卡」</div>
              <div class="wizard-card-desc">${bridge?.enabled && bridge?.listening ? `局域网同步已开启（端口 ${bridge.port}），手机端可随时同步今日日程。` : '开启同一 Wi-Fi 下的局域网同步后，电脑待办与手机打卡互相实时打通。'}</div>
            </div>
            <a class="btn ghost" href="/bridge.html" target="_blank" rel="noopener noreferrer">打开配对页 ↗</a>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. 更新与日志 -->
    <div class="settings-pane" data-spane="updates" ${tab === 'updates' ? '' : 'hidden'}>
      <div class="s-block">
        <div class="s-title">🔄 应用更新</div>
        <div class="s-desc">当前版本 <strong>v${esc(env.version || '—')}</strong> · 每次打开应用都会自动检测新版本</div>
        <label class="inline-toggle"><input type="checkbox" id="autoCheckUpdate" /> 进入应用时自动检查更新</label>
        <div style="margin-top:12px">
          <div class="s-desc" style="margin-bottom:6px">更新加速镜像（macOS 与 Windows 默认走镜像加速，失败自动切换备用镜像或直连）</div>
          <input class="s-input" id="updateMirror" style="width:100%" placeholder="默认 https://gh-proxy.com/（填 direct 为直连 GitHub）" value="${esc(d.updateMirror || 'https://gh-proxy.com/')}" />
          <div class="mirror-chips" id="updateMirrorChips">
            <button type="button" class="btn ghost mirror-chip" data-mirror="https://gh-proxy.com/">gh-proxy.com（默认）</button>
            <button type="button" class="btn ghost mirror-chip" data-mirror="https://gh-proxy.org/">gh-proxy.org</button>
            <button type="button" class="btn ghost mirror-chip" data-mirror="https://ghfast.top/">ghfast.top</button>
            <button type="button" class="btn ghost mirror-chip" data-mirror="direct">直连 GitHub</button>
          </div>
        </div>
        <div class="ai-action-row">
          <button type="button" class="btn primary" id="checkUpdateBtn">立即检查更新</button>
          <button type="button" class="btn ghost" id="openAnnFromSettings">查看更新公告</button>
        </div>
      </div>

      <div class="s-block">
        <details class="prompt-preview" open>
          <summary>📋 最近整理记录（近 5 次）</summary>
          <div class="run-log" style="margin-top:8px">${renderRunLog()}</div>
        </details>
      </div>
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
    if (r.error) return `<div>${when} · 失败：${esc(r.error)}</div>`;
    if (r.engine === 'none') return `<div>${when} · ${esc(r.note || '没有新消息')}</div>`;
    return `<div>${when} · 读了 <b>${r.totalMsgs || 0}</b> 条，整理出 <b>${r.items || 0}</b> 条通知${r.added ? `（新增 ${r.added}）` : ''}${!r.items && r.note ? ` · ${esc(r.note)}` : ''}</div>`;
  }).join('');
}

function bindSettings() {
  const d = app.draft;

  $('settingsTabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stab]');
    if (!btn) return;
    const next = btn.dataset.stab;
    app.settingsTab = next;
    for (const b of $('settingsTabs').querySelectorAll('[data-stab]')) {
      b.classList.toggle('on', b.dataset.stab === next);
    }
    for (const p of $('settingsBody').querySelectorAll('[data-spane]')) {
      p.hidden = p.dataset.spane !== next;
    }
  });

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

  $('settingsGrpMode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gmode]');
    if (!btn) return;
    app.settingsGroupMode = btn.dataset.gmode;
    for (const b of $('settingsGrpMode').querySelectorAll('[data-gmode]')) {
      b.classList.toggle('on', b.dataset.gmode === app.settingsGroupMode);
    }
    $('settingsGrpHint').textContent = app.settingsGroupMode === 'fun'
      ? '勾选游戏群、吃喝群、闲聊群，AI 会生成像真人群友复盘一样的省流群聊总结。'
      : '勾选班群、学院通知群、作业群等，AI 会自动提取截止时间和待办卡片。';
    $('settingsGrpList').innerHTML = renderSettingsGroupListHtml();
  });

  $('settingsGrpSearch')?.addEventListener('input', (e) => {
    app.groupQuery = e.target.value;
    $('settingsGrpList').innerHTML = renderSettingsGroupListHtml();
  });

  $('settingsGrpRefresh')?.addEventListener('click', () => {
    retryGroups();
  });

  $('settingsGrpList')?.addEventListener('change', (e) => {
    const cb = e.target;
    if (cb.type !== 'checkbox' || !cb.dataset.sgwxid) return;
    const wxid = cb.dataset.sgwxid;
    const g = (app.groupCache || []).find((x) => x.wxid === wxid);
    if (!g) return;
    const key = app.settingsGroupMode === 'fun' ? 'funGroups' : 'groups';
    if (cb.checked) {
      if (!d[key].some((x) => x.wxid === wxid)) d[key].push({ wxid, name: g.display });
    } else {
      d[key] = d[key].filter((x) => x.wxid !== wxid);
    }
    $('settingsGrpNoticeTab').textContent = `📚 通知群 (${d.groups.length})`;
    $('settingsGrpFunTab').textContent = `🎮 娱乐群 (${d.funGroups.length})`;
  });

  const providerSel = $('aiProvider');
  const syncSettingsProviderUi = (pid) => {
    const meta = typeof getProviderMeta === 'function' ? getProviderMeta(pid) : null;
    const isAccount = meta?.authType === 'account' || pid === 'workbuddy';
    $('settingsApiFields').hidden = isAccount;
    $('settingsWorkbuddyFields').hidden = !isAccount;
    if (!isAccount && meta) {
      const saved = typeof savedProfileFor === 'function' ? savedProfileFor(pid) : {};
      syncProviderFieldsUi({
        meta,
        saved,
        tipEl: $('settingsProviderTip'),
        consoleLinkEl: $('settingsConsoleLink'),
        keyInputEl: $('apiKey'),
        modelInputEl: $('apiModel'),
        baseInputEl: $('apiBaseUrl'),
        modelChipsEl: $('settingsModelChips'),
        modelChipAttr: 'data-settings-model',
        baseDetailsEl: $('settingsBaseUrlDetails'),
      });
    }
  };
  if (providerSel) {
    syncSettingsProviderUi(providerSel.value);
    $('settingsProviderGrid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-settings-provider]');
      if (!btn) return;
      const pid = btn.dataset.settingsProvider;
      providerSel.value = pid;
      for (const b of $('settingsProviderGrid').querySelectorAll('[data-settings-provider]')) {
        b.classList.toggle('on', b.dataset.settingsProvider === pid);
      }
      syncSettingsProviderUi(pid);
      const fb = $('settingsAiFeedback');
      if (fb) fb.hidden = true;
    });
  }
  $('settingsKeyToggle')?.addEventListener('click', () => {
    const inp = $('apiKey');
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    $('settingsKeyToggle').textContent = show ? '隐藏' : '显示';
  });
  $('settingsModelChips')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-settings-model]');
    if (btn) $('apiModel').value = btn.dataset.settingsModel;
  });
  $('openWizardFromSettings')?.addEventListener('click', () => {
    closeSettings();
    if (typeof openSetupDialog === 'function') openSetupDialog({ step: 1 });
  });
  $('openSetupGuideBtn')?.addEventListener('click', () => {
    closeSettings();
    if (typeof openSetupDialog === 'function') openSetupDialog({ step: 2 });
  });
  $('openAnnFromSettings')?.addEventListener('click', () => {
    closeSettings();
    openAnnouncements();
  });
  $('settingsWorkbuddyLogin')?.addEventListener('click', async () => {
    const fb = $('settingsAiFeedback');
    fb.hidden = false;
    fb.className = 'setup-feedback info';
    fb.textContent = '正在打开登录终端…';
    const res = await api('/api/ai/workbuddy-login', { method: 'POST', body: '{}' });
    fb.className = `setup-feedback ${res.ok ? 'ok' : 'err'}`;
    fb.textContent = res.ok ? res.message : (res.error || '启动登录失败');
  });
  $('testAiBtn')?.addEventListener('click', async () => {
    const btn = $('testAiBtn');
    const fb = $('settingsAiFeedback');
    btn.disabled = true;
    fb.hidden = false;
    fb.className = 'setup-feedback info';
    fb.textContent = '正在测试模型连接…';
    try {
      const pid = $('aiProvider').value;
      const res = await api('/api/ai/test', {
        method: 'POST',
        body: JSON.stringify({
          aiProvider: pid,
          apiBaseUrl: $('apiBaseUrl').value.trim(),
          apiKey: $('apiKey').value.trim(),
          apiModel: $('apiModel').value.trim(),
        }),
      });
      fb.className = `setup-feedback ${res.ok ? 'ok' : 'err'}`;
      fb.textContent = res.ok ? `✓ 连接成功（${res.providerName}）` : `连接失败：${res.error || '请检查配置'}`;
    } finally {
      btn.disabled = false;
    }
  });

  const checkBtn = $('checkUpdateBtn');
  bindUpdateSettings(checkBtn, $('autoCheckUpdate'));
  const mirrorChips = $('updateMirrorChips');
  if (mirrorChips) {
    mirrorChips.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mirror]');
      if (!btn) return;
      $('updateMirror').value = btn.dataset.mirror;
    });
  }

  $('saveSettings').onclick = async () => {
    const pid = $('aiProvider')?.value || 'deepseek';
    const body = {
      times: d.times,
      days: d.days,
      groups: d.groups,
      lookbackHours: Number($('lookback').value),
      funGroups: d.funGroups,
      ocrImages: false,
      termStart: $('termStart').value || null,
      aiProvider: pid,
      organizeBackend: pid === 'workbuddy' ? 'workbuddy' : (pid === 'deepseek' ? 'deepseek' : 'openai'),
      apiBaseUrl: $('apiBaseUrl').value.trim(),
      apiKey: $('apiKey').value.trim(),
      apiModel: $('apiModel').value.trim(),
      onboardingDone: true,
      updateMirror: $('updateMirror')?.value.trim() || '',
    };
    const res = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    if (res.ok) {
      if (app.data) {
        if (res.settings) app.data.settings = res.settings;
        if (res.env) app.data.env = { ...app.data.env, ...res.env };
        else if (body.apiKey) {
          app.data.env = { ...app.data.env, ready: true, apiConfigured: true, deepseekConfigured: true };
        }
      }
      toast('设置已保存');
      closeSettings();
      await load({ quiet: true });
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

$('prevDay').onclick = () => shiftCalendar(-1);
$('nextDay').onclick = () => shiftCalendar(1);
$('calendarToggle').onclick = () => {
  app.calendarExpanded = !app.calendarExpanded;
  renderDayBar();
};
$('calendarDays').onclick = (event) => {
  const day = event.target.closest('[data-day]')?.dataset.day;
  if (!day) return;
  app.selectedDay = new Date(day + 'T12:00:00');
  render();
  $('calendarDays').querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
};
const todayBtn = $('todayBtn');
if (todayBtn) {
  todayBtn.onclick = () => {
    app.mode = 'notice';
    app.tab = 'today';
    app.selectedDay = new Date();
    closeDetail();
    render();
  };
}

$('setupStripOpen')?.addEventListener('click', () => {
  if (typeof openSetupDialog === 'function') openSetupDialog();
});
$('setupStripClose')?.addEventListener('click', () => {
  sessionStorage.setItem('qs_strip_dismissed', '1');
  if ($('setupStrip')) $('setupStrip').hidden = true;
});

$('modeSwitch').addEventListener('click', (e) => {
  const button = e.target.closest('[data-mode]');
  if (!button || button.classList.contains('on')) return;
  app.mode = button.dataset.mode;
  if (button.dataset.view) app.tab = button.dataset.view;
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
  if (e.target.closest('[data-open-detail]')) e.preventDefault();
  openDetail(card.dataset.id);
});

$('drawer').addEventListener('click', (e) => {
  const act = e.target.closest('[data-dact]');
  if (act && app.selectedId) {
    const a = act.dataset.dact;
    if (a === 'restore') restoreNotice(app.selectedId);
    else if (a === 'delete') deleteNotice(app.selectedId);
    else setStatus(app.selectedId, a);
  }
});

$('mask').onclick = () => {
  closeDetail();
};

$('runBtn').onclick = async () => {
  if (!app.data) {
    toast('正在连接本地服务，请稍候再试…');
    load({ quiet: true });
    return;
  }
  const ready = typeof isAiReady === 'function' ? isAiReady() : Boolean(app.data?.env?.ready || app.data?.env?.apiConfigured);
  if (!ready) {
    if (typeof openSetupDialog === 'function') {
      openSetupDialog({ step: 2, reason: '整理前请先完成第 2 步：填入 DeepSeek 等模型 API Key，或选择账号登录。' });
    } else {
      openSettings();
      toast('请先配置 AI 整理渠道');
    }
    return;
  }
  const providerName = app.data.env?.providerName || 'DeepSeek';
  try {
    if (app.mode === 'fun') {
      if (!(app.data.settings.funGroups || []).length) { openSettings(); toast('先选几个娱乐群'); return; }
      const res = await api('/api/fun/run', { method: 'POST' });
      if (res.ok) { toast(`正在由 ${res.providerName || providerName} 总结娱乐群…`); load({ quiet: true }); }
      else if (res.needsSetup && typeof openSetupDialog === 'function') openSetupDialog({ reason: res.error });
      else toast(res.error || '开始失败');
      return;
    }
    if (!(app.data.settings.groups || []).length) { openSettings(); toast('先选几个要整理的群'); return; }
    const res = await api('/api/run', { method: 'POST' });
    if (res.ok) { toast(`正在由 ${res.providerName || providerName} 整理…`); load({ quiet: true }); }
    else if (res.needsSetup && typeof openSetupDialog === 'function') openSetupDialog({ reason: res.error });
    else toast(res.error || '开始失败');
  } catch (err) {
    toast(err?.message || '触发整理失败，请检查本地服务是否正常', 4200);
  }
};

$('settingsBtn').onclick = openSettings;
$('annBtn').onclick = () => {
  if ($('annDialog')?.open) closeAnnouncements();
  else openAnnouncements();
};
$('closeAnn').onclick = closeAnnouncements;
$('annOk').onclick = closeAnnouncements;
$('closeSettings').onclick = closeSettings;
$('clearArchiveBtn').onclick = clearArchive;
$('emptyAction').onclick = () => {
  if (app.mode === 'notice' && app.tab === 'today') { $('addBtn').click(); return; }
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
  if (e.key === 'Escape' && !$('drawer').hidden) {
    closeDetail();
  }
});

// ── 使用公告 ──────────────────────────────────────────────
const ANN_SEEN_KEY = 'qs_ann_seen';
let annFilter = 'all';
let annExpandedId = null;

function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// 行内格式：**加粗**、`代码`、[文字](链接)、裸 URL 自动成链
// 代码和链接先抽成占位符，避免里面的字符被后续规则二次处理
function fmtInline(text) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  const anchor = (href, label) =>
    `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => keep(anchor(url, label)));
  s = s.replace(/(https?:\/\/[^\s<>"'\u0000）)]+)/g, (m) => keep(anchor(m, m)));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[Number(i)]);
}

function renderBlock(b) {
  switch (b && b.t) {
    case 'h':
      return `<div class="ann-h">${fmtInline(b.text)}</div>`;
    case 'steps':
      return `<ol class="ann-steps">${(b.items || []).map((x) => `<li>${fmtInline(x)}</li>`).join('')}</ol>`;
    case 'list':
      return `<ul class="ann-list">${(b.items || []).map((x) => `<li>${fmtInline(x)}</li>`).join('')}</ul>`;
    case 'code':
      return `<pre class="ann-code">${esc(b.text)}</pre>`;
    default:
      return `<p class="ann-p">${fmtInline(b.text || '')}</p>`;
  }
}

function annSeen() {
  return localStorage.getItem(ANN_SEEN_KEY) || '0.0.0';
}

function annLatest() {
  return (app.announcements || []).reduce((m, a) => (cmpVersion(a.version, m) > 0 ? a.version : m), '0.0.0');
}

function annHasUnseen() {
  const seen = annSeen();
  return (app.announcements || []).some((a) => cmpVersion(a.version, seen) > 0);
}

function updateAnnDot() {
  const dot = $('annDot');
  if (dot) dot.hidden = !annHasUnseen();
}

function renderAnnouncements() {
  const body = $('annBody');
  if (!body) return;
  const all = app.announcements || [];
  const items = annFilter === 'all' ? all : all.filter((a) => a.tag === annFilter);
  const sub = $('annSub');
  if (sub) {
    const ver = app.data?.env?.version;
    sub.textContent = ver ? `当前版本 v${ver} · 共 ${all.length} 条动态与指南` : `共 ${all.length} 条动态与指南`;
  }
  if (!items.length) {
    body.innerHTML = '<div class="grp-empty">该分类下暂时没有公告</div>';
    return;
  }
  if (!annExpandedId || !items.some((x) => x.id === annExpandedId)) {
    annExpandedId = items[0].id;
  }
  const seen = annSeen();
  body.innerHTML = items
    .map((a, idx) => {
      const isNew = cmpVersion(a.version, seen) > 0;
      const expanded = a.id === annExpandedId;
      const actions = Array.isArray(a.actions) ? a.actions : [];
      return `<article class="ann-card ${expanded ? 'open' : ''} ${idx === 0 && annFilter === 'all' ? 'latest' : ''}" data-ann-id="${esc(a.id)}">
        <button type="button" class="ann-card-toggle" data-ann-toggle="${esc(a.id)}" aria-expanded="${expanded}">
          <div class="ann-head">
            <span class="ann-tag ${a.tag === '更新' ? 'upd' : 'guide'}">${esc(a.tag || '公告')}</span>
            ${a.version ? `<span class="ann-ver">v${esc(a.version)}</span>` : ''}
            ${isNew ? '<span class="ann-new">NEW</span>' : ''}
            <span class="ann-date">${esc(a.date || '')}</span>
          </div>
          <div class="ann-title-row">
            <span class="ann-title">${esc(a.title || '')}</span>
            <span class="ann-chevron" aria-hidden="true">${expanded ? '▴' : '▾'}</span>
          </div>
          ${a.summary ? `<p class="ann-summary">${esc(a.summary)}</p>` : ''}
        </button>
        <div class="ann-detail" ${expanded ? '' : 'hidden'}>
          <div class="ann-content">${(a.blocks || []).map(renderBlock).join('')}</div>
          ${actions.length ? `<div class="ann-actions">${actions.map((act) =>
            `<button type="button" class="btn ghost mirror-chip" data-ann-act="${esc(act.action)}">${esc(act.label)}</button>`
          ).join('')}</div>` : ''}
        </div>
      </article>`;
    })
    .join('');
}

$('annFilterTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-ann-filter]');
  if (!btn) return;
  annFilter = btn.dataset.annFilter;
  for (const b of $('annFilterTabs').querySelectorAll('[data-ann-filter]')) {
    b.classList.toggle('on', b.dataset.annFilter === annFilter);
  }
  annExpandedId = null;
  renderAnnouncements();
});

$('annBody')?.addEventListener('click', (e) => {
  const actBtn = e.target.closest('[data-ann-act]');
  if (actBtn) {
    const act = actBtn.dataset.annAct;
    closeAnnouncements();
    if (act === 'wizard' && typeof openSetupDialog === 'function') openSetupDialog({ step: 1 });
    else if (act === 'update' && typeof checkForAppUpdate === 'function') checkForAppUpdate();
    else if (act === 'bridge') window.location.href = '/bridge.html';
    return;
  }
  const toggleBtn = e.target.closest('[data-ann-toggle]');
  if (toggleBtn) {
    const id = toggleBtn.dataset.annToggle;
    annExpandedId = annExpandedId === id ? null : id;
    renderAnnouncements();
  }
});

$('annOpenWizard')?.addEventListener('click', () => {
  closeAnnouncements();
  if (typeof openSetupDialog === 'function') openSetupDialog({ step: 1 });
});

function openAnnouncements() {
  const dlg = $('annDialog');
  if (!dlg) return;
  renderAnnouncements();
  if (!dlg.open) dlg.showModal();
  // 看过了就记下来，角标随之消失
  localStorage.setItem(ANN_SEEN_KEY, annLatest());
  updateAnnDot();
}

function closeAnnouncements() {
  const dlg = $('annDialog');
  if (dlg?.open) dlg.close();
}

ModalQueue.bindBackdropClose($('annDialog'));

async function loadAnnouncements() {
  try {
    const res = await fetch('/announcements.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    app.announcements = Array.isArray(data.items) ? data.items : [];
  } catch {
    app.announcements = [];
  }
  updateAnnDot();
  renderAnnouncements();

  // 有新内容时通过 ModalQueue 排队居中展示（优先让位给首次强制配置向导和更新弹窗）
  if (annHasUnseen() && !sessionStorage.getItem('qs_ann_auto')) {
    sessionStorage.setItem('qs_ann_auto', '1');
    ModalQueue.enqueue(3, 'announcement', () => {
      if (document.body.classList.contains('onboarding-locked')) return;
      if (!$('settingsDialog')?.open && $('drawer').hidden && $('addDrawer').hidden) {
        openAnnouncements();
      }
    });
  }
}

// ── 启动 ──────────────────────────────────────────────────
load();
loadAnnouncements();
app.tickTimer = setInterval(updateCountdowns, 20000);