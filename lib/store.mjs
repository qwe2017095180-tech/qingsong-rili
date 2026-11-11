// 本地 JSON 存储：设置、通知、整理记录
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_SETTINGS = {
  times: ['20:00'],          // 每天自动整理的时刻
  days: 'daily',             // daily | weekday
  groups: [],                // 通知群 [{ wxid, name }]
  funGroups: [],             // 娱乐群 [{ wxid, name }]
  lookbackHours: 24,         // 每次整理往回看多少小时
  limitPerGroup: 400,        // 每个群最多取多少条
  aiEnabled: false,          // 本机 AI 整理已停用（保留字段兼容旧设置）
  ocrImages: false,          // 读取群里的图片文字（较慢）
  termStart: null,           // 学期第一周周一，如 2026-09-01
  lastRunAt: null,
  lastRunDate: null,         // YYYY-MM-DD，最近一次整理日期
  lastRunSlots: [],          // 已触发过的定时槽，如 2026-11-05T20:00
  organizeBackend: 'auto',   // auto | workbuddy | openai | queue | none
  apiBaseUrl: 'https://api.deepseek.com',  // OpenAI 兼容接口地址
  apiKey: '',                // 只存本机，不要提交
  apiModel: 'deepseek-chat',
};

function readJson(name, fallback) {
  const file = path.join(DATA_DIR, name);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(name, value) {
  const file = path.join(DATA_DIR, name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const store = {
  settings: { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) },
  notices: readJson('notices.json', []),
  funItems: readJson('fun.json', []),
  runs: readJson('runs.json', []),

  // 应用服务和 MCP server 是两个进程，各自只在启动时把 json 读进内存。
  // 读写之前重新从磁盘加载，避免一方把另一方刚写的内容覆盖掉，
  // 也保证 WorkBuddy 写回的卡片界面上立刻能看到，不必重启应用。
  reloadSettings() { this.settings = { ...DEFAULT_SETTINGS, ...readJson('settings.json', {}) }; },
  reloadNotices() { this.notices = readJson('notices.json', []); },
  reloadFun() { this.funItems = readJson('fun.json', []); },
  reloadRuns() { this.runs = readJson('runs.json', []); },
  reloadAll() { this.reloadSettings(); this.reloadNotices(); this.reloadFun(); this.reloadRuns(); },

  saveSettings() { writeJson('settings.json', this.settings); },
  saveNotices() { writeJson('notices.json', this.notices); },
  saveFun() { writeJson('fun.json', this.funItems); },
  saveRuns() { writeJson('runs.json', this.runs.slice(0, 100)); },

  /** 新增通知；标题相近 + 同分类 + 同来源群的视为同一条，合并更新 */
  upsertNotices(items, meta = {}) {
    this.reloadNotices();
    let added = 0;
    let updated = 0;
    for (const it of items) {
      const notice = {
        category: it.category || '其他',
        title: (it.title || '').trim() || '未命名通知',
        summary: (it.summary || '').trim(),
        detail: (it.detail || '').trim(),
        deadline: it.deadline || null,
        group: it.group || '',
        action: it.action || null,
        runId: meta.runId || null,
        sourceTime: it.sourceTime || null,
        raw: it.raw || '',
      };
      const hit = this.notices.find((n) => n.status !== 'done' && n.status !== 'skip' && isSameEvent(n, notice));
      if (hit) {
        // 保留用户已做的决定（待办 / 忽略 / 完成 / 归档时间）
        if (it.status === 'todo' && hit.status === 'new') hit.status = 'todo';
        if (notice.detail.length > (hit.detail || '').length) hit.detail = notice.detail;
        // 已有摘要是用户或助手写好的，合并时不要用原文首句覆盖它
        if (notice.summary && !hit.summary) hit.summary = notice.summary;
        if (notice.deadline && notice.deadline !== hit.deadline) hit.deadline = notice.deadline;
        if (notice.action && !hit.action) hit.action = notice.action;
        if (!hit.raw && notice.raw) hit.raw = notice.raw;
        hit.updatedAt = Date.now();
        updated++;
      } else {
        this.notices.unshift({
          id: cryptoId(),
          // 手动添加待办时，整理方会在条目上带 status:'todo'，卡片直接进「待办」栏
          status: it.status === 'todo' ? 'todo' : 'new',
          createdAt: Date.now(),
          ...notice,
        });
        added++;
      }
    }
    this.saveNotices();
    return { added, updated };
  },

  /** 写入或更新一个娱乐群的整体总结 */
  upsertFunGroup(entry) {
    this.reloadFun();
    const i = this.funItems.findIndex((x) => x.group === entry.group);
    if (i >= 0) {
      this.funItems[i] = { ...this.funItems[i], ...entry };
    } else {
      this.funItems.unshift({ id: cryptoId(), createdAt: Date.now(), ...entry });
    }
    this.funItems.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    this.saveFun();
  },

  findNotice(id) {
    return this.notices.find((n) => n.id === id);
  },
};

export function norm(s) {
  return String(s || '').toLowerCase().replace(/[\s，。！!？?、,.：:；;（）()【】\[\]"'“”‘’]/g, '');
}

/** 文本相似度：完全相同 1，包含 0.9，否则按字符二元组算 Jaccard */
export function textSim(a, b) {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.9;
  const grams = (s) => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ga = grams(A);
  const gb = grams(B);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/** 判断两条通知是不是同一件事 */
export function isSameEvent(a, b) {
  // 同群 + 标题完全相同：直接算同一件事（分类可能被 AI 判得不一样）
  {
    const ta = norm(a.title);
    const tb = norm(b.title);
    const sameG = Boolean(a.group && b.group && a.group === b.group);
    if (ta && tb && sameG && ta === tb) return true;
    if (a.category === b.category && ta && tb && (ta.includes(tb) || tb.includes(ta)) && Math.min(ta.length, tb.length) >= 3) return true;
  }
  const sameGroup = Boolean(a.group && b.group && a.group === b.group);
  const t = textSim(a.title, b.title);
  const sm = textSim(a.summary, b.summary);
  const d = textSim(a.detail, b.detail);
  if (a.category !== b.category) {
    // 分类可能被 AI 判得不一样，但内容极像时仍视为同一条
    return t >= 0.8 && d >= 0.55;
  }
  if (sameGroup) return t >= 0.45 || sm >= 0.5 || d >= 0.42;
  // 跨群转发：标题像，或摘要非常像（同一通知在不同群转发时标题常被改写）
  if (sm >= 0.68) return true;
  return t >= 0.72 && sm >= 0.55;
}

export function cryptoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
