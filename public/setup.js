// 首次配置向导（仿 dsh-go 分步式引导）：1. 读取本地微信 → 2. 接入 AI（默认 DeepSeek）→ 3. 挑选群聊 → 4. 完成启用
const setupDialog = $('setupDialog');
const setupState = {
  step: 1,
  mode: 'apiKey', // apiKey | account
  providerId: 'deepseek',
  autoShown: false,
  diagnostics: null,
  wechatTestedOk: null,
  wechatGroupCount: 0,
  groupMode: 'notice', // notice | fun
  draftGroups: [],
  draftFunGroups: [],
  aiSavedReady: false,
};

function isAiReady() {
  const env = app.data?.env;
  if (!env) return false;
  if (typeof env.ready === 'boolean') return env.ready;
  return Boolean(env.apiConfigured || env.deepseekConfigured || (env.backend === 'workbuddy' && env.workbuddyCli));
}

function aiProvidersList() {
  return app.data?.env?.providers || [];
}

function getProviderMeta(id) {
  const list = aiProvidersList();
  return list.find((p) => p.id === id) || list[0] || {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    authType: 'apiKey',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    consoleLabel: '前往 DeepSeek 开放平台获取 Key',
    help: '填入 API Key 即可使用。',
  };
}

function savedProfileFor(providerId) {
  const s = app.data?.settings || {};
  const profiles = s.providerProfiles || {};
  const p = profiles[providerId];
  const activePid = app.data?.env?.provider || s.aiProvider || 'deepseek';
  if (p && typeof p === 'object') {
    return {
      apiKey: p.apiKey || (activePid === providerId ? (s.apiKey || s.deepseekApiKey || '') : ''),
      baseUrl: p.baseUrl || '',
      model: p.model || '',
    };
  }
  if (activePid === providerId) {
    return {
      apiKey: s.apiKey || s.deepseekApiKey || '',
      baseUrl: s.apiBaseUrl || s.deepseekBaseUrl || '',
      model: s.apiModel || s.deepseekModel || '',
    };
  }
  return {};
}

function setSetupFeedback(msg, kind = 'info') {
  const el = $('setupFeedback');
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'setup-feedback';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className = `setup-feedback ${kind}`;
}

function setWechatFeedback(msg, kind = 'info') {
  const el = $('wechatTestFeedback');
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'setup-feedback';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className = `setup-feedback ${kind}`;
}

// ── Step 1: 本地微信诊断 ──────────────────────────────────
async function refreshDiagnostics() {
  try {
    const res = await api('/api/setup/diagnostics');
    if (res.ok) {
      setupState.diagnostics = res;
      renderWechatDiagnostics();
      updateStepBadges();
      if (setupState.step === 4) renderWizardSummary();
    }
  } catch {}
}

function renderWechatDiagnostics() {
  const list = $('wechatDiagList');
  if (!list) return;
  const wx = setupState.diagnostics?.wechat;
  if (!wx) {
    list.innerHTML = '<div class="diag-row"><span class="diag-dot">…</span><span>正在检测本机微信读取环境…</span></div>';
    return;
  }
  const c = wx.checks || {};
  const rows = [
    {
      ok: c.pythonVenv && c.queryScript,
      title: '微信读取组件（wechat-decrypt / .venv）',
      desc: c.pythonVenv && c.queryScript ? `已就绪（${wx.skillDir}）` : `未检测到可用 .venv 或 query.py（目标：${wx.skillDir}）`,
    },
    {
      ok: c.keyFile,
      title: '本机微信数据库密钥',
      desc: c.keyFile ? '已检测到本机密钥文件' : '未检测到密钥文件，请按下方教程提取一次密钥',
    },
    {
      ok: wx.isWindows ? c.decryptedDb : c.sqlcipher,
      title: wx.isWindows ? '明文聊天数据库（decrypted）' : 'SQLCipher 只读引擎',
      desc: wx.isWindows
        ? (c.decryptedDb ? '已检测到解密后的数据库目录' : '请运行一次 decrypt_all.py 生成明文库')
        : (c.sqlcipher ? '已就绪，支持直接只读微信数据库' : '缺少 tools/sqlcipher-arm64.sh'),
    },
  ];
  list.innerHTML = rows.map((r) => `
    <div class="diag-row ${r.ok ? 'ok' : 'warn'}">
      <span class="diag-dot">${r.ok ? '✓' : '!'}</span>
      <div class="diag-body">
        <div class="diag-title">${esc(r.title)}</div>
        <div class="diag-desc">${esc(r.desc)}</div>
      </div>
    </div>
  `).join('');

  switchWechatOs(wx.isWindows ? 'win' : 'mac');
  renderWechatAgentAssist();
}

