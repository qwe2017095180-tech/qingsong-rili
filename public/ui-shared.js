// 公共 UI 组件与弹窗队列（供 app.js / setup.js / update.js 共用，消除重复渲染逻辑）

const ModalQueue = (() => {
  const pending = new Map();
  let timer = null;

  function hasOpenDialog() {
    return Boolean(document.querySelector('dialog[open]'));
  }

  function drain() {
    clearTimeout(timer);
    timer = null;
    if (hasOpenDialog() || pending.size === 0) return;
    const sorted = [...pending.values()].sort((a, b) => a.priority - b.priority);
    const next = sorted[0];
    if (!next) return;
    pending.delete(next.id);
    try {
      next.openFn();
    } catch {}
    // 若回调本身决定不弹出，则继续检查队列下一项
    if (!hasOpenDialog() && pending.size > 0) {
      timer = setTimeout(drain, 60);
    }
  }

  return {
    /**
     * 按优先级调度自动弹窗：1 = 更新提示，2 = 配置向导，3 = 新公告
     */
    enqueue(priority, id, openFn) {
      pending.set(id, { priority, id, openFn });
      if (hasOpenDialog()) return;
      clearTimeout(timer);
      timer = setTimeout(drain, 160);
    },

    cancel(id) {
      pending.delete(id);
    },

    notifyClosed() {
      if (pending.size === 0) return;
      clearTimeout(timer);
      timer = setTimeout(drain, 180);
    },

    /** 统一绑定原生 <dialog> 的遮罩点击关闭与队列联动 */
    bindBackdropClose(dialog, { canClose = () => true, onClose } = {}) {
      if (!dialog || dialog.dataset.mqBound) return;
      dialog.dataset.mqBound = '1';
      dialog.addEventListener('click', (event) => {
        if (event.target !== dialog || !canClose()) return;
        if (typeof onClose === 'function') onClose();
        else dialog.close();
      });
      dialog.addEventListener('close', () => {
        ModalQueue.notifyClosed();
      });
    },
  };
})();

/** 生成群聊列表 HTML（供「更多 → 群聊与定时」与「向导第 3 步」复用） */
function buildGroupListHtml({
  chats,
  chosenList,
  isFun = false,
  query = '',
  emptyHtml = '',
  checkboxAttr = 'data-wxid',
  maxItems = 160,
}) {
  const list = Array.isArray(chats) ? chats : [];
  const chosen = new Map((chosenList || []).map((g) => [g.wxid, g]));
  const visible = list.filter((g) =>
    isFun ? (g.isGroup || chosen.has(g.wxid)) : (g.isGroup || g.isFriend || chosen.has(g.wxid))
  );
  if (!visible.length) {
    return emptyHtml || '<div class="grp-empty">暂未读取到微信群</div>';
  }
  const q = String(query || '').trim().toLowerCase();
  const filtered = visible.filter((g) =>
    !q || String(g.display || '').toLowerCase().includes(q) || (g.isGroup ? '群聊' : '好友').includes(q)
  );
  if (!filtered.length) {
    return '<div class="grp-empty">没有匹配的群聊</div>';
  }
  const slice = q ? filtered : filtered.slice(0, maxItems);
  return slice.map((g) => `
    <label class="grp-row">
      <input type="checkbox" ${checkboxAttr}="${esc(g.wxid)}" ${chosen.has(g.wxid) ? 'checked' : ''} />
      <span class="grp-name">${esc(g.display)}</span>
      <span class="grp-time">${relTime(g.ts)}</span>
      <span class="tag">${g.isGroup ? '群聊' : (g.isFriend ? '好友' : '其他')}</span>
    </label>
  `).join('');
}

