// 临时脚本：打开应用、进入设置面板、截图，用于验证群列表渲染。
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const URL = 'http://127.0.0.1:7788';
const os = require('node:os');
const OUT = path.join(os.tmpdir(), 'qingsong-settings-shot.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1180,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(URL);
  await new Promise((r) => setTimeout(r, 2500));

  // 打开设置抽屉并等群列表读完
  await win.webContents.executeJavaScript(`
    document.getElementById('settingsBtn').click();
    true;
  `);
  await new Promise((r) => setTimeout(r, 6000));

  const count = await win.webContents.executeJavaScript(`
    (() => {
      const rows = document.querySelectorAll('#grpList .grp-row');
      const first = rows[0];
      return {
        rows: rows.length,
        firstText: first ? first.innerText.replace(/\\s+/g, ' ').trim() : '',
        hasTime: !!document.querySelector('#grpList .grp-time'),
      };
    })()
  `);
  console.log(JSON.stringify(count));

  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());
  console.log('saved', OUT);
  app.quit();
});