function buildWechatAssistPrompt() {
  const diag = setupState.diagnostics || {};
  const wx = diag.wechat || {};
  const isWin = Boolean(wx.isWindows);
  const projectDir = diag.projectDir || '轻松日程项目目录';
  const skillDir = wx.skillDir || (isWin ? `${projectDir}\\vendor\\wechat-decrypt` : '~/.dsh/skills/wechat-decrypt');
  const checks = wx.checks || {};
  const missing = [];
  if (!checks.pythonVenv || !checks.queryScript) missing.push('Python 依赖环境（.venv / query.py）');
  if (!checks.keyFile) missing.push('本机微信数据库密钥');
  if (isWin && !checks.decryptedDb) missing.push('明文聊天数据库（decrypted）');

  return [
    '请帮我把电脑上「轻松日程」的本地微信读取环境配置好，并执行实测验证：',
    `- 系统：${isWin ? 'Windows' : 'macOS'}`,
    `- 轻松日程项目目录：${projectDir}`,
    `- 微信读取组件目录：${skillDir}`,
    missing.length ? `- 当前检测缺失项：${missing.join('、')}` : '- 当前基础文件已检测到，请帮我确认读取权限并做一次连通性验证',
    '',
    '请按以下要求操作：',
    isWin
      ? `1. 阅读 ${projectDir}\\INSTALL_FOR_AI.md，检查微信 4.x 是否已登录并定位真实 xwechat_files 目录；\n2. 初始化 vendor\\wechat-decrypt\\.venv 并安装 requirements-windows.txt；\n3. 提取微信数据库密钥（extract_raw_key.py）并运行 decrypt_all.py 生成明文库；`
      : `1. 参考 ${projectDir}/lib/wechat.mjs，确认电脑版微信已登录、${skillDir}/.venv 与 scripts/common/query.py 完整；\n2. 检查本机微信数据库密钥（key.txt / all_keys.json）和 tools/sqlcipher-arm64.sh，如有缺失帮我引导或提取；\n3. 如果报磁盘权限不足，告诉我需要给哪个应用开启「完全磁盘访问权限」；`,
    `4. 在项目目录运行以下命令验证能读出微信群聊列表，并把群数量反馈给我：`,
    `   cd "${projectDir}" && node -e "import('./lib/wechat.mjs').then(m => m.listChats()).then(c => console.log('WECHAT_OK', c.length))"`,
  ].join('\n');
}

function setAgentFeedback(msg, kind = 'info') {
  const el = $('agentLaunchFeedback');
  if (!el) return;
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
    el.className = 'setup-feedback';
    return;
  }
  el.hidden = false;
  el.textContent = msg;
  el.className = `setup-feedback ${kind}`;
}

function renderWechatAgentAssist() {
  const preview = $('wechatPromptPreview');
  if (preview) preview.textContent = buildWechatAssistPrompt();

  const grid = $('wechatAgentGrid');
  if (!grid) return;
  const agents = (setupState.diagnostics?.agents || []).slice().sort((a, b) => Number(b.installed) - Number(a.installed));
  if (!agents.length) {
    grid.innerHTML = '<div class="diag-desc">正在检测本机已安装的 AI Agent 软件…</div>';
    return;
  }
  grid.innerHTML = agents.map((a) => `
    <button type="button" class="agent-pill ${a.installed ? 'installed' : 'missing'}" data-agent-id="${esc(a.id)}" data-agent-name="${esc(a.name)}" data-agent-installed="${a.installed ? '1' : '0'}">
      ${providerIconHtml(a.id, 24)}
      <span class="agent-pill-info">
        <span class="agent-pill-name">${esc(a.name)}</span>
        <span class="agent-pill-meta">${a.installed ? '<span class="ok-dot">●</span> 已安装 · 点击弹出' : '未检测到 · 仅复制'}</span>
      </span>
    </button>
  `).join('');
}

