#!/usr/bin/env bash
# 构建 macOS 原生桌面版「轻松日程.app」（Swift + WKWebView，体积极小、启动快，无需手动开浏览器）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="轻松日程"
BUNDLE_ID="com.qingsong.rili.desktop"
VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT/version.json','utf8')).version || '1.0.0')")"
OUT_APP="${OUT_APP:-$ROOT/dist/${APP_NAME}.app}"
PORTABLE="${PORTABLE:-0}"
UNIVERSAL="${UNIVERSAL:-$PORTABLE}"
if [ "$PORTABLE" = "1" ]; then
  SKIP_INSTALL=1
fi
INSTALL_APP="/Applications/${APP_NAME}.app"
ICON_SRC="$ROOT/desktop/build/icon.png"
OBJC_SRC="$ROOT/desktop/macos/QingsongApp.m"

echo "正在构建 ${APP_NAME}.app (v${VERSION}, portable=${PORTABLE}, universal=${UNIVERSAL})..."
mkdir -p "$(dirname "$OUT_APP")"
rm -rf "$OUT_APP"
mkdir -p "$OUT_APP/Contents/MacOS" "$OUT_APP/Contents/Resources"

# 1. 生成 AppIcon.icns
TMP_ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$TMP_ICONSET"
for sz in 16 32 128 256 512; do
  sips -z "$sz" "$sz" "$ICON_SRC" --out "$TMP_ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sz2=$((sz * 2))
  sips -z "$sz2" "$sz2" "$ICON_SRC" --out "$TMP_ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$TMP_ICONSET" -o "$OUT_APP/Contents/Resources/AppIcon.icns"
rm -rf "$(dirname "$TMP_ICONSET")"

# 2. 编译 Objective-C 原生桌面壳（WKWebView + Cocoa，零外部依赖）
ARCH_FLAGS=()
if [ "$UNIVERSAL" = "1" ]; then
  ARCH_FLAGS=(-arch arm64 -arch x86_64)
fi
clang -O2 -fobjc-arc ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"} \
  -framework Cocoa \
  -framework WebKit \
  "$OBJC_SRC" \
  -o "$OUT_APP/Contents/MacOS/QingsongRili"

# 3. 写入 Info.plist（便携版不写入个人路径，允许本机 127.0.0.1 HTTP）
PROJECT_DIR_XML=""
if [ "$PORTABLE" != "1" ]; then
  PROJECT_DIR_XML=$'  <key>QingsongProjectDir</key>\n  <string>'"${ROOT}"$'</string>'
fi
cat > "$OUT_APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleExecutable</key>
  <string>QingsongRili</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
${PROJECT_DIR_XML}
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

# 4. 本机签名并同步到 /Applications
codesign --force --deep --sign - "$OUT_APP" >/dev/null 2>&1 || true

if [ "${SKIP_INSTALL:-0}" != "1" ] && [ -w "/Applications" ]; then
  rm -rf "$INSTALL_APP"
  cp -R "$OUT_APP" "$INSTALL_APP"
  echo "已安装到：$INSTALL_APP"
fi

echo "构建完成：$OUT_APP"
du -sh "$OUT_APP"
