// 整理请求队列：应用只负责「记下有人想整理」，真正的整理由 WorkBuddy 助手消费。
// 应用是独立进程，MCP 是单向的（客户端调服务端），没法反过来叫醒当前会话里的助手，
// 所以用磁盘上的一个队列文件把两边接起来。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, cryptoId } from './store.mjs';

const FILE = path.join(DATA_DIR, 'organize_queue.json');
const MAX = 60;

function read() {
  try {
    const list = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list.slice(-MAX), null, 2));
  fs.renameSync(tmp, FILE);
}

/** trigger: manual / auto / paste；type: notices / manual / fun
 *  extra 只接收白名单字段，避免覆盖请求的核心字段。
 */
export function enqueue(trigger = 'manual', type = 'notices', extra = {}) {
  const list = read();
  const job = {
    id: cryptoId(),
    trigger,
    type,
    requestedAt: Date.now(),
    status: 'pending',
  };
  // 手动添加会把用户粘贴的原文与来源一起带过来
  if (typeof extra.rawText === 'string') job.rawText = extra.rawText;
  if (typeof extra.source === 'string') job.source = extra.source;
  list.push(job);
  write(list);
  return job;
}

export function pending(type = null) {
  return read().filter(
    (j) => j.status === 'pending' && (!type || (j.type || 'notices') === type)
  );
}

export function recent(limit = 20) {
  return read().slice(-limit);
}

export function latestDone() {
  const done = read().filter((j) => j.status === 'done');
  return done.length ? done[done.length - 1] : null;
}

export function getJob(id) {
  return read().find((j) => j.id === id) || null;
}

/** 标记请求完成，附上这次整理的结果，供界面显示「整理完成 · N 条」 */
export function complete(id, result = {}) {
  const list = read();
  const hit = list.find((j) => j.id === id);
  if (!hit) return null;
  hit.status = 'done';
  hit.doneAt = Date.now();
  hit.result = result;
  write(list);
  return hit;
}
