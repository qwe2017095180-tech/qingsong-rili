/* 手动添加待办：把粘贴的原文交给 WorkBuddy 整理成待办卡片 */
const addUI = {
  open() {
    const $ = (id) => document.getElementById(id);
    // 先关掉其它抽屉，避免遮罩状态打架
    if (!$('settingsDrawer').hidden) closeSettings();
    if (!$('drawer').hidden) closeDetail();
    $('addText').value = '';
    $('addSource').value = '';
    $('submitAdd').disabled = false;
    $('submitAdd').textContent = '交给 WorkBuddy 整理';
    $('mask').hidden = false;
    $('addDrawer').hidden = false;
    setTimeout(() => $('addText').focus(), 60);
  },

  close() {
    const $ = (id) => document.getElementById(id);
    $('addDrawer').hidden = true;
    if ($('drawer').hidden && $('settingsDrawer').hidden) $('mask').hidden = true;
  },

  async submit() {
    const $ = (id) => document.getElementById(id);
    const text = $('addText').value.trim();
    if (!text) { toast('先粘贴一段内容'); $('addText').focus(); return; }
    const source = $('addSource').value.trim();
    $('submitAdd').disabled = true;
    $('submitAdd').textContent = '正在由 WorkBuddy 整理…';
    try {
      const res = await api('/api/manual/add', {
        method: 'POST',
        body: JSON.stringify({ text, source }),
      });
      if (!res.ok) { toast(res.error || '提交失败'); return; }
      addUI.close();
      if (!res.items) { toast(res.note || '这段内容里没有要做的具体事项'); return; }
      toast(`已整理成 ${res.items} 条待办，新增 ${res.added || 0} 条 🎉`);
      app.tab = 'todo';
      load({ quiet: true });
    } catch (e) {
      toast('提交失败，请确认本地服务还开着');
    } finally {
      $('submitAdd').disabled = false;
      $('submitAdd').textContent = '交给 WorkBuddy 整理';
    }
  },
};

document.getElementById('addBtn').addEventListener('click', addUI.open);
document.getElementById('closeAdd').addEventListener('click', addUI.close);
document.getElementById('cancelAdd').addEventListener('click', addUI.close);
document.getElementById('submitAdd').addEventListener('click', addUI.submit);

// capture 阶段先截住遮罩点击，避免 app.js 的遮罩处理把详情抽屉也关掉
document.getElementById('mask').addEventListener('click', (e) => {
  if (!document.getElementById('addDrawer').hidden) {
    addUI.close();
    e.stopImmediatePropagation();
  }
}, true);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('addDrawer').hidden) addUI.close();
});
