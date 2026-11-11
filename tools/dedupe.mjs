// 合并现有重复条目：保留状态更"重要"的（todo > new > done > skip），补全信息
import fs from 'node:fs';
import { isSameEvent } from '../lib/store.mjs';

const file = new URL('../data/notices.json', import.meta.url).pathname;
const list = JSON.parse(fs.readFileSync(file, 'utf8'));
const rank = { todo: 0, new: 1, done: 2, skip: 3 };
const out = [];
for (const n of list) {
  const hit = out.find((x) => isSameEvent(x, n));
  if (!hit) { out.push(n); continue; }
  if ((rank[n.status] ?? 9) < (rank[hit.status] ?? 9)) {
    hit.status = n.status;
    if (n.archivedAt) hit.archivedAt = n.archivedAt;
    if (n.prevStatus) hit.prevStatus = n.prevStatus;
  }
  if ((n.detail || '').length > (hit.detail || '').length) hit.detail = n.detail;
  if (n.deadline && !hit.deadline) hit.deadline = n.deadline;
  if (n.title.length < hit.title.length) hit.title = n.title;
}
fs.writeFileSync(file + '.tmp', JSON.stringify(out, null, 2));
fs.renameSync(file + '.tmp', file);
console.log(`合并 ${list.length} → ${out.length}`);
