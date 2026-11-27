// 跨平台本机 AI Agent 桌面软件探测与唤起（macOS / Windows 换机通用）
// macOS：扫描 /Applications 与 ~/Applications
// Windows：扫描常见安装目录（LocalAppData / ProgramFiles）、开始菜单/桌面 .lnk 快捷方式及卸载注册表，换机装在任意盘都能识别
import { execFileSync, spawn } from 'node:child_process';
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
      ['LOCALAPPDATA', 'Programs/WorkBuddyAI/WorkBuddyAI.exe'],
      ['ProgramFiles', 'WorkBuddy/WorkBuddy.exe'],
      ['ProgramFiles', 'WorkBuddy AI/WorkBuddy AI.exe'],
      ['ProgramFiles', 'WorkBuddyAI/WorkBuddyAI.exe'],
    ],
    shortcutPatterns: [/workbuddy/i],
    registryPatterns: [/workbuddy/i],
    exeNames: ['WorkBuddyAI.exe', 'WorkBuddy AI.exe', 'WorkBuddy.exe'],
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
    registryPatterns: [/deepseek\s*harness/i],
    exeNames: ['DeepSeek Harness.exe', 'dsh.exe'],
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
    registryPatterns: [/doubao/i, /豆包/],
    exeNames: ['Doubao.exe', '豆包.exe'],
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    desc: '本地开发 Agent',
    macApps: ['Antigravity.app'],
    winExes: [
      ['LOCALAPPDATA', 'Programs/Antigravity/Antigravity.exe'],
      ['LOCALAPPDATA', 'Programs/antigravity/Antigravity.exe'],
      ['ProgramFiles', 'Antigravity/Antigravity.exe'],
    ],
    shortcutPatterns: [/antigravity/i],
    registryPatterns: [/antigravity/i],
    exeNames: ['Antigravity.exe'],
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
    registryPatterns: [/chatgpt/i],
    exeNames: ['ChatGPT.exe'],
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
    registryPatterns: [/^cursor\b/i],
    exeNames: ['Cursor.exe'],
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
    registryPatterns: [/^claude\b/i],
    exeNames: ['claude.exe', 'Claude.exe'],
  },
];

/**
 * 清理会干扰外部桌面应用（尤其是 Electron 应用）启动的环境变量。
 * desktop/main.js 通过 ELECTRON_RUN_AS_NODE=1 用 Electron 内置 Node 启动 server.mjs，
 * 如果子进程继承了该变量，WorkBuddy / DSH / 豆包 / Antigravity / Cursor / Claude 等
 * 所有 Electron 桌面软件都会退化成纯 Node 模式而不弹出 GUI 窗口。
 */
export function cleanLaunchEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  for (const key of [
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ATTACH_CONSOLE',
    'NODE_OPTIONS',
    'SERVER__PORT',
  ]) {
    delete env[key];
  }
  return env;
}

const shortcutInfoCache = new Map();

/** 拆分 Windows 命令行参数字符串（支持双引号包裹） */
export function splitWindowsArgs(argStr) {
  const out = [];
  const s = String(argStr || '').trim();
  if (!s) return out;
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && /\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** 解析 Windows .lnk 快捷方式的完整目标信息（TargetPath / Arguments / WorkingDirectory） */
export function resolveWindowsShortcutInfo(lnkPath) {
  if (process.platform !== 'win32' || !lnkPath || !/\.lnk$/i.test(lnkPath)) return null;
  if (shortcutInfoCache.has(lnkPath)) return shortcutInfoCache.get(lnkPath);
  let info = null;
  try {
    const ps = [
      '$sh = New-Object -ComObject WScript.Shell',
      '$s = $sh.CreateShortcut($env:QS_LNK_PATH)',
      '$obj = @{ targetPath = [string]$s.TargetPath; arguments = [string]$s.Arguments; workingDirectory = [string]$s.WorkingDirectory }',
      '[Console]::Out.Write(($obj | ConvertTo-Json -Compress))',
    ].join('; ');
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      {
        env: { ...cleanLaunchEnv(), QS_LNK_PATH: lnkPath },
        encoding: 'utf8',
        timeout: 4000,
        windowsHide: true,
      },
    ).trim();
    if (out) {
      const parsed = JSON.parse(out);
      info = {
        targetPath: String(parsed?.targetPath || '').trim(),
        arguments: String(parsed?.arguments || '').trim(),
        workingDirectory: String(parsed?.workingDirectory || '').trim(),
      };
    }
  } catch {}
  shortcutInfoCache.set(lnkPath, info);
  return info;
}

/** 解析 Windows .lnk 快捷方式的目标可执行文件路径，失败或目标不存在返回 null */
export function resolveWindowsShortcut(lnkPath) {
  const info = resolveWindowsShortcutInfo(lnkPath);
  if (info?.targetPath && fs.existsSync(info.targetPath)) return info.targetPath;
  return null;
}

let regAppsCache = null;
let regAppsFetchedAt = 0;
const REG_CACHE_TTL_MS = 60_000;

