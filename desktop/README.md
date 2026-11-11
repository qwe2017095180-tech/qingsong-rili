# 轻松日程 · 桌面版

把仓库根目录的本地服务（`server.mjs`）包进一个独立应用窗口，双击图标即可使用，不需要手动开浏览器。

## 与网页版的关系

桌面壳不复制、不修改业务代码，只做三件事：

1. 探测 7788 起的端口上是否已有本项目的服务在跑；
2. 没有则用 Electron 自带的 Node 拉起 `../server.mjs`（`NO_OPEN=1`，不额外弹浏览器）；
3. 从服务日志解析真实端口，加载到窗口里。

因此 `server.mjs`、`lib/`、`public/`、`data/` 全部沿用根目录，聊天记录与设置仍只存在本机 `data/` 下。

## 目录

```
main.js                 主进程：探测/拉起服务、建窗口、退出时清理子进程
package.json            依赖与脚本
build/icon.ico          应用图标（多尺寸）
build/icon.png          512px 预览图
build/make_icon.py      图标生成脚本（Pillow）
build/make-shortcuts.js 生成桌面 / 开始菜单快捷方式
build/capture.js        调试用：打开设置面板截图到系统临时目录，检查群列表渲染
```

## 安装与启动

```powershell
cd desktop
npm install          # 装 electron
npm start            # 开发模式启动
```

首次安装若卡在下载 Electron 二进制（GitHub 直连不稳），用镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
node node_modules/electron/install.js
```

生成桌面与开始菜单图标：

```powershell
node build/make-shortcuts.js
```

## 行为说明

- **单实例**：重复双击只会在已有窗口上置前，不会再开一个进程。
- **端口**：优先复用已运行的服务（例如你先前双击过根目录的 `start.bat`），此时退出桌面版不会关掉那个服务；只有自己拉起的才会被一起清理。
- **关闭窗口即退出**，并结束自己启动的服务进程树，不留孤儿进程。
- 菜单栏默认隐藏，按 `Alt` 显示；`F12` 开发者工具，`Ctrl+R` 重新加载。

## 注意

桌面版依赖 Electron 提供的 Node 运行服务，但仍需要系统里的 Python 环境来读取微信数据库（`vendor/wechat-decrypt/.venv`），这一点与网页版一致。

若在设置了 `ELECTRON_RUN_AS_NODE=1` 的终端里启动，Electron 会退化成纯 Node，`main.js` 会直接给出提示并退出。从桌面图标启动不受影响。
