# 轻松日程 · Windows 安装手册（给 AI 执行）

> 这份文档是写给 AI 助手看的：请按步骤在 Windows 本机完成安装、验证，遇到失败按「故障排查」处理，不要跳过验证。

## 0. 这是什么

「轻松日程」是一个本地应用：读取本机微信的群消息，整理成作业/通知/活动卡片，显示倒计时和待办。
它**不登录微信、不模拟客户端、不访问微信服务器**，只在本机读取微信自己的数据库文件。

- 界面：`http://127.0.0.1:7788`
- 数据：项目目录下的 `data/*.json`
- 微信读取：项目自带的 `vendor/wechat-decrypt`（Windows 走「提 key → 全量解密 → 读明文库」）

## 1. 前置条件（先检查，不满足就先装）

| 依赖 | 要求 | 检查命令 |
|---|---|---|
| Windows | 10 / 11，64 位 | `[Environment]::Is64BitOperatingSystem` |
| Node.js | 18 或更高 | `node -v` |
| Python | 3.9 或更高（建议 3.12） | `python --version` |
| 微信 | **Windows 版微信 4.x**（进程名 `Weixin.exe`），已登录 | `Get-Process Weixin` |

如果 `node` 或 `python` 不在 PATH，先安装并重开终端。Node 从 https://nodejs.org 装 LTS 版即可。

## 2. 解压与目录结构

把压缩包解压到例如 `C:\qingsong-rili`，确认目录里有：

```
server.mjs  mcp-server.mjs  wb-bridge.mjs  start.bat  start.ps1
lib\        public\        data\
vendor\wechat-decrypt\    ← 微信读取与解密脚本（自带，不用另外下载）
```

以下命令都在项目根目录执行（PowerShell 里先 `cd C:\qingsong-rili`）。

## 3. 安装 Python 依赖（一次）

```powershell
cd C:\qingsong-rili\vendor\wechat-decrypt
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements-windows.txt
```

装完确认：

```powershell
.\.venv\Scripts\python.exe -c "import Crypto, frida, zstandard; print('deps ok')"
```

> `frida` 只在提取 key 时用；`pycryptodome` 用于解密；`zstandard` 用于部分压缩数据。`mcp[cli]` 装了不影响。

## 4. 提取微信数据库密钥（一次，需要管理员权限）

**注意：这一步会强制结束并重启微信进程（`taskkill /F /IM Weixin.exe`），先让用户保存好正在编辑的内容。**

1. 确认微信已登录、保持运行。
2. 用**管理员权限**打开 PowerShell（右键 → 以管理员身份运行），执行：

```powershell
cd C:\qingsong-rili\vendor\wechat-decrypt
.\.venv\Scripts\python.exe scripts\windows\extract_raw_key.py 30
```

3. 成功时会在 `vendor\wechat-decrypt\key_windows.txt` 生成 64 位十六进制字符串，并打印类似 `key captured`。
4. 失败时按提示重试（微信版本不是 4.x、没登录、权限不足都会失败）。

## 5. 全量解密到明文库（一次，之后可重复执行同步新消息）

```powershell
cd C:\qingsong-rili\vendor\wechat-decrypt
.\.venv\Scripts\python.exe scripts\windows\decrypt_all.py
```

它会读取 `key_windows.txt`，把 `db_storage` 下所有库解密到：

```
vendor\wechat-decrypt\decrypted\<账号>\db_storage\
```

看到 `done` 或类似成功输出即可。以后微信有新消息，**重新执行一次本命令**就能同步（应用不会自动解密）。

## 6. 验证微信读取

回到项目根目录：

```powershell
cd C:\qingsong-rili
node wb-bridge.mjs pending
```

期望：输出以 `范围：最近 24 小时，N 个群，M 条消息` 开头。若提示「应用里还没有选择要整理的群」，先做第 7 步在界面选群，再回来验证。

如果报 `未找到微信读取环境` 或 Python 路径错误，见「故障排查」。

## 7. 启动应用

双击 `start.bat`（或 PowerShell 里 `.\start.ps1`）。看到：

```
轻松日程已启动 → http://127.0.0.1:7788
```

浏览器会自动打开；没打开就手动访问 `http://127.0.0.1:7788`。

## 8. 首次配置（在界面里）