/** 查询 Windows 卸载注册表兜底（覆盖自定义盘符且未创建快捷方式的应用） */
function queryWindowsRegistryApps() {
  if (process.platform !== 'win32') return [];
  if (regAppsCache && Date.now() - regAppsFetchedAt < REG_CACHE_TTL_MS) return regAppsCache;
  let items = [];
  try {
    const ps = [
      '$paths = @("HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*","HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*")',
      '$rows = Get-ItemProperty $paths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match "WorkBuddy|DeepSeek|Doubao|豆包|Antigravity|ChatGPT|Cursor|Claude" } | Select-Object DisplayName, InstallLocation, DisplayIcon',
      'if ($rows) { [Console]::Out.Write(($rows | ConvertTo-Json -Compress)) }',
    ].join('; ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      env: cleanLaunchEnv(),
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    }).trim();
    if (out) {
      const parsed = JSON.parse(out);
      items = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {}
  regAppsCache = items;
  regAppsFetchedAt = Date.now();
  return items;
}

function resolveExeFromRegistryEntry(entry, exeNames = []) {
  if (!entry) return null;
  const iconRaw = String(entry.DisplayIcon || '').trim();
  if (iconRaw) {
    const cleaned = iconRaw.replace(/,\s*-?\d+$/, '').trim().replace(/^"(.*)"$/, '$1');
    if (/\.exe$/i.test(cleaned) && fs.existsSync(cleaned)) return cleaned;
    const dir = path.dirname(cleaned);
    for (const name of exeNames) {
      const cand = path.join(dir, name);
      if (fs.existsSync(cand)) return cand;
    }
  }
  const loc = String(entry.InstallLocation || '').trim().replace(/^"(.*)"$/, '$1');
  if (loc && fs.existsSync(loc)) {
    for (const name of exeNames) {
      const cand = path.join(loc, name);
      if (fs.existsSync(cand)) return cand;
    }
  }
  return null;
}

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
  enableRegistryLookup = null,
} = {}) {
  const isMac = platform === 'darwin';
  const isWin = platform === 'win32';
  const customWinTest = Boolean(winStartMenuDirs);
  const useRegistry = enableRegistryLookup ?? (isWin && !customWinTest);

  const resolvedMacDirs = macAppDirs || ['/Applications', path.join(homeDir, 'Applications')];
  const shortcuts = isWin
    ? collectShortcuts(
        winStartMenuDirs || [
          env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
          env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
          path.join(homeDir, 'Desktop'),
        ].filter(Boolean),
      )
    : [];
  const regApps = useRegistry ? queryWindowsRegistryApps() : [];

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
      // 1. 开始菜单/桌面 .lnk（校验其目标文件真实存在，过滤已卸载的死快捷方式）
      if (shortcuts.length) {
        for (const s of shortcuts) {
          if (!d.shortcutPatterns.some((re) => re.test(s.name))) continue;
          if (!customWinTest) {
            const info = resolveWindowsShortcutInfo(s.full);
            if (info?.targetPath && !fs.existsSync(info.targetPath)) continue;
          }
          appPath = s.full;
          break;
        }
      }
      // 2. 常见安装路径
      if (!appPath) {
        for (const [envKey, rel] of d.winExes) {
          const base = env[envKey];
          if (!base) continue;
          const candidate = path.join(base, rel);
          try {
            if (fs.existsSync(candidate)) { appPath = candidate; break; }
          } catch {}
        }
      }
      // 3. 卸载注册表兜底（自定义盘符且无快捷方式）
      if (!appPath && regApps.length && d.registryPatterns) {
        const entry = regApps.find((r) => d.registryPatterns.some((re) => re.test(String(r.DisplayName || ''))));
        const exe = resolveExeFromRegistryEntry(entry, d.exeNames);
        if (exe) appPath = exe;
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

/** 跨平台可靠唤起已探测到的任意本机 AI 助手桌面端（WorkBuddy / DSH / 豆包 / Antigravity / Cursor / Claude / ChatGPT） */
export function launchLocalAgent(agent, { platform = process.platform } = {}) {
  if (!agent?.appPath) throw new Error('未找到助手程序路径');
  const env = cleanLaunchEnv();
  if (platform === 'darwin') {
    spawn('open', ['-a', agent.appPath], { detached: true, stdio: 'ignore', env }).unref();
    return;
  }
  if (platform === 'win32') {
    let exePath = agent.appPath;
    let args = [];
    let cwd = path.dirname(agent.appPath);

    if (/\.lnk$/i.test(agent.appPath)) {
      const info = resolveWindowsShortcutInfo(agent.appPath);
      if (info?.targetPath && fs.existsSync(info.targetPath)) {
        exePath = info.targetPath;
        args = splitWindowsArgs(info.arguments);
        cwd = info.workingDirectory && fs.existsSync(info.workingDirectory)
          ? info.workingDirectory
          : path.dirname(exePath);
      }
    }

    // 优先直接 spawn 真实 .exe（detached + windowsHide: false），
    // 绕开 PowerShell/ShellExecute 在隐藏服务端进程下继承 SW_HIDE 或静默丢弃的问题。
    if (/\.exe$/i.test(exePath) && fs.existsSync(exePath)) {
      spawn(exePath, args, {
        cwd,
        detached: true,
        stdio: 'ignore',
        env,
        windowsHide: false,
      }).unref();
      return;
    }

    // 兜底：无直接 .exe 目标的快捷方式（如 Store/AppAlias）通过 cmd start 拉起
    spawn('cmd.exe', ['/c', 'start', '', agent.appPath], {
      detached: false,
      stdio: 'ignore',
      env,
      windowsHide: false,
    }).unref();
    return;
  }
  throw new Error('当前系统请手动打开对应助手粘贴指令');
}
