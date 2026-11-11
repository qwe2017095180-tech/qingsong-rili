#!/usr/bin/env node
// WorkBuddy 整理桥：不依赖 WorkBuddy 的 MCP 连接器是否信任，
// 直接以 stdio JSON-RPC 调用 mcp-server.mjs，让自动化任务能稳定读消息、写回结果。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pending, getJob, complete } from './lib/queue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, 'mcp-server.mjs');

function callMcp(name, args, timeoutMs = 300_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let settled = false;
    const timer = setTimeout(
      () => finish(new Error(`${name} 超时（${Math.round(timeoutMs / 1000)} 秒）`)),
      timeoutMs
    );

    function finish(err, text) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch {}
      if (err) reject(err);
      else resolve(text);
    }

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== 2) continue;           // id=1 是 initialize 的响应
        const res = msg.result || {};
        const text = (res.content || []).map((c) => c.text || '').join('\n');
        if (res.isError) return finish(new Error(text));
        return finish(null, text);
      }
    });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('error', (e) => finish(e));
    child.on('close', () => finish(new Error(`${name} 未返回结果，服务提前退出`)));

    // 保持 stdin 常开：mcp-server 的 get_pending_messages 是异步读微信数据库，
    // 过早 EOF 会让子进程在响应还没写出来时就退出。
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'wb-bridge' } },
    }) + '\n');
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name, arguments: args },
    }) + '\n');
  });
}

const USAGE = `用法：
  node wb-bridge.mjs pending [hours]          读取最近 N 小时聊天文本（不传则用应用设置里的 lookbackHours）
  node wb-bridge.mjs list [limit]             查看已有通知标题
  node wb-bridge.mjs submit <items.json>      把整理好的条目写回
  node wb-bridge.mjs queue                   查看待处理的整理请求（原文只显预览）
  node wb-bridge.mjs raw <id>                读取某个手动添加请求的完整粘贴原文
  node wb-bridge.mjs complete <id> '<json>'  标记请求完成并附上结果
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'pending') {
    // 不传小时就完全交给应用设置（前端「往回看多少小时」），不再写死 72
    const hours = Number(rest[0]) || 0;
    process.stdout.write(await callMcp('get_pending_messages', hours ? { hours } : {}));
  } else if (cmd === 'list') {
    process.stdout.write(await callMcp('list_notices', { limit: Number(rest[0]) || 60 }));
  } else if (cmd === 'submit') {
    const file = rest[0];
    if (!file) throw new Error('缺少 items.json 路径');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const items = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(items) || !items.length) throw new Error('items 为空，本次不写回');
    process.stdout.write(await callMcp('submit_notices', { items }));
  } else if (cmd === 'queue') {
    // 手动粘贴的原文可能很长，列表里只给预览，全文用 raw <id> 取
    const list = pending().map((j) => {
      if (!j.rawText) return j;
      const t = j.rawText;
      return { ...j, rawText: t.length > 120 ? t.slice(0, 120) + '…（用 raw <id> 看全文）' : t };
    });
    console.log(JSON.stringify(list, null, 2));
  } else if (cmd === 'raw') {
    const job = getJob(rest[0]);
    if (!job) throw new Error('找不到整理请求: ' + rest[0]);
    process.stdout.write(
      (job.source ? `来源：${job.source}\n` : '来源：手动添加\n') +
      (job.rawText || '') + '\n'
    );
  } else if (cmd === 'complete') {
    const id = rest[0];
    let result = {};
    if (rest[1]) {
      try { result = JSON.parse(rest[1]); } catch { result = { note: rest[1] }; }
    }
    const job = complete(id, result);
    if (!job) throw new Error('找不到整理请求: ' + id);
    console.log(JSON.stringify(job, null, 2));
  } else {
    process.stdout.write(USAGE);
  }
}

main().catch((e) => {
  console.error('错误：' + e.message);
  process.exit(1);
});
