// 首次配置向导：每个首次打开的用户必须完成 4 步配置并通过每一步的真实检测后，才正式进入主页面。
// 步骤：1. 读取本地微信（实测读群） → 2. 接入 AI（实测连通） → 3. 挑选群聊与定时（完整性检测） → 4. 全面总检并启用
const setupDialog = $('setupDialog');
const setupState = {
  step: 1,
  mandatory: false,        // 首次配置未完成时为 true：锁定主页面、禁止跳过/关闭
  mode: 'apiKey',          // apiKey | account
  providerId: 'deepseek',
  autoShown: false,
  diagnostics: null,
  // 第 1 步检测状态
  wechatChecking: false,
  wechatTestedOk: false,
  wechatTestError: '',
  wechatGroupCount: 0,
  wechatFriendCount: 0,
  wechatAutoTestedOnce: false,
  // 第 2 步检测状态
  aiChecking: false,
  aiTestedOk: false,
  aiTestedSignature: '',
  aiTestError: '',
  aiTestProviderName: '',
  aiAutoTestedSig: '',
  // 第 3 步草稿与检测状态
  groupMode: 'notice',     // notice | fun
  groupQuery: '',
  draftGroups: [],
  draftFunGroups: [],
  groupsSaved: false,
  groupLoadError: '',
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

function setOnboardingLock(locked) {
  setupState.mandatory = Boolean(locked);
  document.body.classList.toggle('onboarding-locked', setupState.mandatory);
  if ($('closeSetup')) $('closeSetup').hidden = setupState.mandatory;
  if ($('skipSetupBtn')) $('skipSetupBtn').hidden = setupState.mandatory;
}

function diagRowHtml({ status = 'warn', title, desc }) {
  const icon = status === 'ok' ? '✓' : status === 'err' ? '✕' : status === 'checking' ? '…' : '!';
  return `
    <div class="diag-row ${status}">
      <span class="diag-dot">${icon}</span>
      <div class="diag-body">
        <div class="diag-title">${esc(title)}</div>
        <div class="diag-desc">${esc(desc)}</div>
      </div>
    </div>
  `;
}

// ── 每一步的真实通过判定 ──────────────────────────────────
function currentAiPayloadSignature() {
  const p = collectAiPayload();
  return JSON.stringify([p.aiProvider, p.apiKey || '', p.apiModel || '', p.apiBaseUrl || '']);
}

function isStep1Passed() {
  return Boolean(setupState.wechatTestedOk);
}

function isStep2ConfigComplete() {
  const p = collectAiPayload();
  if (p.aiProvider === 'workbuddy') {
    return Boolean(app.data?.env?.workbuddyCli);
  }
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(p.apiBaseUrl || '');
  return Boolean((p.apiKey || isLocal) && p.apiBaseUrl && p.apiModel);
}

function isStep2Passed() {
  return Boolean(setupState.aiTestedOk && setupState.aiTestedSignature === currentAiPayloadSignature());
}

function isStep3TimeValid() {
  const val = $('wizardAutoTime')?.value || '20:00';
  return /^\d{2}:\d{2}$/.test(val);
}

function isStep3Passed() {
  const hasGroups = (setupState.draftGroups.length + setupState.draftFunGroups.length) > 0;
  return Boolean(hasGroups && isStep3TimeValid());
}

function canEnterStep(targetStep) {
  if (!setupState.mandatory) return true;
  if (targetStep <= setupState.step) return true;
  if (targetStep === 2) return isStep1Passed();
  if (targetStep === 3) return isStep1Passed() && isStep2Passed();
  if (targetStep === 4) return isStep1Passed() && isStep2Passed() && isStep3Passed();
  return false;
}

// ── Step 1: 本地微信环境检测 + 实测读群 ───────────────────
async function refreshDiagnostics({ autoTestWechat = false } = {}) {
  try {
    const res = await api('/api/setup/diagnostics');
    if (res.ok) {
      setupState.diagnostics = res;
      renderWechatDiagnostics();
      updateStepBadges();
      if (setupState.step === 4) renderWizardSummary();
      if (autoTestWechat && !setupState.wechatAutoTestedOnce && !setupState.wechatChecking) {
        setupState.wechatAutoTestedOnce = true;
        if (res.wechat?.ready) {
          runWechatTest({ quiet: true });
        }
      }
    }
  } catch {}
}

function renderWechatDiagnostics() {
  const list = $('wechatDiagList');
  if (!list) return;
  const wx = setupState.diagnostics?.wechat;
  if (!wx) {
    list.innerHTML = diagRowHtml({
      status: 'checking',
      title: '正在检测本机微信读取环境…',
      desc: '请稍候',
    });
    return;
  }
  const c = wx.checks || {};
  const liveStatus = setupState.wechatChecking
    ? 'checking'
    : (setupState.wechatTestedOk ? 'ok' : (setupState.wechatTestError ? 'err' : 'warn'));
  const liveDesc = setupState.wechatChecking
    ? '正在实测读取本地微信会话列表…'
    : (setupState.wechatTestedOk
      ? `实测通过！已读取到 ${setupState.wechatGroupCount} 个群聊、${setupState.wechatFriendCount} 位好友`
      : (setupState.wechatTestError || '尚未通过实测读取，请点击右上角「实测读取微信」验证'));

  const rows = [
    {
      status: c.pythonVenv && c.queryScript ? 'ok' : 'err',
      title: '1) 微信读取组件（wechat-decrypt / .venv）',
      desc: c.pythonVenv && c.queryScript ? `已就绪（${wx.skillDir}）` : `未检测到可用 .venv 或 query.py（目标：${wx.skillDir}）`,
    },
    {
      status: c.keyFile ? 'ok' : 'err',
      title: '2) 本机微信数据库密钥',
      desc: c.keyFile ? '已检测到本机密钥文件' : '未检测到密钥文件，请用下方 AI 助手一键配置或手动提取密钥',
    },
    {
      status: (wx.isWindows ? c.decryptedDb : c.sqlcipher) ? 'ok' : 'err',
      title: wx.isWindows ? '3) 明文聊天数据库（decrypted）' : '3) SQLCipher 只读引擎',
      desc: wx.isWindows
        ? (c.decryptedDb ? '已检测到解密后的数据库目录（整理时自动增量同步）' : '尚未生成明文库，点击「实测读取微信」或运行 decrypt_all.py')
        : (c.sqlcipher ? '已就绪，支持直接只读微信数据库' : '缺少 tools/sqlcipher-arm64.sh'),
    },
    {
      status: liveStatus,
      title: '4) 实测读取微信群聊列表（必过项）',
      desc: liveDesc,
    },
  ];
  list.innerHTML = rows.map(diagRowHtml).join('');

  switchWechatOs(wx.isWindows ? 'win' : 'mac');
  renderWechatAgentAssist();
}

async function runWechatTest({ quiet = false } = {}) {
  if (setupState.wechatChecking) return setupState.wechatTestedOk;
  const btn = $('testWechatBtn');
  setupState.wechatChecking = true;
  setupState.wechatTestError = '';
  if (btn) btn.disabled = true;
  if (!quiet) setWechatFeedback('正在实测同步并读取本机微信会话列表…', 'info');
  renderWechatDiagnostics();
  updateStepBadges();

  try {
    const res = await api('/api/setup/test-wechat', { method: 'POST', body: '{}' });
    if (res.wechat && setupState.diagnostics) setupState.diagnostics.wechat = res.wechat;
    if (res.ok && (res.total > 0 || (Array.isArray(res.chats) && res.chats.length > 0))) {
      setupState.wechatTestedOk = true;
      setupState.wechatTestError = '';
      setupState.wechatGroupCount = res.groupCount || 0;
      setupState.wechatFriendCount = res.friendCount || 0;
      if (Array.isArray(res.chats) && res.chats.length) {
        app.groupCache = res.chats;
        setupState.groupLoadError = '';
      }
      setWechatFeedback(`✓ 检测通过！已成功读取 ${res.groupCount} 个微信群聊、${res.friendCount} 位好友，可点击「下一步」。`, 'ok');
      return true;
    }
    setupState.wechatTestedOk = false;
    const msg = res.ok
      ? '读取到了空的会话列表，请确认电脑版微信已登录并有聊天记录后重试'
      : (res.error || '读取微信失败，请按下方 AI 助手一键配置或手动步骤排查');
    setupState.wechatTestError = msg;
    setWechatFeedback(msg, 'err');
    return false;
  } catch (err) {
    setupState.wechatTestedOk = false;
    setupState.wechatTestError = err?.message || '实测读取微信失败';
    setWechatFeedback(setupState.wechatTestError, 'err');
    return false;
  } finally {
    setupState.wechatChecking = false;
    if (btn) btn.disabled = false;
    renderWechatDiagnostics();
    updateStepBadges();
    if (setupState.step === 3) renderGroupDiagnostics();
    if (setupState.step === 4) renderWizardSummary();
  }
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
    '4. 在项目目录运行以下命令验证能读出微信群聊列表，并把群数量反馈给我：',
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

// ── Step 2: AI 渠道商（默认 DeepSeek）+ 真实连通性检测 ────
function renderAiDiagnostics() {
  const list = $('aiDiagList');
  if (!list) return;
  const payload = collectAiPayload();
  const meta = getProviderMeta(payload.aiProvider);
  const cfgOk = isStep2ConfigComplete();
  const passed = isStep2Passed();

  let cfgDesc = '';
  if (payload.aiProvider === 'workbuddy') {
    cfgDesc = app.data?.env?.workbuddyCli
      ? `已检测到 WorkBuddy 命令行（${app.data.env.workbuddyCli}）`
      : '本机未检测到 WorkBuddy 命令行，请改用左侧 API Key 方式';
  } else if (cfgOk) {
    cfgDesc = `已填写 ${meta.shortName} 参数（模型：${payload.apiModel}）`;
  } else {
    cfgDesc = `请补全 ${meta.shortName} 的 API Key、模型名称与接口地址`;
  }

  const connStatus = setupState.aiChecking
    ? 'checking'
    : (passed ? 'ok' : (setupState.aiTestError ? 'err' : 'warn'));
  const connDesc = setupState.aiChecking
    ? `正在向 ${meta.shortName} 发送探测请求，验证 Key 与网络连通性…`
    : (passed
      ? `实测通过！当前通道：${setupState.aiTestProviderName || meta.shortName}`
      : (setupState.aiTestError || '尚未验证连通性，请点「实测连接 AI」或直接点「检测并进入下一步」'));

  list.innerHTML = [
    diagRowHtml({
      status: cfgOk ? 'ok' : 'warn',
      title: '1) 渠道参数完整性',
      desc: cfgDesc,
    }),
    diagRowHtml({
      status: connStatus,
      title: '2) 模型真实连通性验证（必过项）',
      desc: connDesc,
    }),
  ].join('');
}

function invalidateAiTestIfChanged() {
  if (setupState.aiTestedOk && setupState.aiTestedSignature !== currentAiPayloadSignature()) {
    setupState.aiTestedOk = false;
    setupState.aiTestError = '';
  }
  renderAiDiagnostics();
  updateStepBadges();
}

async function runAiConnectionTest({ quiet = false } = {}) {
  if (setupState.aiChecking) return isStep2Passed();
  const payload = collectAiPayload();
  if (!isStep2ConfigComplete()) {
    const msg = payload.aiProvider === 'workbuddy'
      ? '本机未检测到 WorkBuddy 命令行，请改用左侧 DeepSeek 等 API Key 渠道'
      : '请先填完整 API Key、模型名称与 Base URL';
    setupState.aiTestedOk = false;
    setupState.aiTestError = msg;
    if (!quiet) setSetupFeedback(msg, 'err');
    renderAiDiagnostics();
    updateStepBadges();
    return false;
  }

  const sig = currentAiPayloadSignature();
  setupState.aiChecking = true;
  setupState.aiTestError = '';
  const testBtn = $('testSetupBtn');
  const recheckBtn = $('recheckAiBtn');
  if (testBtn) testBtn.disabled = true;
  if (recheckBtn) recheckBtn.disabled = true;
  if (!quiet) setSetupFeedback('正在实测模型连接（验证 Key 有效性与网络连通）…', 'info');
  renderAiDiagnostics();
  updateStepBadges();

  try {
    const res = await api('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setupState.aiTestedOk = true;
      setupState.aiTestedSignature = sig;
      setupState.aiTestError = '';
      setupState.aiTestProviderName = res.providerName || getProviderMeta(payload.aiProvider).shortName;
      setSetupFeedback(`✓ 连接测试通过！当前通道：${setupState.aiTestProviderName}`, 'ok');
      return true;
    }
    setupState.aiTestedOk = false;
    setupState.aiTestError = res.error || '模型连接失败，请检查 Key、余额或网络';
    setSetupFeedback(`连接失败：${setupState.aiTestError}`, 'err');
    return false;
  } catch (err) {
    setupState.aiTestedOk = false;
    setupState.aiTestError = err?.message || '请求测试接口失败';
    setSetupFeedback(`连接失败：${setupState.aiTestError}`, 'err');
    return false;
  } finally {
    setupState.aiChecking = false;
    if (testBtn) testBtn.disabled = false;
    if (recheckBtn) recheckBtn.disabled = false;
    renderAiDiagnostics();
    updateStepBadges();
    if (setupState.step === 4) renderWizardSummary();
  }
}

function renderSetupProviderGrid() {
  const grid = $('setupProviderGrid');
  if (!grid) return;
  const apiProviders = aiProvidersList().filter((p) => p.authType === 'apiKey');
  grid.innerHTML = buildProviderGridHtml({
    providers: apiProviders,
    activeId: setupState.providerId,
    attrName: 'data-provider',
  });
}

function applySetupProvider(providerId) {
  const meta = getProviderMeta(providerId);
  setupState.providerId = meta.id;
  renderSetupProviderGrid();
  syncProviderFieldsUi({
    meta,
    saved: savedProfileFor(meta.id),
    tipEl: $('setupProviderTip'),
    consoleLinkEl: $('setupConsoleLink'),
    keyInputEl: $('setupApiKey'),
    modelInputEl: $('setupApiModel'),
    baseInputEl: $('setupApiBaseUrl'),
    modelChipsEl: $('setupModelChips'),
    modelChipAttr: 'data-setup-model',
    deepseekGuideEl: $('setupDeepseekGuide'),
    baseDetailsEl: $('setupBaseUrlDetails'),
  });
  invalidateAiTestIfChanged();
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
      : '<span class="warn-dot">●</span> 本机未检测到 WorkBuddy 命令行，建议使用左侧 DeepSeek 等 API Key 方式';
  }
  if ($('launchWorkbuddyLogin')) $('launchWorkbuddyLogin').disabled = !app.data?.env?.workbuddyCli;
  setSetupFeedback('');
  invalidateAiTestIfChanged();
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
    apiKey: ($('setupApiKey')?.value || '').trim(),
    apiModel: ($('setupApiModel')?.value || '').trim(),
    apiBaseUrl: ($('setupApiBaseUrl')?.value || '').trim(),
  };
}

