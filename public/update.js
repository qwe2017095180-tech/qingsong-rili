// 应用内自动检测更新 & 居中一键更新弹窗（启动即检测，支持镜像重试与忽略指定版本）
const UPDATE_AUTO_KEY = 'qs-update-auto';
const UPDATE_IGNORED_KEY = 'qs-update-ignored-tag';

const updateDialog = $('updateDialog');
const updateBadge = $('updateBadge');
const updateTitle = $('updateTitle');
const updateVerPill = $('updateVerPill');
const updateStatus = $('updateStatus');
const updateProgress = $('updateProgress');
const updateNotesBox = $('updateNotesBox');
const updateNotes = $('updateNotes');
const updateMirrorBox = $('updateMirrorBox');
const installUpdate = $('installUpdate');
const downloadUpdate = $('downloadUpdate');
const ignoreUpdate = $('ignoreUpdate');
const dismissUpdate = $('dismissUpdate');
const closeUpdate = $('closeUpdate');

let checkingUpdate = false;
let installingUpdate = false;
let currentUpdateTag = null;
let lastReleaseUrl = 'https://github.com/qwe2017095180-tech/qingsong-rili/releases/latest';

function setUpdateStatus(message, kind = 'normal') {
  updateStatus.textContent = message;
  updateStatus.classList.remove('update-error', 'update-ok');
  if (kind === 'error') updateStatus.classList.add('update-error');
  if (kind === 'ok') updateStatus.classList.add('update-ok');
}

function resetUpdateModalChrome() {
  updateProgress.hidden = true;
  updateMirrorBox.hidden = true;
  ignoreUpdate.hidden = true;
  installUpdate.hidden = true;
  installUpdate.disabled = false;
  installUpdate.textContent = '立即一键更新';
  downloadUpdate.hidden = true;
  dismissUpdate.disabled = false;
  dismissUpdate.textContent = '关闭';
  closeUpdate.disabled = false;
}

function reportInstalledUpdate(version) {
  resetUpdateModalChrome();
  updateBadge.textContent = '更新完成';
  updateTitle.textContent = `已安装 v${version}`;
  updateNotesBox.hidden = true;
  setUpdateStatus(`✓ 已成功更新至 v${version}！请退出并重新打开轻松日程生效。`, 'ok');
  if (!updateDialog.open) updateDialog.showModal();
}

function bindUpdateSettings(checkButton, autoToggle) {
  if (checkButton) checkButton.onclick = () => checkForAppUpdate({ silent: false });
  if (autoToggle) {
    autoToggle.checked = localStorage.getItem(UPDATE_AUTO_KEY) !== 'off';
    autoToggle.onchange = () => {
      localStorage.setItem(UPDATE_AUTO_KEY, autoToggle.checked ? 'on' : 'off');
    };
  }
}

function populateAvailableRelease(result, { allowIgnore }) {
  currentUpdateTag = result.tag;
  if (result.url) lastReleaseUrl = result.url;
  updateBadge.textContent = '发现新版本';
  updateTitle.textContent = `轻松日程 ${result.tag}`;
  updateVerPill.textContent = `v${result.current} → v${result.latest}`;
  updateVerPill.hidden = false;

  const notes = (result.notes || '').trim();
  updateNotes.textContent = notes || '常规功能优化与稳定性修复';
  updateNotesBox.hidden = false;

  setUpdateStatus(result.canInstall
    ? '已准备就绪，点击下方「立即一键更新」即可自动下载并完成升级。'
    : '当前为绿色压缩包版本，请点击下方按钮前往发布页下载新版压缩包。');

  ignoreUpdate.hidden = !allowIgnore;
  ignoreUpdate.onclick = () => {
    if (result.tag) localStorage.setItem(UPDATE_IGNORED_KEY, result.tag);
    updateDialog.close();
  };
  dismissUpdate.textContent = '稍后再说';

  if (result.canInstall) {
    installUpdate.hidden = false;
    installUpdate.textContent = '立即一键更新';
    installUpdate.onclick = () => installAppUpdate(result.tag);
    downloadUpdate.href = lastReleaseUrl;
    downloadUpdate.hidden = false;
  } else {
    downloadUpdate.href = lastReleaseUrl;
    downloadUpdate.textContent = '下载新版安装包';
    downloadUpdate.hidden = false;
  }
}