async function copyTextSafe(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function switchWechatOs(os) {
  const target = os === 'win' ? 'win' : 'mac';
  for (const btn of $('wechatOsTabs')?.querySelectorAll('[data-os]') || []) {
    btn.classList.toggle('on', btn.dataset.os === target);
  }
  if ($('wechatGuideMac')) $('wechatGuideMac').hidden = target !== 'mac';
  if ($('wechatGuideWin')) $('wechatGuideWin').hidden = target !== 'win';
}

// ── Step 2: AI 渠道商（默认 DeepSeek） ────────────────────
function renderSetupProviderGrid() {
  const grid = $('setupProviderGrid');
  if (!grid) return;
  const apiProviders = aiProvidersList().filter((p) => p.authType === 'apiKey');
  grid.innerHTML = apiProviders.map((p) => `
    <button type="button" class="provider-pill ${p.id === setupState.providerId ? 'on' : ''}" data-provider="${esc(p.id)}">
      <span class="provider-pill-top">
        ${providerIconHtml(p.id, 22)}
        <span class="provider-pill-name">${esc(p.shortName)}</span>
      </span>
      ${p.badge ? `<span class="provider-pill-badge">${esc(p.badge)}</span>` : ''}
    </button>
  `).join('');
}

function applySetupProvider(providerId) {
  const meta = getProviderMeta(providerId);
  setupState.providerId = meta.id;
  renderSetupProviderGrid();

  const saved = savedProfileFor(meta.id);
  if ($('setupProviderTip')) $('setupProviderTip').textContent = meta.help || '';
  if ($('setupDeepseekGuide')) $('setupDeepseekGuide').hidden = meta.id !== 'deepseek';

  const link = $('setupConsoleLink');
  if (link) {
    if (meta.consoleUrl) {
      link.href = meta.consoleUrl;
      link.textContent = `${meta.consoleLabel || '获取 API Key'} ↗`;
      link.hidden = false;
    } else {
      link.hidden = true;
    }
  }

  $('setupApiKey').value = saved.apiKey || '';
  $('setupApiKey').placeholder = meta.keyPlaceholder || '输入 API Key';
  $('setupApiModel').value = saved.model || meta.defaultModel || '';
  $('setupApiModel').placeholder = meta.defaultModel ? `默认：${meta.defaultModel}` : '输入模型名称，例如 qwen2.5:14b';
  $('setupApiBaseUrl').value = saved.baseUrl || meta.baseUrl || '';
  $('setupApiBaseUrl').placeholder = meta.baseUrl || '例如 http://127.0.0.1:11434/v1';

  const chips = $('setupModelChips');
  if (chips) {
    chips.innerHTML = (meta.models || []).map((m) =>
      `<button type="button" class="btn ghost mirror-chip" data-setup-model="${esc(m)}">${esc(m)}</button>`
    ).join('');
  }
}

function switchSetupMode(mode) {
  setupState.mode = mode === 'account' ? 'account' : 'apiKey';
  for (const btn of $('setupModeTabs')?.querySelectorAll('[data-setup-mode]') || []) {
    btn.classList.toggle('on', btn.dataset.setupMode === setupState.mode);
  }
  $('setupApiPane').hidden = setupState.mode !== 'apiKey';
  $('setupAccountPane').hidden = setupState.mode !== 'account';

  const wbStatus = $('setupWorkbuddyStatus');
  if (wbStatus) {
    const cli = app.data?.env?.workbuddyCli;
    wbStatus.innerHTML = cli
      ? `<span class="ok-dot">●</span> 已检测到本机 WorkBuddy 命令行（<code>${esc(cli)}</code>）`
      : `<span class="warn-dot">●</span> 本机未检测到 WorkBuddy 命令行，建议使用左侧 DeepSeek 等 API Key 方式`;
  }
  $('launchWorkbuddyLogin').disabled = !app.data?.env?.workbuddyCli;
  setSetupFeedback('');
}

function collectAiPayload() {
  if (setupState.mode === 'account') {
    return {
      aiProvider: 'workbuddy',
      organizeBackend: 'workbuddy',
    };
  }
  return {
    aiProvider: setupState.providerId,
    organizeBackend: setupState.providerId === 'deepseek' ? 'deepseek' : 'openai',
    apiKey: $('setupApiKey').value.trim(),
    apiModel: $('setupApiModel').value.trim(),
    apiBaseUrl: $('setupApiBaseUrl').value.trim(),
  };
}

// ── Step 3: 挑选群聊与定时 ────────────────────────────────
async function loadWizardGroups() {
  const box = $('wizardGrpList');
  if (!box) return;
  if (app.groupCache && app.groupCache.length) {
    renderWizardGroupList();
    return;
  }
  box.innerHTML = '<div class="grp-empty">正在读取微信群列表…</div>';
  try {
    const res = await api('/api/groups', { method: 'POST' });
    app.groupCache = Array.isArray(res.chats) ? res.chats : [];
    renderWizardGroupList();
  } catch (e) {
    box.innerHTML = `<div class="grp-empty">暂时无法读取微信群列表（${esc(e.message || '请先完成第 1 步本地微信配置')}），可先跳过此步稍后在「更多」里选群。</div>`;
  }
}

function renderWizardGroupList() {
  const box = $('wizardGrpList');
  if (!box) return;
  $('wizardNoticeTab').textContent = `📚 通知群 (${setupState.draftGroups.length})`;
  $('wizardFunTab').textContent = `🎮 娱乐群 (${setupState.draftFunGroups.length})`;
  $('wizardGroupHint').textContent = setupState.groupMode === 'notice'
    ? '勾选班群、学院通知群、作业群等，AI 会自动提取截止时间和待办卡片。'
    : '勾选游戏群、吃喝群、闲聊群，AI 会生成像真人群友复盘一样的省流群聊总结。';

  const list = app.groupCache || [];
  if (!list.length) {
    box.innerHTML = '<div class="grp-empty">暂未读取到微信群，可返回第 1 步先完成微信环境检测，或点击下方「下一步」稍后再选。</div>';
    return;
  }
  const isFun = setupState.groupMode === 'fun';
  const chosenArr = isFun ? setupState.draftFunGroups : setupState.draftGroups;
  const chosen = new Map(chosenArr.map((g) => [g.wxid, g]));
  const q = ($('wizardGrpSearch')?.value || '').trim().toLowerCase();
  const filtered = list
    .filter((g) => (isFun ? (g.isGroup || chosen.has(g.wxid)) : (g.isGroup || g.isFriend || chosen.has(g.wxid))))
    .filter((g) => !q || String(g.display || '').toLowerCase().includes(q));

  if (!filtered.length) {
    box.innerHTML = '<div class="grp-empty">没有匹配的群聊</div>';
    return;
  }
  box.innerHTML = filtered.slice(0, 120).map((g) => `
    <label class="grp-row">
      <input type="checkbox" data-wzxid="${esc(g.wxid)}" ${chosen.has(g.wxid) ? 'checked' : ''} />
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.display)}</span>
      <span class="grp-time">${relTime(g.ts)}</span>
      <span class="tag">${g.isGroup ? '群聊' : '好友'}</span>
    </label>
  `).join('');
}

// ── Step 4: 总览 ──────────────────────────────────────────
function renderWizardSummary() {
  const box = $('wizardSummaryList');
  if (!box) return;
  const wxOk = Boolean(setupState.diagnostics?.wechat?.ready || app.data?.env?.wechatReady);
  const aiOk = isAiReady() || setupState.aiSavedReady;
  const pName = app.data?.env?.providerName || getProviderMeta(setupState.providerId).shortName;
  const totalGroups = setupState.draftGroups.length + setupState.draftFunGroups.length;
  const bridge = setupState.diagnostics?.bridge;

  if ($('wizardBridgeDesc') && bridge) {
    $('wizardBridgeDesc').textContent = bridge.enabled && bridge.listening
      ? `局域网同步已开启（端口 ${bridge.port}，配对码 ${bridge.token}），手机端可直接同步。`
      : '开启局域网配对后，电脑整理出的日程会自动同步到手机「轻松打卡」的今日日程。';
  }

  const items = [
    {
      step: 1,
      ok: wxOk,
      title: '1. 读取本地微信',
      desc: wxOk
        ? (setupState.wechatGroupCount ? `已实测就绪，检测到 ${setupState.wechatGroupCount} 个群聊` : '本机读取环境已就绪')
        : '尚未完成环境配置，点击可回第 1 步查看教程',
    },
    {
      step: 2,
      ok: aiOk,
      title: '2. AI 整理渠道',
      desc: aiOk ? `已配置：${pName}` : '尚未填入 API Key 或完成账号登录',
    },
    {
      step: 3,
      ok: totalGroups > 0,
      title: '3. 监听群聊与定时',
      desc: totalGroups > 0
        ? `已选 ${setupState.draftGroups.length} 个通知群 · ${setupState.draftFunGroups.length} 个娱乐群（每天 ${$('wizardAutoTime')?.value || '20:00'} 自动整理）`
        : '还没有勾选群聊，可回第 3 步勾选或稍后在「更多」中设置',
    },
  ];
  box.innerHTML = items.map((it) => `
    <button type="button" class="summary-row ${it.ok ? 'ok' : 'warn'}" data-jump-step="${it.step}">
      <span class="diag-dot">${it.ok ? '✓' : '!'}</span>
      <div class="diag-body">
        <div class="diag-title">${esc(it.title)}</div>
        <div class="diag-desc">${esc(it.desc)}</div>
      </div>
      <span class="summary-edit">去修改 ›</span>
    </button>
  `).join('');

  $('saveSetupBtn').disabled = !(wxOk && aiOk && totalGroups > 0);
}

// ── 步骤切换与状态圆点 ────────────────────────────────────
function updateStepBadges() {
  const wxOk = Boolean(setupState.diagnostics?.wechat?.ready || app.data?.env?.wechatReady);
  const aiOk = isAiReady() || setupState.aiSavedReady;
  const grpOk = (setupState.draftGroups.length + setupState.draftFunGroups.length) > 0;

  const states = [wxOk, aiOk, grpOk, wxOk && aiOk && grpOk];
  for (let i = 1; i <= 4; i++) {
    const btn = $('wizardSteps')?.querySelector(`[data-step="${i}"]`);
    const badge = $(`stepBadge${i}`);
    if (!btn || !badge) continue;
    btn.classList.toggle('on', setupState.step === i);
    btn.classList.toggle('done', states[i - 1]);
    badge.textContent = states[i - 1] ? '✓' : String(i);
  }
}

function goWizardStep(step) {
  setupState.step = Math.max(1, Math.min(4, Number(step) || 1));
  setSetupFeedback('');
  for (let i = 1; i <= 4; i++) {
    const pane = $(`wizardStep${i}`);
    if (pane) pane.hidden = i !== setupState.step;
  }
  $('wizardPrevBtn').hidden = setupState.step === 1;
  $('testSetupBtn').hidden = setupState.step !== 2;
  $('wizardNextBtn').hidden = setupState.step === 4;
  $('saveOnlyBtn').hidden = setupState.step !== 4;
  $('saveSetupBtn').hidden = setupState.step !== 4;

  $('wizardNextBtn').textContent = setupState.step === 2
    ? '保存 AI 配置并下一步 →'
    : (setupState.step === 3 ? '保存选群并下一步 →' : '下一步 →');

  updateStepBadges();
  if (setupState.step === 1) refreshDiagnostics();
  if (setupState.step === 3) loadWizardGroups();
  if (setupState.step === 4) {
    refreshDiagnostics();
    renderWizardSummary();
  }
}

async function saveAiStep({ allowEmpty = false } = {}) {
  const payload = collectAiPayload();
  if (payload.aiProvider !== 'workbuddy') {
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(payload.apiBaseUrl);
    if (!payload.apiKey && !isLocal) {
      if (allowEmpty) return true;
      setSetupFeedback('请先填写 API Key（或切到「账号登录」使用 WorkBuddy，也可点左下角「稍后再说」）', 'err');
      $('setupApiKey').focus();
      return false;
    }
    if (!payload.apiBaseUrl || !payload.apiModel) {
      setSetupFeedback('请补全接口 Base URL 与模型名称', 'err');
      return false;
    }
  }
  const res = await api('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
  if (!res.ok) {
    setSetupFeedback(res.error || '保存 AI 配置失败', 'err');
    return false;
  }
  if (app.data) {
    if (res.settings) app.data.settings = res.settings;
    if (res.env) app.data.env = { ...app.data.env, ...res.env };
  }
  setupState.aiSavedReady = Boolean(res.env?.ready ?? true);
  updateStepBadges();
  return true;
}

async function saveGroupsStep() {
  const s = app.data?.settings || {};
  const autoTime = $('wizardAutoTime')?.value || '20:00';
  const times = Array.isArray(s.times) && s.times.length ? [...s.times] : [autoTime];
  if (autoTime && !times.includes(autoTime)) times[0] = autoTime;

  const body = {
    groups: setupState.draftGroups,
    funGroups: setupState.draftFunGroups,
    times: [...new Set(times)].sort(),
    termStart: $('wizardTermStart')?.value || null,
  };
  const res = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    setSetupFeedback(res.error || '保存群聊配置失败', 'err');
    return false;
  }
  if (app.data && res.settings) app.data.settings = res.settings;
  updateStepBadges();
  return true;
}

function openSetupDialog({ step, reason } = {}) {
  if (!setupDialog || !app.data) return;
  const s = app.data.settings || {};
  setupState.draftGroups = (s.groups || []).map((g) => ({ ...g }));
  setupState.draftFunGroups = (s.funGroups || []).map((g) => ({ ...g }));
  setupState.aiSavedReady = isAiReady();

  if ($('wizardAutoTime')) $('wizardAutoTime').value = (s.times && s.times[0]) || '20:00';
  if ($('wizardTermStart')) $('wizardTermStart').value = s.termStart || '';

  const currentPid = app.data.env?.provider || 'deepseek';
  if (currentPid === 'workbuddy') {
    setupState.providerId = 'deepseek';
    applySetupProvider('deepseek');
    switchSetupMode('account');
  } else {
    setupState.providerId = currentPid;
    applySetupProvider(currentPid);
    switchSetupMode('apiKey');
  }

  let initialStep = step;
  if (!initialStep) {
    if (!app.data.env?.wechatReady) initialStep = 1;
    else if (!isAiReady()) initialStep = 2;
    else if (!(s.groups?.length || s.funGroups?.length)) initialStep = 3;
    else initialStep = 1;
  }
  goWizardStep(initialStep);
  if (reason) setSetupFeedback(reason, 'info');
  if (!setupDialog.open) setupDialog.showModal();
}

function maybeOpenOnboarding() {
  if (setupState.autoShown) return;
  if (!app.data) return;
  const s = app.data.settings || {};
  const needsGuide = !s.onboardingDone && (!app.data.env?.wechatReady || !isAiReady() || !(s.groups?.length || s.funGroups?.length));
  if (!needsGuide) return;
  if (setupDialog?.open || $('updateDialog')?.open) return;
  setupState.autoShown = true;
  openSetupDialog();
}

// ── 事件绑定 ──────────────────────────────────────────────
$('wizardBtn')?.addEventListener('click', () => openSetupDialog({ step: 1 }));

$('wizardSteps')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-step]');
  if (!btn) return;
  goWizardStep(Number(btn.dataset.step));
});

