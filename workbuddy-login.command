#!/bin/bash
# 一次性登录 WorkBuddy 命令行，让「轻松日程」能点按钮当场调用模型整理。
# 用法：双击本文件 → 出现界面后输入 /login 回车 → 浏览器里点授权。
cd "$(dirname "$0")" || exit 1

# 关键：WorkBuddy 注入的这几个变量会让 CLI 启动即失败
unset NODE_OPTIONS
unset SERVER__PORT
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy

# 优先用独立安装的完整版（带登录界面），没有就退回应用自带的精简版
CB="$HOME/.local/bin/codebuddy"
if [ ! -x "$CB" ]; then
  CB="/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"
fi

if [ ! -x "$CB" ]; then
  echo "没找到 WorkBuddy 命令行。"
  echo "请确认 WorkBuddy 已安装，或先运行："
  echo "  /Applications/WorkBuddy\\ AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy install latest"
  exit 1
fi

echo "正在启动 WorkBuddy 命令行：$CB"
echo
echo "启动后请："
echo "  1. 输入  /login  然后回车"
echo "  2. 在浏览器里完成授权"
echo "  3. 回到这里按 Ctrl+C 退出即可"
echo

exec "$CB" --port 0