// ── Step 3: 挑选群聊与定时 + 完整性检测 ───────────────────
function renderGroupDiagnostics() {
  const list = $('groupDiagList');
  if (!list) return;
  const cached = Array.isArray(app.groupCache) ? app.groupCache : null;
  const loadedOk = Boolean(cached && cached.length > 0);
  const totalSelected = setupState.draftGroups.length + setupState.draftFunGroups.length;
  const timeVal = $('wizardAutoTime')?.value || '20:00';
  const timeOk = isStep3TimeValid();

  list.innerHTML = [
    diagRowHtml({
      status: loadedOk ? 'ok' : (setupState.groupLoadError ? 'err' : 'checking'),
      title: '1) 本地微信会话列表',
      desc: loadedOk
        ? `已加载 ${cached.length} 个会话，可按名称搜索并勾选`
        : (setupState.groupLoadError || '正在读取本地微信群聊列表…'),
    }),
    diagRowHtml({
      status: totalSelected > 0 ? 'ok' : 'warn',
      title: '2) 监听群聊选择（必过项）',
      desc: totalSelected > 0
        ? `已勾选 ${setupState.draftGroups.length} 个通知群 · ${setupState.draftFunGroups.length} 个娱乐群`
        : '请至少勾选 1 个通知群或娱乐群',
    }),
    diagRowHtml({
      status: timeOk ? 'ok' : 'err',
      title: '3) 自动整理时间',
      desc: timeOk ? `每天 ${timeVal} 自动整理` : '请设置有效的每日自动整理时间（HH:mm）',
    }),
  ].join('');
}