$('wechatOsTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-os]');
  if (!btn) return;
  switchWechatOs(btn.dataset.os);
});

setupDialog?.addEventListener('click', async (e) => {
  const copyBtn = e.target.closest('[data-copy]');
  if (copyBtn) {
    try {
      await navigator.clipboard.writeText(copyBtn.dataset.copy);
      const old = copyBtn.textContent;
      copyBtn.textContent = '已复制';
      setTimeout(() => { copyBtn.textContent = old; }, 1400);
    } catch {
      toast('复制失败，请手动选中命令复制');
    }
    return;
  }
  const jumpBtn = e.target.closest('[data-jump-step]');
  if (jumpBtn) {
    goWizardStep(Number(jumpBtn.dataset.jumpStep));
  }
});

$('copyWechatPromptBtn')?.addEventListener('click', async () => {
  const prompt = buildWechatAssistPrompt();
  const copied = await copyTextSafe(prompt);
  setAgentFeedback(
    copied
      ? '✓ 已复制完整配置指令！粘贴发给任意 AI 助手即可自动帮你配置本地微信。'
      : '未能自动写入剪贴板，请展开下方「查看完整指令内容」手动复制。',
    copied ? 'ok' : 'err',
  );
});

$('wechatAgentGrid')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-agent-id]');
  if (!btn) return;
  const agentId = btn.dataset.agentId;
  const agentName = btn.dataset.agentName || agentId;
  const installed = btn.dataset.agentInstalled === '1';

  const copied = await copyTextSafe(buildWechatAssistPrompt());
  if (!installed) {
    setAgentFeedback(
      copied
        ? `✓ 已复制配置指令（本机未检测到 ${agentName} 桌面端，你可以直接粘贴到它的网页版或其他助手）。`
        : `本机未检测到 ${agentName}，请展开下方预览手动复制指令。`,
      copied ? 'info' : 'err',
    );
    return;
  }

  btn.disabled = true;
  setAgentFeedback(`已复制指令，正在为你打开「${agentName}」…`, 'info');
  try {
    const res = await api('/api/setup/open-agent', {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    });
    if (res.ok) {
      const pasteKey = setupState.diagnostics?.wechat?.isWindows ? 'Ctrl+V' : 'Cmd+V';
      setAgentFeedback(
        `✓ 已复制指令并打开「${res.name || agentName}」，切过去直接按 ${pasteKey} 发送即可，配完回来点上方「实测读取微信」！`,
        'ok',
      );
    } else {
      setAgentFeedback(res.error || `打开 ${agentName} 失败，但配置指令已复制到剪贴板`, 'err');
    }
  } finally {
    btn.disabled = false;
  }
});

