#!/bin/bash
# 打包 Windows 版：项目代码 + 微信解密技能子集 + 空白数据，输出 dist/qingsong-rili-windows.zip
# 不包含：个人 data、key、解密后的聊天库、.venv、macOS 专用脚本、旧的 codex 调用模块
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="${WECHAT_DECRYPT_DIR:-$HOME/.dsh/skills/wechat-decrypt}"
[ -d "$SKILL/scripts/windows" ] || SKILL="$ROOT/vendor/wechat-decrypt"
OUT="$ROOT/dist/qingsong-rili-windows"
NODE="${NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || { echo "找不到 node，可用 NODE=/path/to/node 指定"; exit 1; }

[ -d "$SKILL/scripts/windows" ] || { echo "找不到微信解密技能: $SKILL"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/lib" "$OUT/public" "$OUT/data" "$OUT/tools" "$OUT/desktop/build" \
         "$OUT/vendor/wechat-decrypt/scripts/common" \
         "$OUT/vendor/wechat-decrypt/scripts/windows"

# ── 应用代码 ──
cp "$ROOT"/server.mjs "$ROOT"/mcp-server.mjs "$ROOT"/wb-bridge.mjs "$ROOT"/version.json "$OUT"/
cp "$ROOT"/start.bat "$ROOT"/start.ps1 "$ROOT"/INSTALL_FOR_AI.md "$OUT"/
cp "$ROOT/tools/list_sessions.py" "$OUT/tools/"
for f in store.mjs wechat.mjs queue.mjs fun-summary.mjs workbuddy-model.mjs model-openai.mjs providers.mjs agents.mjs bridge.mjs update.mjs; do
  cp "$ROOT/lib/$f" "$OUT/lib/"
done
cp "$ROOT"/public/* "$OUT/public/"
cp "$ROOT"/desktop/main.js "$ROOT"/desktop/package.json "$ROOT"/desktop/package-lock.json "$ROOT"/desktop/README.md "$OUT/desktop/"
cp "$ROOT"/desktop/build/icon.ico "$ROOT"/desktop/build/icon.png "$ROOT"/desktop/build/make-shortcuts.js "$OUT/desktop/build/"

# ── 空白数据（绝不带个人聊天摘要）──
"$NODE" -e '
const fs=require("fs"), p=process.argv[1];
const w=(n,v)=>fs.writeFileSync(`${p}/${n}`, JSON.stringify(v,null,2));
w("settings.json", {
  times:["20:00"], days:"daily", groups:[], funGroups:[],
  lookbackHours:24, limitPerGroup:400,
  aiEnabled:false, ocrImages:false, termStart:null,
  lastRunAt:null, lastRunDate:null, lastRunSlots:[],
  organizeBackend:"deepseek", aiProvider:"deepseek",
  providerProfiles:{}, onboardingDone:false,
  apiBaseUrl:"https://api.deepseek.com", apiKey:"", apiModel:"deepseek-chat",
  bridgeEnabled:false, bridgeToken:"", updateMirror:"https://gh-proxy.com/"
});
w("notices.json",[]); w("fun.json",[]); w("runs.json",[]);
w("dismissed.json",[]); w("organize_queue.json",[]);
' "$OUT/data"

# ── 微信解密技能（只带运行所需，不含 key / decrypted / .venv）──
cp "$SKILL"/*.py "$OUT/vendor/wechat-decrypt/"
cp "$SKILL"/requirements-windows.txt "$SKILL"/setup.ps1 "$SKILL"/SKILL.md "$SKILL"/LICENSE \
   "$OUT/vendor/wechat-decrypt/" 2>/dev/null || true
cp "$SKILL"/scripts/common/*.py "$OUT/vendor/wechat-decrypt/scripts/common/"
cp "$SKILL"/scripts/windows/*.py "$OUT/vendor/wechat-decrypt/scripts/windows/"

# ── 校验：不允许出现敏感文件 ──
for bad in key.txt key_windows.txt per_db_keys.json all_keys.json; do
  if [ -e "$OUT/vendor/wechat-decrypt/$bad" ]; then echo "拒绝打包：包含敏感文件 $bad"; exit 1; fi
done
[ -d "$OUT/vendor/wechat-decrypt/decrypted" ] && { echo "拒绝打包：包含 decrypted 聊天库"; exit 1; }

# ── 压缩（优先 zip，Windows Git Bash 无 zip 时回退真实 python/python3） ──
cd "$ROOT/dist"
rm -f qingsong-rili-windows.zip
PY_BIN=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import zipfile" >/dev/null 2>&1; then
    PY_BIN="$cand"
    break
  fi
done
if command -v zip >/dev/null 2>&1; then
  zip -qr qingsong-rili-windows.zip qingsong-rili-windows -x '*.DS_Store' '*__pycache__*'
elif [ -x /usr/bin/zip ]; then
  /usr/bin/zip -qr qingsong-rili-windows.zip qingsong-rili-windows -x '*.DS_Store' '*__pycache__*'
elif [ -n "$PY_BIN" ]; then
  "$PY_BIN" -c '
import os, zipfile
with zipfile.ZipFile("qingsong-rili-windows.zip", "w", zipfile.ZIP_DEFLATED) as zf:
    for root, _, files in os.walk("qingsong-rili-windows"):
        if "__pycache__" in root: continue
        for f in files:
            if f == ".DS_Store": continue
            p = os.path.join(root, f)
            zf.write(p, p.replace("\\", "/"))
'
else
  echo "找不到 zip 或可用 python，无法压缩"; exit 1
fi

echo "输出: $ROOT/dist/qingsong-rili-windows.zip"
du -sh "$ROOT/dist/qingsong-rili-windows.zip"