1. 点右上角「设置」→「整理哪些群」→ 勾选要整理的微信群（可搜索群名）。
2. 设置自动整理时间（默认 20:00）和「往回看多久」（默认 24 小时）。
3. 填「学期开始日期」（第一周周一，例如 `2026-09-14`），用于把「第 N 周」换算成日期。
4. 选「谁来整理」：
   - **自动**：有 WorkBuddy 命令行就用它，否则用 AI 接口（需填 Base URL、Key、模型名）。
   - **WorkBuddy 命令行**：需要本机装了 WorkBuddy 并完成一次 `/login`。
   - **AI 接口（OpenAI 兼容）**：填 Base URL、API Key、模型名（DeepSeek / OpenAI / Moonshot / 硅基流动等），只存本机 `data/settings.json`，会产生接口费用。
   - **只写请求，交给外部 AI**：应用不调模型，整理请求写进队列，由外部 AI 用 `wb-bridge.mjs` 接手。
5. 保存设置。

## 9. 三种整理后端怎么选

| 后端 | 适用情况 | 点「立即整理」的效果 |
|---|---|---|
| WorkBuddy 命令行 | 本机装了 WorkBuddy | 当场调模型，约 20–60 秒出卡片 |
| AI 接口（OpenAI 兼容） | 没装 WorkBuddy，但有 API Key | 当场调模型，约 10–30 秒出卡片 |
| 只写请求（队列） | 都不想配 | 只记一个请求，外部 AI 用 `wb-bridge.mjs` 处理 |

队列模式的用法（给外部 AI）：

```powershell
node wb-bridge.mjs queue                 # 看待处理请求
node wb-bridge.mjs pending               # 读最近 24 小时聊天文本
node wb-bridge.mjs list 80               # 看已有卡片，避免重复
node wb-bridge.mjs submit items.json     # 把整理结果写回（items.json 是条目数组）
node wb-bridge.mjs complete <请求id> '{"items":3,"added":2,"updated":1}'
```

## 10. 验收清单（必须逐项确认）

- [ ] `node -v` ≥ 18，`python --version` ≥ 3.9
- [ ] `vendor\wechat-decrypt\.venv\Scripts\python.exe -c "import Crypto, frida"` 成功
- [ ] `key_windows.txt` 存在，内容是 64 位十六进制
- [ ] `vendor\wechat-decrypt\decrypted\<账号>\db_storage\message\message_0.db` 存在
- [ ] `node wb-bridge.mjs pending` 能输出「范围：最近 24 小时…」
- [ ] `start.bat` 启动后 `http://127.0.0.1:7788` 返回 200
- [ ] 界面「设置 → 谁来整理」显示的后端不是 `none`
- [ ] 点一次「立即整理」，能新增卡片或明确提示原因

## 11. 故障排查

**`未找到微信读取环境（vendor\wechat-decrypt\.venv）`**
→ 第 3 步没做或 venv 路径不对。确认 `vendor\wechat-decrypt\.venv\Scripts\python.exe` 存在。

**`query.py` 报 `未找到解密后的 message_N.db`**
→ 第 5 步没做或失败。重新跑 `decrypt_all.py`，确认 `decrypted\` 下有 `message\message_0.db`。

**提 key 失败 / frida 报错**
→ 确认微信是 4.x（`Weixin.exe`，不是 `WeChat.exe`）；用管理员 PowerShell；微信保持登录；关掉安全软件对 frida 的拦截后重试。

**`node wb-bridge.mjs pending` 输出「0 个群」**
→ 界面里还没勾选群；或 `data\settings.json` 的 `groups` 为空。先在界面选群。

**端口 7788 被占用**
→ `netstat -ano | findstr :7788` 找到 PID 后结束，或改 `server.mjs` 里的 `PORT_START`。

**界面打开是空白 / 502**
→ 服务没在跑。用 `start.bat` 启动；确认命令行窗口没有报错。

**中文乱码**
→ `start.bat` 已 `chcp 65001`；PowerShell 建议 `chcp 65001` 后再运行。

## 12. 安全与隐私

- `vendor\wechat-decrypt\key_windows.txt` 是数据库钥匙，**不要上传网盘、不要发给别人、不要提交 git**。
- `vendor\wechat-decrypt\decrypted\` 是聊天记录明文，同样不要外传；不用时可以整个删掉，需要时重新解密。
- `data\notices.json`、`data\fun.json` 是整理后的摘要，也属于个人数据。
- 应用只读微信数据库，不写、不发消息、不访问微信服务器；封号风险可忽略。
- 如果填了 AI 接口的 Key，它只保存在本机 `data\settings.json`，只用于调用你填的 Base URL。

## 13. 日常使用

- 有新消息时：重新跑一次 `decrypt_all.py`（同步明文库），然后在界面点「立即整理」。
- 想省事可以做一个计划任务：每天固定时间跑 `decrypt_all.py`，再调 `http://127.0.0.1:7788/api/run`。
- 娱乐群整理在「🎮 娱乐」模式里，逻辑与通知分开。