$('testWechatBtn')?.addEventListener('click', async () => {
  const btn = $('testWechatBtn');
  btn.disabled = true;
  setWechatFeedback('正在实测读取本机微信会话列表…', 'info');
  try {
    const res = await api('/api/setup/test-wechat', { method: 'POST', body: '{}' });
    if (res.wechat && setupState.diagnostics) setupState.diagnostics.wechat = res.wechat;
    renderWechatDiagnostics();
    if (res.ok) {
      setupState.wechatTestedOk = true;
      setupState.wechatGroupCount = res.groupCount || 0;
      if (Array.isArray(res.chats) && res.chats.length) app.groupCache = res.chats;
      setWechatFeedback(`✓ 读取成功！共检测到 ${res.groupCount} 个微信群聊、${res.friendCount} 位好友。`, 'ok');
      updateStepBadges();
    } else {
      setupState.wechatTestedOk = false;
      setWechatFeedback(res.error || '读取失败，请按下方教程检查配置', 'err');
    }
  } finally {
    btn.disabled = false;
  }
});

$('setupModeTabs')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-setup-mode]');
  if (!btn) return;
  switchSetupMode(btn.dataset.setupMode);
});

$('setupProviderGrid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-provider]');
  if (!btn) return;
  applySetupProvider(btn.dataset.provider);
  setSetupFeedback('');
});

