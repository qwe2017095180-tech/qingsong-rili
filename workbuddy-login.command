#!/bin/bash
# 一次性登录 WorkBuddy 命令行，让「轻松日程」能点按钮当场调用模型整理。
# 双击本文件后，在出现的命令行里输入 /login 并回车，再到浏览器里确认授权即可。
cd "$(dirname "$0")" || exit 1
exec "/Applications/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy" --port 0
