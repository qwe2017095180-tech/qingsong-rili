// 轻松日程 · 桌面壳
//
// 职责：把同目录上一级的本地 Web 服务（server.mjs）包进一个独立应用窗口。
// 启动顺序：探测已在运行的实例 → 没有则用 Electron 自带 Node 拉起 server.mjs
//          → 从 stdout 解析真实端口 → 加载页面。
// 退出时只清理自己拉起的子进程，用户手动开着的服务不受影响。

const electron = require('electron');

// 以纯 Node 方式启动时（例如环境里残留 ELECTRON_RUN_AS_NODE=1），
// require('electron') 只会返回二进制路径，这里给出可读的提示而不是 TypeError。
if (typeof electron === 'string' || !electron.app) {
  console.error(
    [
      '轻松日程桌面版必须由 Electron 启动。',
      '当前进程带有 ELECTRON_RUN_AS_NODE，已退化为纯 Node 模式。',
      '请清除该环境变量后重新打开，或直接双击桌面上的「轻松日程」图标。',
    ].join('\n'),
  );
  process.exit(1);
}

const { app, BrowserWindow, Menu, shell, dialog } = electron;
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(ROOT, 'server.mjs');
const ICON = path.join(__dirname, 'build', 'icon.ico');
const APP_ID = 'com.qingsong.rili.desktop';

const PORT_START = 7788;
const PORT_TRIES = 20;
const STARTUP_TIMEOUT_MS = 20000;

let mainWindow = null;
let serverProc = null;
let serverUrl = null;
let ownsServer = false;
let quitting = false;

/** 请求 /api/state，确认端口上跑的是本项目 */
function probe(port, timeout = 1200) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/state', timeout },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 65536) req.destroy();
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            resolve(Boolean(data && data.settings && data.env));
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

/** 依次探测端口，返回已在运行的服务地址 */
async function findRunningServer() {
  for (let i = 0; i < PORT_TRIES; i += 1) {
    const port = PORT_START + i;
    if (await probe(port)) return `http://127.0.0.1:${port}`;
  }
  return null;
}

/** 用 Electron 自带的 Node 跑 server.mjs，并从日志里拿到实际端口 */
function startServer() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SERVER_ENTRY)) {
      reject(new Error(`未找到服务入口：${SERVER_ENTRY}`));
      return;
    }

    serverProc = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: ROOT,
      env: { ...process.env, NO_OPEN: '1', ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    ownsServer = true;

    let settled = false;
    let buffer = '';

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(arg);
    };

    const handleChunk = (text) => {
      buffer += text;
      const match = buffer.match(/http:\/\/127\.0\.0\.1:(\d{2,5})/);
      if (match) finish(resolve, `http://127.0.0.1:${match[1]}`);
    };

    serverProc.stdout.setEncoding('utf8');
    serverProc.stdout.on('data', handleChunk);
    serverProc.stderr.setEncoding('utf8');
    serverProc.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      handleChunk(chunk);
    });

    serverProc.on('error', (err) => finish(reject, err));
    serverProc.on('exit', (code) => {
      if (!settled) finish(reject, new Error(`服务进程提前退出（code ${code}）`));
      else if (!quitting) {
        dialog.showErrorBox('轻松日程', '后台服务已停止，请重新打开应用。');
        app.quit();
      }
    });

    const timer = setTimeout(() => {
      finish(reject, new Error(`启动超时（${STARTUP_TIMEOUT_MS / 1000} 秒内未就绪）`));
    }, STARTUP_TIMEOUT_MS);
  });
}

function stopServer() {
  if (!serverProc || !ownsServer) return;
  const pid = serverProc.pid;
  serverProc = null;
  try {
    // Windows 上按进程树结束，避免残留 node 子进程
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(pid, 'SIGTERM');
    }
  } catch {
    /* 忽略清理失败 */
  }
}

function buildMenu() {
  const template = [
    {
      label: '应用',
      submenu: [
        { label: '打开数据目录', click: () => shell.openPath(path.join(ROOT, 'data')) },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: '轻松日程',
    icon: ICON,
    backgroundColor: '#f9faf5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // 站内链接留在窗口内，外部链接交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(serverUrl)) shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(serverUrl)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(url);
}

async function bootstrap() {
  try {
    let url = await findRunningServer();

    if (url) {
      // 已有实例（例如用户先前双击过 start.bat），直接附着，不接管生命周期
      ownsServer = false;
    } else {
      url = await startServer();
    }

    serverUrl = url;
    createWindow(url);
  } catch (err) {
    dialog.showErrorBox('轻松日程启动失败', String(err && err.message ? err.message : err));
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.setAppUserModelId(APP_ID);
  buildMenu();

  app.whenReady().then(bootstrap);

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });

  app.on('will-quit', stopServer);
}
