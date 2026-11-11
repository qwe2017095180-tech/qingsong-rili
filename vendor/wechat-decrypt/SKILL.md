---
name: wechat-decrypt
description: >
  读取 / 搜索 / 导出 / 转写本机微信 4.x 聊天记录（macOS、Windows）。
  用于查聊天、找消息、导出对话、统计、语音转文字，以及微信更新后重新提取密钥。
  当用户说「导出微信聊天」「查微信记录」「搜聊天记录」「备份微信」「微信年度报告」
  「wechat-decrypt」时使用。只处理用户本人授权访问的本机数据。
---

# 微信本地记录（wechat-decrypt）

只操作用户本人有权访问的本机微信数据。密钥、明文库、语音缓存、导出文件一律留在本地，
**绝不把密钥打印到聊天、日志或命令参数里**。

## 运行时（重要）

用技能目录内的独立 venv，**不要**用 DSH 自带 Python（加载第三方 `.so` 会被代码签名拦截）：

```bash
SKILL_DIR="$HOME/.dsh/skills/wechat-decrypt"
PY="$SKILL_DIR/.venv/bin/python"
```

先跑只读诊断，`fail` 阻塞、`warn` 可降级：

```bash
"$PY" "$SKILL_DIR/scripts/common/doctor.py" --json
```

## 环境要求

- **macOS**：系统 `sqlcipher`（或通过 `WECHAT_SQLCIPHER_PATH` 指定），Python 3.9+
- **Windows**：Python 3.9+，安装 `requirements-windows.txt`，微信 4.x（`Weixin.exe`）
- 首次使用需要先提取数据库密钥；Windows 用 `scripts/windows/extract_raw_key.py` + `decrypt_all.py`
- 密钥文件（`key*.txt`、`per_db_keys.json`）和解密产物（`decrypted/`）不要提交到仓库

`doctor.py` 报 `skill` / `mcp` / `dependency:mcp` 的 warn 可以忽略——那是给 Codex 准备的。

## 路由（全部走 CLI，没有 MCP 工具）

| 想做什么 | 命令 |
|---|---|
| 列出会话 | `query.py list --json` |
| 读某个聊天 | `query.py read CONTACT -d 7 -n 50 --json` |
| 全局搜索 | `query.py search 关键词 -d 30 -n 50 --json` |
| 最近消息 | `query.py recent -d 3 -n 100 --json` |
| 对话摘要 | `query.py summary -d 3 --json` |
| 系统事件（拍一拍/撤回/转账/通话） | `query.py events -e pat -d 30 -n 100 --json` |
| 导出聊天 | 见 `references/export-transcription.md` |
| 语音转文字 | 同上（需另装 mlx-whisper） |
| 数据库损坏 / 缺分片 | `references/db-repair.md` |
| 密钥缺失 / 微信更新 | `references/macos.md`（macOS）或 `references/windows.md` |

示例：

```bash
"$PY" "$SKILL_DIR/scripts/common/query.py" list --json
```

`[我]` = 账号本人，`[对方]` = 对话方。联系人匹配有歧义时列出候选让用户选，**不要猜**。
时间窗与条数按需求给，不要默认倒全量历史。

## 已知的坑（实测）

- **App Store 版微信无法重签名**（Apple 加签 + 强化运行时），必须换官网版 dmg。
- 微信 4.2 的 PBKDF2 抓不到 `RAW_KEY`（password 不是 32 字节），但能抓到**每库的
  `DERIVED_KEY`**——这正好是 SQLCipher 的最终密钥，配合 `kdf_iter=1` 可直接用。
- `db.py` 已改造：优先读 `per_db_keys.json`（按库路径后缀匹配），命中就跳过一次 PBKDF2 派生。
- hook 必须在**登录前**挂上（PBKDF2 只在登录时调用一次）；已登录时需先「退出登录」再扫码。

## 提取密钥（涉及改动微信 App，必须先取得用户明确授权）

macOS 的做法是给微信做一次 **ad-hoc 重签名**（替换腾讯官方签名），再用 frida hook
`CCKeyDerivationPBKDF` 抓 32 字节原始密钥。步骤要点：

1. 查签名：`codesign -dv /Applications/WeChat.app 2>&1 | grep 'Signature='`
2. 若不是 ad-hoc：`sudo codesign --force --deep --sign - /Applications/WeChat.app`
3. 关掉微信，运行 `bash "$SKILL_DIR/scripts/macos/extract_key.sh"`
4. 让用户扫码登录，脚本把密钥写进 `key.txt`（权限 600，不回显）
5. 重新跑 `doctor.py`
6. 提取完成后建议用户重装微信，恢复官方签名

**这些操作会：关闭当前微信进程、破坏 App 官方签名、需要 sudo。做任何一步之前都要单独说明影响并取得同意。**

## 不变式

- 原始密钥是 64 位十六进制，且**按设备绑定**；同一账号在 macOS 与 Windows 的密钥不通用。
- macOS 通过 SQLCipher **以只读方式原地查询**加密库，不产生明文副本。
- 微信升级可能让密钥失效，重跑 `doctor.py` 再决定是否重新提取。
- 语音转写首次要下载约 3 GB 模型，**必须经用户同意**。
- 类型 49 的应用消息本地解析，回答标题/作者/来源/链接时保留结构化 `app` 字段。
- 损坏分片隔离到 `<name>.db.factory/`，**绝不原地修库**：先重建副本、验证、备份再还原。

## 与 DSH 技能的配合

- 导出后在 Obsidian 里整理 → 用 `obsidian-knowledge-base`（需用户明确要求才写库）
- 生成图表/年度报告 → `smart-charts`
- 长对话转成讲义 → `teach`
