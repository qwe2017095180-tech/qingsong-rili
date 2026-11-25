const UPDATE_AUTO_KEY = 'qs-update-auto';
const updateDialog = $('updateDialog');
const updateStatus = $('updateStatus');
const updateNotes = $('updateNotes');
const installUpdate = $('installUpdate');
const downloadUpdate = $('downloadUpdate');
const dismissUpdate = $('dismissUpdate');
let checkingUpdate = false;
let installingUpdate = false;

function showUpdateStatus(message) {
  updateStatus.textContent = message;
  if (!updateDialog.open) updateDialog.showModal();
}

function reportInstalledUpdate(version) {
  installUpdate.hidden = true;
  dismissUpdate.textContent = '关闭';
  showUpdateStatus(`已安装 v${version}。请退出后重新打开轻松日程。`);
}

function bindUpdateSettings(checkButton, autoToggle) {
  checkButton.onclick = () => checkForAppUpdate();
  autoToggle.checked = localStorage.getItem(UPDATE_AUTO_KEY) !== 'off';
  autoToggle.onchange = () => {
    localStorage.setItem(UPDATE_AUTO_KEY, autoToggle.checked ? 'on' : 'off');
  };
}

async function checkForAppUpdate({ silent = false } = {}) {
  if (checkingUpdate || installingUpdate || (silent && updateDialog.open)) return;
  checkingUpdate = true;
  installUpdate.hidden = true;
  downloadUpdate.hidden = true;
  updateNotes.textContent = '';
  dismissUpdate.textContent = '关闭';
  if (!silent) showUpdateStatus('正在检查更新…');

  try {
    const result = await api('/api/update/check', { method: 'POST' });
    if (!result.ok) throw new Error(result.error || '检查更新失败');
    if (result.restartRequired) {
      reportInstalledUpdate(result.latest);
      return;
    }
    if (!result.hasUpdate) {
      if (!silent) {
        showUpdateStatus(result.latest
          ? `已是最新版本 v${result.current}`
          : `当前版本 v${result.current}，GitHub 暂无可用的稳定版`);
      }
      return;
    }
    updateNotes.textContent = result.notes;
    dismissUpdate.textContent = '稍后';
    showUpdateStatus(`发现 v${result.latest}，当前为 v${result.current}`);
    if (result.canInstall) {
      installUpdate.hidden = false;
      installUpdate.onclick = () => installAppUpdate(result.tag);
    } else {
      downloadUpdate.href = result.url;
      downloadUpdate.hidden = false;
    }
  } catch (error) {
    if (!silent) showUpdateStatus(error.message || '检查更新失败');
  } finally {
    checkingUpdate = false;
  }
}

async function installAppUpdate(tag) {
  if (installingUpdate) return;
  installingUpdate = true;
  installUpdate.disabled = true;
  dismissUpdate.disabled = true;
  showUpdateStatus('正在下载并安装…');
  try {
    const result = await api('/api/update/install', { method: 'POST', body: JSON.stringify({ tag }) });
    if (!result.ok) throw new Error(result.error || '安装更新失败');
    reportInstalledUpdate(result.latest);
  } catch (error) {
    showUpdateStatus(error.message || '安装更新失败');
  } finally {
    installingUpdate = false;
    installUpdate.disabled = false;
    dismissUpdate.disabled = false;
  }
}

dismissUpdate.onclick = () => updateDialog.close();
updateDialog.addEventListener('cancel', (event) => {
  if (installingUpdate) event.preventDefault();
});

if (localStorage.getItem(UPDATE_AUTO_KEY) !== 'off' && !sessionStorage.getItem('qs-update-checked')) {
  sessionStorage.setItem('qs-update-checked', '1');
  checkForAppUpdate({ silent: true });
}