async function checkForAppUpdate({ silent = false } = {}) {
  if (checkingUpdate || installingUpdate || (silent && updateDialog.open)) return;
  checkingUpdate = true;
  resetUpdateModalChrome();
  updateBadge.textContent = '应用更新';
  updateTitle.textContent = '检查更新';
  updateVerPill.hidden = true;
  updateNotesBox.hidden = true;
  updateNotes.textContent = '';

  if (!silent) {
    setUpdateStatus('正在从 GitHub 检查最新版本…');
    updateProgress.hidden = false;
    updateDialog.showModal();
  }

  try {
    const result = await api('/api/update/check', { method: 'POST' });
    updateProgress.hidden = true;
    if (!result.ok) throw new Error(result.error || '检查更新失败');

    if (result.restartRequired) {
      if (silent) {
        ModalQueue.enqueue(1, 'update', () => reportInstalledUpdate(result.latest));
      } else {
        reportInstalledUpdate(result.latest);
      }
      return;
    }

    if (!result.hasUpdate) {
      if (!silent) {
        updateBadge.textContent = '已是最新';
        updateTitle.textContent = `当前 v${result.current}`;
        setUpdateStatus(result.latest
          ? `当前已是最新版本 v${result.current}`
          : `当前版本 v${result.current}，GitHub 暂无可用的稳定版`, 'ok');
      }
      return;
    }

    if (silent && localStorage.getItem(UPDATE_IGNORED_KEY) === result.tag) {
      return;
    }

    if (silent) {
      ModalQueue.enqueue(1, 'update', () => {
        if (updateDialog.open) return;
        resetUpdateModalChrome();
        populateAvailableRelease(result, { allowIgnore: true });
        updateDialog.showModal();
      });
    } else {
      populateAvailableRelease(result, { allowIgnore: false });
    }
  } catch (error) {
    updateProgress.hidden = true;
    if (!silent) {
      updateBadge.textContent = '检查失败';
      updateTitle.textContent = '无法连接更新源';
      setUpdateStatus(error.message || '检查更新失败', 'error');
      installUpdate.hidden = false;
      installUpdate.textContent = '重试';
      installUpdate.onclick = () => checkForAppUpdate({ silent: false });
      downloadUpdate.href = lastReleaseUrl;
      downloadUpdate.hidden = false;
    }
  } finally {
    checkingUpdate = false;
  }
}

async function installAppUpdate(tag, { mirror } = {}) {
  if (installingUpdate) return;
  installingUpdate = true;
  currentUpdateTag = tag;

  installUpdate.disabled = true;
  dismissUpdate.disabled = true;
  closeUpdate.disabled = true;
  ignoreUpdate.hidden = true;
  downloadUpdate.hidden = true;
  updateMirrorBox.hidden = true;
  updateProgress.hidden = false;
  updateBadge.textContent = '正在更新';
  setUpdateStatus(mirror !== undefined
    ? `正在通过 ${mirror || '直连'} 下载并安装…`
    : '正在下载更新并校验本地数据安全（如直连中断会自动切换镜像重试）…');

  try {
    const payload = mirror !== undefined ? { tag, mirror } : { tag };
    const result = await api('/api/update/install', { method: 'POST', body: JSON.stringify(payload) });
    if (!result.ok) throw new Error(result.error || '安装更新失败');
    reportInstalledUpdate(result.latest);
  } catch (error) {
    updateProgress.hidden = true;
    updateBadge.textContent = '更新失败';
    setUpdateStatus(error.message || '安装更新失败，可点下方加速镜像一键重试', 'error');
    updateMirrorBox.hidden = false;
    installUpdate.hidden = false;
    installUpdate.textContent = '重试';
    installUpdate.onclick = () => installAppUpdate(tag);
    downloadUpdate.href = lastReleaseUrl;
    downloadUpdate.hidden = false;
  } finally {
    installingUpdate = false;
    installUpdate.disabled = false;
    dismissUpdate.disabled = false;
    closeUpdate.disabled = false;
  }
}

$('updateDialogMirrors')?.addEventListener('click', (event) => {
  const btn = event.target.closest('[data-update-mirror]');
  if (!btn || !currentUpdateTag || installingUpdate) return;
  installAppUpdate(currentUpdateTag, { mirror: btn.dataset.updateMirror });
});

function closeUpdateDialog() {
  if (!installingUpdate && updateDialog.open) updateDialog.close();
}

dismissUpdate?.addEventListener('click', closeUpdateDialog);
closeUpdate?.addEventListener('click', closeUpdateDialog);
updateDialog?.addEventListener('cancel', (event) => {
  if (installingUpdate) event.preventDefault();
});
ModalQueue.bindBackdropClose(updateDialog, { canClose: () => !installingUpdate });

// 每次进入应用自动检查新版本（受「进入应用时自动检查更新」开关控制）
if (localStorage.getItem(UPDATE_AUTO_KEY) !== 'off') {
  setTimeout(() => checkForAppUpdate({ silent: true }), 300);
}