function wizardGroupListHtml() {
  const isFun = setupState.groupMode === 'fun';
  return buildGroupListHtml({
    chats: app.groupCache || [],
    chosenList: isFun ? setupState.draftFunGroups : setupState.draftGroups,
    isFun,
    query: setupState.groupQuery,
    emptyHtml: '<div class="grp-empty">暂未读取到微信群，可点击右上角「🔄 刷新群聊」或返回第 1 步检测微信环境。</div>',
    checkboxAttr: 'data-wzxid',
    maxItems: 120,
  });
}

function renderWizardGroupPicker() {
  const wrap = $('wizardGroupPickerWrap');
  if (!wrap) return;
  wrap.innerHTML = renderGroupPickerHtml({
    idPrefix: 'wizardGrp',
    activeMode: setupState.groupMode,
    noticeCount: setupState.draftGroups.length,
    funCount: setupState.draftFunGroups.length,
    query: setupState.groupQuery,
    listHtml: app.groupCache ? wizardGroupListHtml() : '<div class="grp-empty">正在读取微信群列表…</div>',
    listClass: 'grp-list wizard-grp-list',
  });

  $('wizardGrpMode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-gmode]');
    if (!btn) return;
    setupState.groupMode = btn.dataset.gmode;
    for (const b of $('wizardGrpMode').querySelectorAll('[data-gmode]')) {
      b.classList.toggle('on', b.dataset.gmode === setupState.groupMode);
    }
    $('wizardGrpHint').textContent = setupState.groupMode === 'fun'
      ? '勾选游戏群、吃喝群、闲聊群，AI 会生成像真人群友复盘一样的省流群聊总结。'
      : '勾选班群、学院通知群、作业群等，AI 会自动提取截止时间和待办卡片。';
    $('wizardGrpList').innerHTML = wizardGroupListHtml();
  });

  $('wizardGrpSearch')?.addEventListener('input', (e) => {
    setupState.groupQuery = e.target.value;
    $('wizardGrpList').innerHTML = wizardGroupListHtml();
  });

  $('wizardGrpRefresh')?.addEventListener('click', async () => {
    const btn = $('wizardGrpRefresh');
    const box = $('wizardGrpList');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '刷新中…';
    setupState.groupLoadError = '';
    if (box) box.innerHTML = '<div class="grp-empty">正在重新拉取微信群列表…</div>';
    renderGroupDiagnostics();
    try {
      const res = await api('/api/groups', { method: 'POST' });
      if (res.ok === false) throw new Error(res.error || '读取失败');
      app.groupCache = Array.isArray(res.chats) ? res.chats : [];
      app.groupError = null;
      if (app.groupCache.length) {
        setupState.wechatTestedOk = true;
        setupState.wechatGroupCount = app.groupCache.filter((c) => c.isGroup).length;
        setupState.wechatFriendCount = app.groupCache.filter((c) => c.isFriend).length;
      }
      if (box) box.innerHTML = wizardGroupListHtml();
      toast(`已刷新，读取到 ${app.groupCache.length} 个微信会话`);
    } catch (err) {
      const msg = err?.isNetwork
        ? '连不上本地服务，请确认启动窗口还在运行'
        : String(err?.message || '请先完成第 1 步本地微信配置').slice(0, 160);
      setupState.groupLoadError = msg;
      if (box) {
        box.innerHTML = `<div class="grp-empty">暂时无法读取微信群列表（${esc(msg)}），可点击右上角「🔄 刷新群聊」重试。</div>`;
      }
      toast(`刷新群聊失败：${msg}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 刷新群聊';
      renderGroupDiagnostics();
      updateStepBadges();
    }
  });

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
    $('wizardGrpNoticeTab').textContent = `📚 通知群 (${setupState.draftGroups.length})`;
    $('wizardGrpFunTab').textContent = `🎮 娱乐群 (${setupState.draftFunGroups.length})`;
    renderGroupDiagnostics();
    updateStepBadges();
  });

  renderGroupDiagnostics();
}

async function loadWizardGroups() {
  renderWizardGroupPicker();
  if (app.groupCache && app.groupCache.length) {
    renderGroupDiagnostics();
    return;
  }
  try {
    const res = await api('/api/groups', { method: 'POST' });
    app.groupCache = Array.isArray(res.chats) ? res.chats : [];
    setupState.groupLoadError = '';
    const box = $('wizardGrpList');
    if (box) box.innerHTML = wizardGroupListHtml();
  } catch (e) {
    setupState.groupLoadError = e.message || '请先完成第 1 步本地微信配置';
    const box = $('wizardGrpList');
    if (box) {
      box.innerHTML = `<div class="grp-empty">暂时无法读取微信群列表（${esc(setupState.groupLoadError)}），请返回第 1 步完成微信读取检测。</div>`;
    }
  } finally {
    renderGroupDiagnostics();
    updateStepBadges();
  }
}

// ── Step 4: 全链路总览与最终门禁 ──────────────────────────
function renderWizardSummary() {
  const box = $('wizardSummaryList');
  if (!box) return;
  const wxOk = isStep1Passed();
  const aiOk = isStep2Passed();
  const grpOk = isStep3Passed();
  const allOk = wxOk && aiOk && grpOk;
  const pName = setupState.aiTestProviderName || app.data?.env?.providerName || getProviderMeta(setupState.providerId).shortName;
  const bridge = setupState.diagnostics?.bridge;

  if ($('wizardBridgeDesc') && bridge) {
    $('wizardBridgeDesc').textContent = bridge.enabled && bridge.listening
      ? `局域网同步已开启（端口 ${bridge.port}，配对码 ${bridge.token}），手机端可直接同步。`
      : '开启局域网配对后，电脑整理出的日程会自动同步到手机「轻松打卡」的今日日程。';
  }

  const items = [
    {
      step: 1,
      status: setupState.wechatChecking ? 'checking' : (wxOk ? 'ok' : 'err'),
      title: '1. 读取本地微信（实测读群）',
      desc: wxOk
        ? `已实测通过 · 检测到 ${setupState.wechatGroupCount} 个群聊、${setupState.wechatFriendCount} 位好友`
        : (setupState.wechatTestError || '尚未通过实测读取，点击返回第 1 步检测'),
    },
    {
      step: 2,
      status: setupState.aiChecking ? 'checking' : (aiOk ? 'ok' : 'err'),
      title: '2. AI 整理渠道（实测连通）',
      desc: aiOk
        ? `已实测通过 · 当前通道：${pName}`
        : (setupState.aiTestError || '尚未通过模型连通性测试，点击返回第 2 步检测'),
    },
    {
      step: 3,
      status: grpOk ? 'ok' : 'err',
      title: '3. 监听群聊与定时',
      desc: grpOk
        ? `已选 ${setupState.draftGroups.length} 个通知群 · ${setupState.draftFunGroups.length} 个娱乐群（每天 ${$('wizardAutoTime')?.value || '20:00'} 自动整理）`
        : '请至少勾选 1 个通知群或娱乐群并确认整理时间有效',
    },
  ];
  box.innerHTML = items.map((it) => `
    <button type="button" class="summary-row ${it.status}" data-jump-step="${it.step}">
      <span class="diag-dot">${it.status === 'ok' ? '✓' : it.status === 'checking' ? '…' : '✕'}</span>
      <div class="diag-body">
        <div class="diag-title">${esc(it.title)}</div>
        <div class="diag-desc">${esc(it.desc)}</div>
      </div>
      <span class="summary-edit">${it.status === 'ok' ? '已通过 ›' : '去修复 ›'}</span>
    </button>
  `).join('');

  if ($('saveSetupBtn')) $('saveSetupBtn').disabled = !allOk;
  if ($('saveOnlyBtn')) $('saveOnlyBtn').disabled = !allOk;
  if (!allOk) {
    setSetupFeedback('请先完成上方标红的检测项，全部通过后即可进入轻松日程主页面。', 'info');
  } else {
    setSetupFeedback('✓ 全部配置检测通过！点击下方按钮即可正式进入轻松日程。', 'ok');
  }
}

async function runFullWizardRecheck() {
  const btn = $('recheckAllBtn');
  if (btn) btn.disabled = true;
  setSetupFeedback('正在执行全链路重新检测（微信读取 + AI 连通 + 群聊配置）…', 'info');
  try {
    await refreshDiagnostics({ autoTestWechat: false });
    await runWechatTest({ quiet: true });
    await runAiConnectionTest({ quiet: true });
    renderWizardSummary();
    updateStepBadges();
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── 步骤切换与状态圆点 ────────────────────────────────────
function updateStepBadges() {
  const s1 = isStep1Passed();
  const s2 = isStep2Passed();
  const s3 = isStep3Passed();
  const states = [s1, s2, s3, s1 && s2 && s3];
  for (let i = 1; i <= 4; i++) {
    const btn = $('wizardSteps')?.querySelector(`[data-step="${i}"]`);
    const badge = $(`stepBadge${i}`);
    if (!btn || !badge) continue;
    const allowed = canEnterStep(i);
    btn.classList.toggle('on', setupState.step === i);
    btn.classList.toggle('done', states[i - 1]);
    btn.classList.toggle('locked', !allowed);
    badge.textContent = states[i - 1] ? '✓' : String(i);
  }
}

function goWizardStep(step) {
  const target = Math.max(1, Math.min(4, Number(step) || 1));
  if (!canEnterStep(target)) {
    const hint = !isStep1Passed()
      ? '请先完成第 1 步「实测读取微信」检测后再继续'
      : (!isStep2Passed()
        ? '请先完成第 2 步「AI 连通性检测」后再继续'
        : '请先在第 3 步至少勾选 1 个群聊后再继续');
    setSetupFeedback(hint, 'err');
    return;
  }
  setupState.step = target;
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

  $('wizardNextBtn').textContent = setupState.step === 1
    ? '检测微信并下一步 →'
    : (setupState.step === 2
      ? '检测 AI 并下一步 →'
      : (setupState.step === 3 ? '保存选群并下一步 →' : '下一步 →'));

  updateStepBadges();
  if (setupState.step === 1) {
    refreshDiagnostics({ autoTestWechat: true });
  }
  if (setupState.step === 2) {
    renderAiDiagnostics();
    const sig = currentAiPayloadSignature();
    if (isStep2ConfigComplete() && !isStep2Passed() && setupState.aiAutoTestedSig !== sig && !setupState.aiChecking) {
      setupState.aiAutoTestedSig = sig;
      runAiConnectionTest({ quiet: true });
    }
  }
  if (setupState.step === 3) {
    loadWizardGroups();
  }
  if (setupState.step === 4) {
    refreshDiagnostics({ autoTestWechat: false });
    renderWizardSummary();
  }
}

async function saveAiStep({ requireConnectionTest = true } = {}) {
  const payload = collectAiPayload();
  if (payload.aiProvider !== 'workbuddy') {
    const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(payload.apiBaseUrl);
    if (!payload.apiKey && !isLocal) {
      setSetupFeedback('请先填写 API Key（或切到「账号登录」使用 WorkBuddy）', 'err');
      $('setupApiKey')?.focus();
      return false;
    }
    if (!payload.apiBaseUrl || !payload.apiModel) {
      setSetupFeedback('请补全接口 Base URL 与模型名称', 'err');
      return false;
    }
  }
  if (requireConnectionTest && !isStep2Passed()) {
    const ok = await runAiConnectionTest({ quiet: false });
    if (!ok) return false;
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
  updateStepBadges();
  return true;
}

async function saveGroupsStep() {
  if ((setupState.draftGroups.length + setupState.draftFunGroups.length) === 0) {
    setSetupFeedback('请至少勾选 1 个通知群或娱乐群后再进入下一步', 'err');
    renderGroupDiagnostics();
    return false;
  }
  if (!isStep3TimeValid()) {
    setSetupFeedback('请设置有效的每日自动整理时间', 'err');
    renderGroupDiagnostics();
    return false;
  }
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
  setupState.groupsSaved = true;
  renderGroupDiagnostics();
  updateStepBadges();
  return true;
}

function openSetupDialog({ step, reason, mandatory = false } = {}) {
  if (!setupDialog || !app.data) return;
  const s = app.data.settings || {};
  const isMandatory = Boolean(mandatory || !s.onboardingDone);
  setOnboardingLock(isMandatory);

  setupState.draftGroups = (s.groups || []).map((g) => ({ ...g }));
  setupState.draftFunGroups = (s.funGroups || []).map((g) => ({ ...g }));
  setupState.wechatAutoTestedOnce = false;
  setupState.aiAutoTestedSig = '';

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
    initialStep = 1;
  }
  // 强制模式下从第 1 步或首个未通过步骤开始
  if (isMandatory && !canEnterStep(initialStep)) {
    initialStep = 1;
  }
  goWizardStep(initialStep);
  if (reason) setSetupFeedback(reason, 'info');
  if (!setupDialog.open) setupDialog.showModal();
}

function maybeOpenOnboarding() {
  if (!app.data) return;
  const s = app.data.settings || {};
  // 凡是首次打开（onboardingDone 为 false）一律强制弹出配置向导，配置通过检测后才进入主页面
  if (!s.onboardingDone) {
    setOnboardingLock(true);
    if (!setupState.autoShown || !setupDialog?.open) {
      setupState.autoShown = true;
      openSetupDialog({ step: 1, mandatory: true });
    }
    return;
  }
  setOnboardingLock(false);
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

// 首次强制模式下拦截 ESC 关闭，必须完成配置检测才能进入主页面
setupDialog?.addEventListener('cancel', (e) => {
  if (setupState.mandatory) {
    e.preventDefault();
    setSetupFeedback('首次使用请按步骤完成配置检测，全部通过后即可进入轻松日程主页面。', 'info');
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
  } catch (err) {
    setAgentFeedback(err?.message || `打开 ${agentName} 失败，但配置指令已复制到剪贴板`, 'err');
  } finally {
    btn.disabled = false;
  }
});

$('testWechatBtn')?.addEventListener('click', () => runWechatTest({ quiet: false }));

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
  invalidateAiTestIfChanged();
});

for (const id of ['setupApiKey', 'setupApiModel', 'setupApiBaseUrl']) {
  $(id)?.addEventListener('input', invalidateAiTestIfChanged);
}

$('wizardAutoTime')?.addEventListener('input', () => {
  renderGroupDiagnostics();
  updateStepBadges();
});

$('setupKeyPaste')?.addEventListener('click', async () => {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) {
      setSetupFeedback('剪贴板里没有文本，请先复制 API Key', 'err');
      return;
    }
    $('setupApiKey').value = text;
    invalidateAiTestIfChanged();
    setSetupFeedback('已粘贴 API Key，点「实测连接 AI」验证或直接点「检测 AI 并下一步」', 'info');
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
  try {
    const res = await api('/api/ai/workbuddy-login', { method: 'POST', body: '{}' });
    setSetupFeedback(res.ok ? res.message : (res.error || '启动登录失败'), res.ok ? 'ok' : 'err');
  } catch (err) {
    setSetupFeedback(err?.message || '启动登录失败', 'err');
  }
});

$('testSetupBtn')?.addEventListener('click', () => runAiConnectionTest({ quiet: false }));
$('recheckAiBtn')?.addEventListener('click', () => runAiConnectionTest({ quiet: false }));
$('recheckAllBtn')?.addEventListener('click', runFullWizardRecheck);

$('wizardPrevBtn')?.addEventListener('click', () => goWizardStep(setupState.step - 1));

$('wizardNextBtn')?.addEventListener('click', async () => {
  const btn = $('wizardNextBtn');
  btn.disabled = true;
  try {
    if (setupState.step === 1) {
      if (!isStep1Passed()) {
        const ok = await runWechatTest({ quiet: false });
        if (!ok) return;
      }
    } else if (setupState.step === 2) {
      const ok = await saveAiStep({ requireConnectionTest: true });
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
  if (!(isStep1Passed() && isStep2Passed() && isStep3Passed())) {
    renderWizardSummary();
    setSetupFeedback('仍有未通过检测的项目，请全部通过后再进入主页面。', 'err');
    return;
  }
  // 兜底把当前 AI 与选群配置再次落盘并标记 onboardingDone: true
  await saveAiStep({ requireConnectionTest: false }).catch(() => {});
  await saveGroupsStep().catch(() => {});
  await api('/api/settings', { method: 'POST', body: JSON.stringify({ onboardingDone: true }) }).catch(() => {});
  setOnboardingLock(false);
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
    toast('✓ 配置全部就绪，欢迎使用轻松日程！');
  }
}

$('saveOnlyBtn')?.addEventListener('click', () => finishWizard({ runNow: false }));
$('saveSetupBtn')?.addEventListener('click', () => finishWizard({ runNow: true }));

function dismissSetupGuide() {
  if (setupState.mandatory) {
    setSetupFeedback('首次使用需先完成配置检测，通过后即可进入主页面。', 'info');
    return;
  }
  setupDialog.close();
}

$('skipSetupBtn')?.addEventListener('click', dismissSetupGuide);
$('closeSetup')?.addEventListener('click', dismissSetupGuide);
ModalQueue.bindBackdropClose(setupDialog, {
  canClose: () => !setupState.mandatory,
  onClose: dismissSetupGuide,
});
