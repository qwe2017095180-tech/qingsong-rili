# 轻松日程

把大学微信群里刷过去的通知，变成看得懂的卡片和待办。

本地运行、只读微信数据库、不上传任何聊天内容。支持 macOS 与 Windows。

## 功能

- **通知整理**：读取你勾选的微信群，整理成「作业 / 兼职 / 比赛 / 活动 / 志愿 / 通知 / 其他」卡片
- **截止倒计时**：识别截止时间，按紧急程度排序；过期自动归档
- **待办与归档**：一键加入待办、标记完成或忽略；归档可逐条恢复，也可一键清空
- **手动添加**：把从微信复制的通知粘进来，交给模型拆成待办卡片
- **娱乐群小结**：游戏、动漫、吃喝群单独整理，只写「在聊什么」，不混进通知
- **MCP 工具**：提供 `get_pending_messages`、`submit_notices`、`list_notices`，可接入任意 MCP 客户端
- **检查更新**：在设置里检查 GitHub 上的新版本

## 隐私与安全

- 只读取你在设置里勾选的群，**不写数据库、不发消息、不访问微信服务器**
- 只读本地微信数据库（macOS 用 SQLCipher 只读打开；Windows 先解密到本地明文库再读）
- 整理后的卡片只存在本机 `data/` 目录
- 数据库密钥与解密产物已加入 `.gitignore`，不会进入仓库

> 微信用户协议通常禁止使用非官方工具导出数据。本项目只做本地只读整理，不登录、不模拟客户端、不产生微信协议流量；是否使用请自行判断并遵守当地法律与平台条款。

## 快速开始（macOS）

```bash
git clone <repo-url> qingsong-rili
cd qingsong-rili
./start.command
```

浏览器会自动打开 `http://127.0.0.1:7788`。首次使用需要在设置里勾选要整理的群。

微信读取依赖本机的 `wechat-decrypt` 技能（默认路径 `~/.dsh/skills/wechat-decrypt`），也可以用环境变量指定：

```bash
export WECHAT_DECRYPT_DIR=/path/to/wechat-decrypt
```

## 快速开始（Windows）

见 [INSTALL_FOR_AI.md](INSTALL_FOR_AI.md)，里面是给 AI 或人执行的完整步骤：

1. 安装 Node.js 18+、Python 3.9+
2. 建 venv 并安装 `vendor/wechat-decrypt/requirements-windows.txt`
3. 用管理员权限运行 `extract_raw_key.py` 提取微信 4.x 数据库密钥（会重启微信）
4. 运行 `decrypt_all.py` 解密到 `vendor/wechat-decrypt/decrypted/`
5. 双击 `start.bat`

Windows 版需要微信 4.x（`Weixin.exe`）。微信有新消息后，重新运行一次 `decrypt_all.py` 同步。

## 整理引擎

应用本身不含本地规则引擎，整理由模型完成。设置里可选三种后端：

| 后端 | 说明 |
|---|---|
| WorkBuddy 命令行 | 本机装了 WorkBuddy，并在终端完成一次 `/login` |
| AI 接口（OpenAI 兼容） | 在设置里填 Base URL、API Key、模型名，会产生接口费用 |
| 只写请求（队列） | 应用只记录整理请求，由外部 AI 用 `wb-bridge.mjs` 接手 |

自动模式会优先选 WorkBuddy，其次 AI 接口。API Key 只保存在本机 `data/settings.json`（已 gitignore），不会上传。

常见服务的填法：

| 服务 | Base URL | 模型名示例 |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 硅基流动 | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` |
| OpenRouter | `https://openrouter.ai/api/v1` | `deepseek/deepseek-chat` |

> Base URL 一般填到 `/v1` 为止；DeepSeek 可以不带 `/v1`。填错时接口会返回 404，设置里会提示「检查 Base URL」。

## 目录结构

```
server.mjs            本地 HTTP 服务与页面接口
mcp-server.mjs        MCP 服务器（stdio JSON-RPC）
wb-bridge.mjs         命令行桥：读消息 / 写回 / 队列
lib/                  存储、微信读取、模型后端、队列
public/               前端页面
data/                 本机数据（已 gitignore）
vendor/wechat-decrypt Windows 微信解密脚本
INSTALL_FOR_AI.md     Windows 安装手册
version.json          版本与更新信息
```

## 更新

设置 →「检查更新」会读取仓库里的 `version.json` 并比较版本。

也可以手动：

```bash
git pull --ff-only
```

`data/` 不会被覆盖。

## 开发

无第三方运行时依赖，Node 18+ 即可：

```bash
node server.mjs              # 启动服务
node wb-bridge.mjs pending   # 读取最近 24 小时聊天文本
node wb-bridge.mjs list 80   # 查看已有卡片
```

## License

MIT
