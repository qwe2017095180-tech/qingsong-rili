/* 添加日程，也可以把粘贴的通知交给整理模型。 */
const addUI = {
  mode: 'direct',
  saving: false,
  clientId: null,

  selectMode(mode) {
    addUI.mode = mode;
    $('directAgenda').hidden = mode !== 'direct';
    $('pasteAgenda').hidden = mode !== 'paste';
    for (const button of $('addMode').querySelectorAll('[data-add-mode]')) {
      const active = button.dataset.addMode === mode;
      button.classList.toggle('on', active);
      button.setAttribute('aria-pressed', active);
    }
    $('submitAdd').textContent = mode === 'direct' ? '保存日程' : '整理为待办';
  },

  open() {
    if (addUI.saving) return;
    if (!$('settingsDrawer').hidden) closeSettings();
    if (!$('drawer').hidden) closeDetail();
    if (typeof closeAnnouncements === 'function') closeAnnouncements();
    $('directAgenda').reset();
    $('agendaDate').value = localDayKey(app.tab === 'today' ? app.selectedDay : new Date());
    $('addText').value = '';
    $('addSource').value = '';
    addUI.clientId = crypto.randomUUID();
    addUI.selectMode('direct');
    $('mask').hidden = false;
    $('addDrawer').hidden = false;
    $('agendaTitle').focus();
  },

  close() {
    if (addUI.saving) return;
    $('addDrawer').hidden = true;
    if ($('drawer').hidden && $('settingsDrawer').hidden) $('mask').hidden = true;
  },

  async submit() {
    if (addUI.saving) return;
    const direct = addUI.mode === 'direct';
    if (direct && !$('directAgenda').reportValidity()) return;
    const text = $('addText').value.trim();
    const title = $('agendaTitle').value.trim();
    if (direct ? !title : !text) {
      toast(direct ? '请填写标题' : '先粘贴一段内容');
      (direct ? $('agendaTitle') : $('addText')).focus();
      return;
    }
    const date = $('agendaDate').value;
    const body = direct
      ? { clientId: addUI.clientId, title, date, time: $('agendaTime').value, note: $('agendaNote').value }
      : { text, source: $('addSource').value.trim() };
    addUI.saving = true;
    $('submitAdd').disabled = true;
    $('submitAdd').textContent = direct ? '正在保存…' : '正在整理…';
    try {
      const result = await api(direct ? '/api/agenda' : '/api/manual/add', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!result.ok) throw new Error(result.error || '保存失败');
      addUI.saving = false;
      addUI.close();
      if (!direct && !result.items) { toast(result.note || '这段内容里没有要做的具体事项'); return; }
      app.mode = 'notice';
      app.tab = direct ? 'today' : 'todo';
      if (direct) app.selectedDay = new Date(date + 'T12:00:00');
      await load({ quiet: true });
      toast(direct ? '日程已添加' : `已整理成 ${result.items} 条待办`);
    } catch (error) {
      toast(error.message || '提交失败，请确认本地服务还开着');
    } finally {
      addUI.saving = false;
      $('submitAdd').disabled = false;
      addUI.selectMode(addUI.mode);
    }
  },
};

$('addBtn').onclick = addUI.open;
$('closeAdd').onclick = addUI.close;
$('cancelAdd').onclick = addUI.close;
$('submitAdd').onclick = addUI.submit;
$('addMode').onclick = (event) => {
  const button = event.target.closest('[data-add-mode]');
  if (button && !addUI.saving) addUI.selectMode(button.dataset.addMode);
};
$('directAgenda').onsubmit = (event) => {
  event.preventDefault();
  addUI.submit();
};

$('mask').addEventListener('click', (event) => {
  if (!$('addDrawer').hidden) {
    addUI.close();
    event.stopImmediatePropagation();
  }
}, true);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('addDrawer').hidden) addUI.close();
});
