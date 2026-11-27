// 跨平台本机 AI Agent 桌面软件探测（macOS / Windows 换机通用）
// macOS：扫描 /Applications 与 ~/Applications
// Windows：扫描常见安装目录（LocalAppData / ProgramFiles）及开始菜单 .lnk 快捷方式，换机装在任意盘都能识别
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AGENT_DEFS = [
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    desc: '直接执行命令帮配好',
    macApps: ['WorkBuddy AI.app', 'WorkBuddy.app'],
    winExes: [
      ['LOCALAPPDATA', 'Programs/WorkBuddy/WorkBuddy.exe'],
      ['LOCALAPPDATA', 'Programs/WorkBuddy AI/WorkBuddy AI.exe'],
      ['ProgramFiles', 'WorkBuddy/WorkBuddy.exe'],
      ['ProgramFiles', 'WorkBuddy AI/WorkBuddy AI.exe'],
    ],
    shortcutPatterns: [/workbuddy/i],
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    desc: 'DSH 桌面助手',
    macApps: ['DeepSeek Harness.app'],
    winExes: [
      ['LOCALAPPDATA', 'Programs/DeepSeek Harness/DeepSeek Harness.exe'],
      ['LOCALAPPDATA', 'Programs/deepseek-harness/DeepSeek Harness.exe'],
      ['ProgramFiles', 'DeepSeek Harness/DeepSeek Harness.exe'],
    ],
    shortcutPatterns: [/deepseek\s*harness/i, /\bdsh\b/i],
  },
  {
    id: 'doubao',
    name: '豆包',
    desc: '字节豆包桌面端',
    macApps: ['Doubao.app', '豆包.app'],
    winExes: [
      ['LOCALAPPDATA', 'Doubao/Doubao.exe'],
      ['LOCALAPPDATA', 'Programs/Doubao/Doubao.exe'],
      ['ProgramFiles', 'Doubao/Doubao.exe'],
      ['ProgramFiles(x86)', 'Doubao/Doubao.exe'],
    ],
    shortcutPatterns: [/doubao/i, /豆包/],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    desc: '本地开发 Agent',
    macApps: ['Antigravity.app'],
    winExes: [
      ['LOCALAPPDATA', 'Programs/Antigravity/Antigravity.exe'],
      ['ProgramFiles', 'Antigravity/Antigravity.exe'],
    ],
    shortcutPatterns: [/antigravity/i],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    desc: 'OpenAI 桌面端',
    macApps: ['ChatGPT.app'],
    winExes: [
      ['LOCALAPPDATA', 'Programs/ChatGPT/ChatGPT.exe'],
      ['ProgramFiles', 'ChatGPT/ChatGPT.exe'],
    ],
    shortcutPatterns: [/chatgpt/i],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    desc: 'AI 编程助手',
    macApps: ['Cursor.app'],
    winExes: [
      ['LOCALAPPDATA', 'Programs/cursor/Cursor.exe'],
      ['ProgramFiles', 'cursor/Cursor.exe'],
    ],
    shortcutPatterns: [/^cursor\b/i],
  },
  {
    id: 'claude',
    name: 'Claude',
    desc: 'Anthropic 桌面端',
    macApps: ['Claude.app'],
    winExes: [
      ['LOCALAPPDATA', 'AnthropicClaude/claude.exe'],
      ['LOCALAPPDATA', 'Programs/Claude/Claude.exe'],
      ['ProgramFiles', 'Claude/Claude.exe'],
    ],
    shortcutPatterns: [/^claude\b/i],
  },
];

function collectShortcuts(dirs, maxDepth = 2) {
  const out = [];
  function walk(dir, depth) {
    if (!dir || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full, depth + 1);
      } else if (ent.isFile() && /\.lnk$/i.test(ent.name)) {
        out.push({ name: ent.name.replace(/\.lnk$/i, ''), full });
      }
    }
  }
  for (const d of dirs) walk(d, 0);
  return out;
}

export function detectLocalAgents({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
  macAppDirs = null,
  winStartMenuDirs = null,
} = {}) {
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';

  const resolvedMacDirs = macAppDirs || ['/Applications', path.join(homeDir, 'Applications')];
  const shortcuts = isWin
    ? collectShortcuts(
        winStartMenuDirs || [
          env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
          env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
        ].filter(Boolean),
      )
    : [];

  return AGENT_DEFS.map((d) => {
    let appPath = null;
    if (isMac) {
      outer: for (const dir of resolvedMacDirs) {
        for (const appName of d.macApps) {
          const candidate = path.join(dir, appName);
          try {
            if (fs.existsSync(candidate)) { appPath = candidate; break outer; }
          } catch {}
        }
      }
    } else if (isWin) {
      for (const [envKey, rel] of d.winExes) {
        const base = env[envKey];
        if (!base) continue;
        const candidate = path.join(base, rel);
        try {
          if (fs.existsSync(candidate)) { appPath = candidate; break; }
        } catch {}
      }
      if (!appPath && shortcuts.length) {
        const hit = shortcuts.find((s) => d.shortcutPatterns.some((re) => re.test(s.name)));
        if (hit) appPath = hit.full;
      }
    }

    return {
      id: d.id,
      name: d.name,
      desc: d.desc,
      installed: Boolean(appPath),
      appPath,
    };
  });
}