$('setupModelChips')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-setup-model]');
  if (!btn) return;
  $('setupApiModel').value = btn.dataset.setupModel;
});

$('setupKeyPaste')?.addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setSetupFeedback('剪贴板里没有文本，请先复制 API Key', 'err');
      return;
    }
    $('setupApiKey').value = text;
    setSetupFeedback('已粘贴 API Key，点「测试连接」验证或直接进入下一步', 'info');
  } catch {
    setSetupFeedback('浏览器未授权读取剪贴板，请直接在输入框按 Cmd+V / Ctrl+V 粘贴', 'err');
    $('setupApiKey').focus();
  }
});

$('setupKeyToggle')?.addEventListener('click', () => {
  const inp = $('setupApiKey');
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  $('setupKeyToggle').textContent = show ? '隐藏' : '显示';
});

$('launchWorkbuddyLogin')?.addEventListener('click', async () => {
  setSetupFeedback('正在打开登录终端…', 'info');
  const res = await api('/api/ai/workbuddy-login', { method: 'POST', body: '{}' });
  setSetupFeedback(res.ok ? res.message : (res.error || '启动登录失败'), res.ok ? 'ok' : 'err');
});

$('testSetupBtn')?.addEventListener('click', async () => {
  const btn = $('testSetupBtn');
  btn.disabled = true;
  setSetupFeedback('正在测试模型连接…', 'info');
  try {
    const res = await api('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(collectAiPayload()),
    });
    if (res.ok) {
      setSetupFeedback(`✓ 连接成功！当前通道：${res.providerName}`, 'ok');
    } else {
      setSetupFeedback(`连接失败：${res.error || '请检查配置'}`, 'err');
    }
  } finally {
    btn.disabled = false;
  }
});

