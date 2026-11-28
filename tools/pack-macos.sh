#!/bin/bash
# 打包 macOS 便携独立版：通用二进制 (arm64 + x86_64) 轻松日程.app + 项目代码 + 微信解密技能子集 + 空白数据
# 输出 dist/qingsong-rili-macos.zip（不含个人 data、key、解密聊天库、.venv 或个人绝对路径）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILL="${WECHAT_DECRYPT_DIR:-$HOME/.dsh/skills/wechat-decrypt}"
[ -d "$SKILL/scripts/common" ] || SKILL="$ROOT/vendor/wechat-decrypt"
OUT="$ROOT/dist/qingsong-rili-macos"
NODE="${NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || [ ! -x "$HOME/.local/bin/node" ] || NODE="$HOME/.local/bin/node"
[ -n "$NODE" ] || { echo "找不到 node，可用 NODE=/path/to/node 指定"; exit 1; }

[ -f "$SKILL/scripts/common/query.py" ] || { echo "找不到微信解密技能: $SKILL"; exit 1; }
[ -f "$ROOT/desktop/macos/QingsongApp.m" ] || { echo "找不到 macOS 桌面入口: desktop/macos/QingsongApp.m"; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/lib" "$OUT/public" "$OUT/data" "$OUT/tools" \
         "$OUT/desktop/macos" "$OUT/desktop/build" \
         "$OUT/vendor/wechat-decrypt/scripts/common" \
         "$OUT/vendor/wechat-decrypt/scripts/macos"

# ── 应用代码与启动脚本 ──
cp "$ROOT"/server.mjs "$ROOT"/mcp-server.mjs "$ROOT"/wb-bridge.mjs "$ROOT"/version.json "$OUT"/
cp "$ROOT"/start.command "$ROOT"/workbuddy-login.command "$ROOT"/INSTALL_FOR_AI.md "$ROOT"/README.md "$OUT"/
chmod +x "$OUT/start.command" "$OUT/workbuddy-login.command"

for f in store.mjs wechat.mjs queue.mjs fun-summary.mjs workbuddy-model.mjs model-openai.mjs providers.mjs agents.mjs bridge.mjs update.mjs; do
  cp "$ROOT/lib/$f" "$OUT/lib/"
done
cp "$ROOT"/public/* "$OUT/public/"

cp "$ROOT/tools/list_sessions.py" "$ROOT/tools/find_images.py" "$ROOT/tools/ocr.swift" \
   "$ROOT/tools/build-mac-app.sh" "$ROOT/tools/sqlcipher-arm64.sh" "$OUT/tools/"
chmod +x "$OUT/tools/list_sessions.py" "$OUT/tools/build-mac-app.sh" "$OUT/tools/sqlcipher-arm64.sh"

cp "$ROOT/desktop/main.js" "$ROOT/desktop/package.json" "$ROOT/desktop/package-lock.json" "$ROOT/desktop/README.md" "$OUT/desktop/"
cp "$ROOT/desktop/macos/QingsongApp.m" "$OUT/desktop/macos/"
cp "$ROOT/desktop/build/icon.png" "$OUT/desktop/build/"

# ── 构建通用二进制便携 App（不写入本机路径） ──
PORTABLE=1 UNIVERSAL=1 OUT_APP="$OUT/轻松日程.app" "$ROOT/tools/build-mac-app.sh"

# ── 生成一键安装到「应用程序」的脚本（无需 Xcode CLT） ──
cat > "$OUT/安装到应用程序.command" <<'EOF'
#!/bin/bash
# 将「轻松日程.app」安装到 /Applications 并绑定当前目录，去除首次下载隔离标记
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC_APP="$ROOT/轻松日程.app"
DST_APP="/Applications/轻松日程.app"

if [ ! -d "$SRC_APP" ]; then
  echo "未找到 $SRC_APP"
  read -r -p "按回车关闭…"
  exit 1
fi

xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null || true
rm -rf "$DST_APP"
cp -R "$SRC_APP" "$DST_APP"
/usr/libexec/PlistBuddy -c "Delete :QingsongProjectDir" "$DST_APP/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :QingsongProjectDir string $ROOT" "$DST_APP/Contents/Info.plist"
codesign --force --deep --sign - "$DST_APP" >/dev/null 2>&1 || true

echo "已安装到：$DST_APP（绑定目录：$ROOT）"
/usr/bin/open "$DST_APP"
EOF
chmod +x "$OUT/安装到应用程序.command"

# ── 空白数据（绝不带个人聊天摘要，默认开启国内加速镜像） ──
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

# ── 微信解密技能（只带 macOS 运行所需，不含 key / decrypted / .venv） ──
cp "$SKILL"/*.py "$OUT/vendor/wechat-decrypt/"
cp "$SKILL"/setup.sh "$SKILL"/pyproject.toml "$SKILL"/LICENSE \
   "$OUT/vendor/wechat-decrypt/" 2>/dev/null || true
if [ -f "$ROOT/vendor/wechat-decrypt/SKILL.md" ]; then
  cp "$ROOT/vendor/wechat-decrypt/SKILL.md" "$OUT/vendor/wechat-decrypt/"
elif [ -f "$SKILL/SKILL.md" ]; then
  cp "$SKILL/SKILL.md" "$OUT/vendor/wechat-decrypt/"
fi
cp "$SKILL"/scripts/common/*.py "$OUT/vendor/wechat-decrypt/scripts/common/"
if [ -f "$OUT/vendor/wechat-decrypt/scripts/common/query_fts.py" ]; then
  "$NODE" -e '
  const fs = require("fs"), p = process.argv[1];
  let s = fs.readFileSync(p, "utf8");
  const re = /open\(["\x27]\/Users\/[^"\x27]+\/data\/settings\.json["\x27]\)/;
  if (re.test(s)) {
    const repl = "open(next(c for c in (os.environ.get(\"QINGSONG_SETTINGS\"), os.path.abspath(os.path.join(SKILL_DIR, \"..\", \"..\", \"data\", \"settings.json\")), os.path.join(os.getcwd(), \"data\", \"settings.json\")) if c and os.path.isfile(c)), encoding=\"utf-8\")";
    s = s.replace(re, repl);
    fs.writeFileSync(p, s);
  }
  ' "$OUT/vendor/wechat-decrypt/scripts/common/query_fts.py"
fi
if [ -d "$SKILL/scripts/macos" ]; then
  for f in extract_key.sh extract_key_v42.sh hook_pbkdf.js; do
    if [ -f "$SKILL/scripts/macos/$f" ]; then
      cp "$SKILL/scripts/macos/$f" "$OUT/vendor/wechat-decrypt/scripts/macos/"
    fi
  done
  chmod +x "$OUT/vendor/wechat-decrypt/scripts/macos"/*.sh 2>/dev/null || true
fi

# ── 安全与可移植性校验 ──
for bad in key.txt key_windows.txt per_db_keys.json all_keys.json; do
  if [ -e "$OUT/vendor/wechat-decrypt/$bad" ]; then echo "拒绝打包：包含敏感文件 $bad"; exit 1; fi
done
[ -d "$OUT/vendor/wechat-decrypt/decrypted" ] && { echo "拒绝打包：包含 decrypted 聊天库"; exit 1; }
[ -d "$OUT/vendor/wechat-decrypt/.venv" ] && { echo "拒绝打包：包含 .venv"; exit 1; }
if compgen -G "$OUT/vendor/wechat-decrypt/key-backup*" >/dev/null 2>&1; then
  echo "拒绝打包：包含 key-backup 目录"; exit 1
fi
if grep -q "QingsongProjectDir" "$OUT/轻松日程.app/Contents/Info.plist"; then
  echo "拒绝打包：Info.plist 包含了硬编码的 QingsongProjectDir"; exit 1
fi
ARCH_INFO="$(lipo -info "$OUT/轻松日程.app/Contents/MacOS/QingsongRili")"
echo "通用二进制架构: $ARCH_INFO"
echo "$ARCH_INFO" | grep -q "arm64" && echo "$ARCH_INFO" | grep -q "x86_64" \
  || { echo "拒绝打包：App 二进制不是 arm64 + x86_64 通用格式"; exit 1; }
if grep -rnE "/Users/[A-Za-z0-9._-]+/" "$OUT" >/dev/null 2>&1; then
  echo "拒绝打包：产物中存在个人目录路径"; exit 1
fi

# ── 压缩输出 ──
cd "$ROOT/dist"
rm -f qingsong-rili-macos.zip
/usr/bin/zip -qry qingsong-rili-macos.zip qingsong-rili-macos -x '*.DS_Store' '*__pycache__*'

echo "输出: $ROOT/dist/qingsong-rili-macos.zip"
/usr/bin/du -sh "$ROOT/dist/qingsong-rili-macos.zip"
