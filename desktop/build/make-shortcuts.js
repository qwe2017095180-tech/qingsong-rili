// 生成「轻松日程」桌面 / 开始菜单快捷方式。
// 使用 windows-shortcuts（自带 Optimum X Shortcut.exe），不走 COM，避免依赖 WScript.Shell。
// 用法：node build/make-shortcuts.js

const path = require('node:path');
const fs = require('node:fs');
const ws = require('windows-shortcuts');

const APP_DIR = path.resolve(__dirname, '..');
const TARGET = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const ICON = path.join(APP_DIR, 'build', 'icon.ico');
const DESCRIPTION = '轻松日程 · 把微信群通知整理成待办卡片';

const HOME = process.env.USERPROFILE || '';
const LNK_TARGETS = [
  path.join(HOME, 'Desktop', '轻松日程.lnk'),
  path.join(HOME, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', '轻松日程.lnk'),
];

function createOne(lnk) {
  return new Promise((resolve, reject) => {
    ws.create(
      lnk,
      {
        target: TARGET,
        args: `"${APP_DIR}"`,
        workingDir: APP_DIR,
        icon: ICON,
        iconIndex: 0,
        runStyle: 1,
        desc: DESCRIPTION,
      },
      (err) => (err ? reject(new Error(String(err))) : resolve()),
    );
  });
}

(async () => {
  for (const p of [TARGET, ICON]) {
    if (!fs.existsSync(p)) {
      console.error(`缺少文件：${p}`);
      process.exit(1);
    }
  }
  for (const lnk of LNK_TARGETS) {
    fs.mkdirSync(path.dirname(lnk), { recursive: true });
    await createOne(lnk);
    const size = fs.statSync(lnk).size;
    console.log(`已生成 ${lnk}（${size} 字节）`);
  }
})().catch((err) => {
  console.error('生成失败：', err.message);
  process.exit(1);
});
