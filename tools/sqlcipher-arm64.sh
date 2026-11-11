#!/bin/bash
# 强制用 arm64 的系统 Python 3.9 跑 sqlcipher 兼容替身。
# /usr/bin/python3 是 x86_64 + arm64e 的通用二进制；WorkBuddy 的 Node 子进程会把
# x86_64 架构偏好继承下去，导致加载不了 arm64 的 sqlcipher3 扩展，微信库读取失败。
exec /usr/bin/arch -arm64 /usr/bin/python3 "$HOME/.local/bin/sqlcipher" "$@"
