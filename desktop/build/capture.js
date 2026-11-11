// 调试脚本：打开应用、截取指定面板，用于验证界面渲染。
// 用法：electron build/capture.js [settings|ann]
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const URL = 'http://127.0.0.1:7788';
const MODE = process.argv.includes('ann') ? 'ann' : 'settings';
const OUT = path.join(os.tmpdir(), `qingsong-${MODE}-shot.png`);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    show: true,
    backgroundColor: '#f9faf5',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 2500));

  const btn = MODE === 'ann' ? 'annBtn' : 'settingsBtn';
  const drawer = MODE === 'ann' ? 'annDrawer' : 'settingsDrawer';
  // 公告会在加载后自动展开，这里只在仍关闭时才点击，避免点成关闭
  await win.webContents.executeJavaScript(`
    (() => {
      const d = document.getElementById('${drawer}');
      if (d.hidden) document.getElementById('${btn}').click();
      return !d.hidden;
    })()
  `);
  await new Promise((r) => setTimeout(r, MODE === 'ann' ? 1500 : 6000));

  const info = await win.webContents.executeJavaScript(`
    (() => {
      const dw = document.getElementById('${drawer}');
      const rect = dw.getBoundingClientRect();
      const base = {
        drawerHidden: dw.hidden,
        maskHidden: document.getElementById('mask').hidden,
        rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
        computedDisplay: getComputedStyle(dw).display,
      };
      if ('${MODE}' === 'ann') {
        const items = document.querySelectorAll('#annBody .ann-item');
        return {
          ...base,
          mode: 'ann',
          items: items.length,
          titles: Array.from(items).map((x) => x.querySelector('.ann-title')?.innerText || ''),
          hasNewBadge: !!document.querySelector('.ann-new'),
          firstH: document.querySelector('#annBody .ann-h')?.innerText || '',
          links: Array.from(document.querySelectorAll('#annBody a')).map((a) => ({
            text: a.innerText,
            href: a.getAttribute('href'),
            blank: a.getAttribute('target'),
            color: getComputedStyle(a).color,
          })),
        };
      }
      const rows = document.querySelectorAll('#grpList .grp-row');
      return {
        ...base,
        mode: 'settings',
        rows: rows.length,
        firstText: rows[0] ? rows[0].innerText.replace(/\\s+/g, ' ').trim() : '',
        hasTime: !!document.querySelector('#grpList .grp-time'),
      };
    })()
  `);
  console.log(JSON.stringify(info));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('saved', OUT);
  app.quit();
});