/** 生成统一的双标签群选择卡片 HTML */
function renderGroupPickerHtml({
  idPrefix,
  activeMode = 'notice',
  noticeCount = 0,
  funCount = 0,
  query = '',
  listHtml = '<div class="grp-empty">正在读取微信群列表…</div>',
  listClass = 'grp-list',
}) {
  const isFun = activeMode === 'fun';
  const hint = isFun
    ? '勾选游戏群、吃喝群、闲聊群，AI 会生成像真人群友复盘一样的省流群聊总结。'
    : '勾选班群、学院通知群、作业群等，AI 会自动提取截止时间和待办卡片。';
  return `
    <div class="seg" id="${idPrefix}Mode">
      <button type="button" class="${!isFun ? 'on' : ''}" data-gmode="notice" id="${idPrefix}NoticeTab">📚 通知群 (${noticeCount})</button>
      <button type="button" class="${isFun ? 'on' : ''}" data-gmode="fun" id="${idPrefix}FunTab">🎮 娱乐群 (${funCount})</button>
    </div>
    <div class="s-desc picker-hint" id="${idPrefix}Hint">${hint}</div>
    <input class="s-input grp-search" id="${idPrefix}Search" placeholder="搜索群名或好友…" value="${esc(query)}" />
    <div class="${listClass}" id="${idPrefix}List">${listHtml}</div>
  `;
}

/** 生成带官方矢量图标的渠道商选择网格 HTML */
function buildProviderGridHtml({ providers, activeId, attrName = 'data-provider', gridClass = '' }) {
  return (providers || []).map((p) => `
    <button type="button" class="provider-pill ${p.id === activeId ? 'on' : ''}" ${attrName}="${esc(p.id)}">
      <span class="provider-pill-top">
        ${providerIconHtml(p.id, 22)}
        <span class="provider-pill-name">${esc(p.shortName)}</span>
      </span>
      ${p.badge ? `<span class="provider-pill-badge">${esc(p.badge)}</span>` : ''}
    </button>
  `).join('');
}

/** 同步 AI 渠道商的提示语、官网链接、输入框占位与模型快捷芯片 */
function syncProviderFieldsUi({
  meta,
  saved = {},
  tipEl,
  consoleLinkEl,
  keyInputEl,
  modelInputEl,
  baseInputEl,
  modelChipsEl,
  modelChipAttr = 'data-model-pick',
  deepseekGuideEl = null,
  baseDetailsEl = null,
}) {
  if (!meta) return;
  if (tipEl) tipEl.textContent = meta.help || '';
  if (deepseekGuideEl) deepseekGuideEl.hidden = meta.id !== 'deepseek';

  if (consoleLinkEl) {
    if (meta.consoleUrl) {
      consoleLinkEl.href = meta.consoleUrl;
      consoleLinkEl.textContent = `${meta.consoleLabel || '获取 API Key'} ↗`;
      consoleLinkEl.hidden = false;
    } else {
      consoleLinkEl.hidden = true;
    }
  }

  if (keyInputEl) {
    keyInputEl.value = saved.apiKey || '';
    keyInputEl.placeholder = meta.keyPlaceholder || '输入 API Key';
  }
  if (modelInputEl) {
    modelInputEl.value = saved.model || meta.defaultModel || '';
    modelInputEl.placeholder = meta.defaultModel ? `默认：${meta.defaultModel}` : '输入模型名称，例如 qwen2.5:14b';
  }
  if (baseInputEl) {
    baseInputEl.value = saved.baseUrl || meta.baseUrl || '';
    baseInputEl.placeholder = meta.baseUrl || '例如 http://127.0.0.1:11434/v1';
  }
  if (baseDetailsEl) {
    const customModified = Boolean(saved.baseUrl && meta.baseUrl && saved.baseUrl !== meta.baseUrl);
    baseDetailsEl.open = meta.id === 'custom' || customModified;
  }
  if (modelChipsEl) {
    modelChipsEl.innerHTML = (meta.models || []).map((m) =>
      `<button type="button" class="btn ghost mirror-chip" ${modelChipAttr}="${esc(m)}">${esc(m)}</button>`
    ).join('');
  }
}