$('wizardGroupMode')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-gmode]');
  if (!btn) return;
  setupState.groupMode = btn.dataset.gmode;
  for (const b of $('wizardGroupMode').querySelectorAll('[data-gmode]')) {
    b.classList.toggle('on', b.dataset.gmode === setupState.groupMode);
  }
  renderWizardGroupList();
});

$('wizardGrpSearch')?.addEventListener('input', renderWizardGroupList);

$('wizardGrpList')?.addEventListener('change', (e) => {
  const cb = e.target;
  if (cb.type !== 'checkbox' || !cb.dataset.wzxid) return;
  const wxid = cb.dataset.wzxid;
  const g = (app.groupCache || []).find((x) => x.wxid === wxid);
  if (!g) return;
  const key = setupState.groupMode === 'fun' ? 'draftFunGroups' : 'draftGroups';
  if (cb.checked) {
    if (!setupState[key].some((x) => x.wxid === wxid)) {
      setupState[key].push({ wxid, name: g.display });
    }
  } else {
    setupState[key] = setupState[key].filter((x) => x.wxid !== wxid);
  }
  $('wizardNoticeTab').textContent = `📚 通知群 (${setupState.draftGroups.length})`;
  $('wizardFunTab').textContent = `🎮 娱乐群 (${setupState.draftFunGroups.length})`;
  updateStepBadges();
});

$('wizardPrevBtn')?.addEventListener('click', () => goWizardStep(setupState.step - 1));

$('wizardNextBtn')?.addEventListener('click', async () => {
  const btn = $('wizardNextBtn');
  btn.disabled = true;
  try {
    if (setupState.step === 2) {
      const ok = await saveAiStep({ allowEmpty: false });
      if (!ok) return;
    } else if (setupState.step === 3) {
      const ok = await saveGroupsStep();
      if (!ok) return;
    }
    goWizardStep(setupState.step + 1);
  } finally {
    btn.disabled = false;
  }
});

async function finishWizard({ runNow = false } = {}) {
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ onboardingDone: true }) }).catch(() => {});
  setupDialog.close();
  await load({ quiet: true });
  if (runNow) {
    if ((app.data?.settings?.groups || []).length) {
      app.mode = 'notice';
      render();
      $('runBtn').click();
    } else if ((app.data?.settings?.funGroups || []).length) {
      app.mode = 'fun';
      render();
      $('runBtn').click();
    }
  } else {
    toast('配置已保存，随时可点顶部「向导」再次查看');
  }
}

$('saveOnlyBtn')?.addEventListener('click', () => finishWizard({ runNow: false }));
$('saveSetupBtn')?.addEventListener('click', () => finishWizard({ runNow: true }));

async function dismissSetupGuide() {
  if (app.data?.settings && !app.data.settings.onboardingDone) {
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ onboardingDone: true }) }).catch(() => {});
  }
  setupDialog.close();
}

$('skipSetupBtn')?.addEventListener('click', dismissSetupGuide);
$('closeSetup')?.addEventListener('click', dismissSetupGuide);

if (app.data) maybeOpenOnboarding();
