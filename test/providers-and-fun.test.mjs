import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AI_PROVIDERS,
  DEFAULT_PROVIDER_ID,
  activeProviderId,
  inferProviderFromBaseUrl,
  resolveOpenAIConfig,
} from '../lib/providers.mjs';
import { organizeByOpenAI, openaiReady } from '../lib/model-openai.mjs';
import { backendStatus, pickBackend, resolveCliSpawn } from '../lib/workbuddy-model.mjs';
import {
  prepareFunTranscript,
  summarizeFunWithModel,
} from '../lib/fun-summary.mjs';
import { wechatDiagnostics } from '../lib/wechat.mjs';
import { detectLocalAgents, cleanLaunchEnv } from '../lib/agents.mjs';

test('defaults to DeepSeek and triggers onboarding when unconfigured', () => {
  const prevDeepseek = process.env.DEEPSEEK_API_KEY;
  const prevOpenai = process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.equal(DEFAULT_PROVIDER_ID, 'deepseek');
    assert.equal(activeProviderId({}), 'deepseek');
    assert.equal(pickBackend({}), 'openai');

    const status = backendStatus({});
    assert.equal(status.provider, 'deepseek');
    assert.equal(status.providerName, 'DeepSeek');
    assert.equal(status.ready, false);
    assert.equal(status.needsOnboarding, true);
    assert.ok(AI_PROVIDERS.length >= 8);

    // Local Ollama custom endpoint does not require an API key
    const localCfg = {
      aiProvider: 'custom',
      apiBaseUrl: 'http://127.0.0.1:11434/v1',
      apiModel: 'qwen2.5:14b',
      apiKey: '',
    };
    assert.equal(openaiReady(localCfg), true);
    assert.equal(backendStatus(localCfg).ready, true);
  } finally {
    if (prevDeepseek !== undefined) process.env.DEEPSEEK_API_KEY = prevDeepseek;
    if (prevOpenai !== undefined) process.env.OPENAI_API_KEY = prevOpenai;
  }
});

test('resolves multi-provider presets and preserves per-provider profiles', () => {
  const settings = {
    aiProvider: 'qwen',
    providerProfiles: {
      deepseek: { apiKey: 'sk-ds', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      qwen: { apiKey: 'sk-qw', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    },
  };
  const qw = resolveOpenAIConfig(settings);
  assert.equal(qw.providerId, 'qwen');
  assert.equal(qw.apiKey, 'sk-qw');
  assert.equal(qw.model, 'qwen-plus');

  const ds = resolveOpenAIConfig({ ...settings, aiProvider: 'deepseek' });
  assert.equal(ds.providerId, 'deepseek');
  assert.equal(ds.apiKey, 'sk-ds');
  assert.equal(ds.baseUrl, 'https://api.deepseek.com');

  // Empty profile key must not shadow top-level saved apiKey
  const fallbackKey = resolveOpenAIConfig({
    aiProvider: 'deepseek',
    apiKey: 'sk-top-level',
    providerProfiles: { deepseek: { apiKey: '' } },
  });
  assert.equal(fallbackKey.apiKey, 'sk-top-level');

  assert.equal(inferProviderFromBaseUrl('https://api.moonshot.cn/v1'), 'moonshot');
  assert.equal(inferProviderFromBaseUrl('https://open.bigmodel.cn/api/paas/v4'), 'zhipu');
  assert.equal(inferProviderFromBaseUrl('https://api.siliconflow.cn/v1'), 'siliconflow');
});

test('organizeByOpenAI retries without response_format on 400 and skips it for reasoner models', async () => {
  const seenBodies = [];
  const mockFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    seenBodies.push({ url, body });
    if (seenBodies.length === 1) {
      return new Response('{"error":"response_format json_object not supported"}', { status: 400 });
    }
    return Response.json({
      choices: [{ message: { content: '{"ok":true}' } }],
    });
  };

  const out = await organizeByOpenAI({
    prompt: 'hello',
    settings: { aiProvider: 'deepseek', apiKey: 'sk-test', apiBaseUrl: 'https://api.deepseek.com', apiModel: 'deepseek-chat' },
    fetchImpl: mockFetch,
  });
  assert.equal(out, '{"ok":true}');
  assert.equal(seenBodies.length, 2);
  assert.ok(seenBodies[0].body.response_format);
  assert.equal(seenBodies[1].body.response_format, undefined);

  // deepseek-reasoner should omit response_format & temperature on first call
  seenBodies.length = 0;
  await organizeByOpenAI({
    prompt: 'hello',
    settings: { aiProvider: 'deepseek', apiKey: 'sk-test', apiBaseUrl: 'https://api.deepseek.com', apiModel: 'deepseek-reasoner' },
    fetchImpl: async (url, init) => {
      seenBodies.push(JSON.parse(init.body));
      return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
    },
  });
  assert.equal(seenBodies[0].response_format, undefined);
  assert.equal(seenBodies[0].temperature, undefined);
});

test('prepareFunTranscript preserves banter, merges same-minute turns, and drops XML noise', () => {
  const msgs = [
    { _ts: 1700000000, time: '2026-11-27 20:01:05', sender_name: '小王', content: '今晚九点开黑吗' },
    { _ts: 1700000010, time: '2026-11-27 20:01:20', sender_name: '小王', content: '差一个辅助' },
    { _ts: 1700000020, time: '2026-11-27 20:02:01', sender_name: '小李', content: '算我一个！刚吃完饭' },
    { _ts: 1700000025, time: '2026-11-27 20:02:10', sender_name: '小李', content: '<?xml version="1.0"?><msg><appmsg/></msg>' },
    { _ts: 1700000030, time: '2026-11-27 20:02:12', sender_name: '小张', content: '嗯' },
  ];
  const { transcript, messageCount, speakerCount } = prepareFunTranscript(msgs);
  assert.equal(messageCount, 2);
  assert.equal(speakerCount, 2);
  assert.match(transcript, /\[20:01\] 小王：今晚九点开黑吗 \/ 差一个辅助/);
  assert.match(transcript, /\[20:02\] 小李：算我一个！刚吃完饭/);
  assert.doesNotMatch(transcript, /<\?xml/);
});

test('summarizeFunWithModel generates structured natural group summary via DeepSeek', async () => {
  let fetchedUrl = '';
  const mockFetch = async (url, init) => {
    fetchedUrl = url;
    const req = JSON.parse(init.body);
    // DeepSeek 渠道不发 system 消息（system + json_object 会直接返回空 items），
    // system 指令已并进唯一的 user 消息。
    assert.equal(req.messages.length, 1);
    assert.equal(req.messages[0].role, 'user');
    assert.match(req.messages[0].content, /开黑组队群/);
    assert.match(req.messages[0].content, /小王：今晚九点开黑吗/);
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            vibe: '热闹开黑',
            hotspot: '约今晚九点五排开黑缺辅助',
            summary: '群里晚上热闹起来，小王先喊人九点开黑并求一个辅助位，小李刚吃完饭立刻响应上车，大家顺便吐槽了上把翻车的配合。',
            topics: [
              { title: '今晚九点五排组队', detail: '小王发起九点开黑缺辅助，小李已报名，还在等最后一名队友确认。' },
            ],
            highlights: ['小李秒接辅助位，表示刚吃完饭随时上线。'],
            meetups: ['今晚 21:00 五排开黑'],
          }),
        },
      }],
    });
  };

  const result = await summarizeFunWithModel({
    groupName: '开黑组队群',
    messages: [
      { _ts: 1700000000, time: '2026-11-27 20:01:05', sender_name: '小王', content: '今晚九点开黑吗，差一个辅助' },
      { _ts: 1700000020, time: '2026-11-27 20:02:01', sender_name: '小李', content: '算我一个！刚吃完饭随时能上' },
    ],
    settings: { aiProvider: 'deepseek', apiKey: 'sk-test' },
    fetchImpl: mockFetch,
  });

  assert.equal(fetchedUrl, 'https://api.deepseek.com/chat/completions');
  assert.equal(result.vibe, '热闹开黑');
  assert.equal(result.engine, 'DeepSeek');
  assert.equal(result.messageCount, 2);
  assert.equal(result.topics.length, 1);
  assert.deepEqual(result.meetups, ['今晚 21:00 五排开黑']);
  assert.doesNotMatch(result.summary, /这段时间群里主要在聊/);

  // Empty chat returns immediately without calling the network
  let called = false;
  const emptyRes = await summarizeFunWithModel({
    groupName: '潜水群',
    messages: [],
    settings: { aiProvider: 'deepseek', apiKey: 'sk-test' },
    fetchImpl: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(emptyRes.vibe, '静悄悄');
  assert.equal(emptyRes.messageCount, 0);
});

test('wechatDiagnostics reports structured checks without exposing key contents', () => {
  const diag = wechatDiagnostics();
  assert.equal(typeof diag.ready, 'boolean');
  assert.equal(typeof diag.skillDir, 'string');
  assert.equal(typeof diag.checks.pythonVenv, 'boolean');
  assert.equal(typeof diag.checks.keyFile, 'boolean');
  assert.equal(typeof diag.checks.queryScript, 'boolean');
});

test('detectLocalAgents finds agents dynamically on any macOS or Windows machine', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qingsong-agents-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

  // Simulated macOS user ~/Applications
  const macUserApps = path.join(tmp, 'mac-apps');
  fs.mkdirSync(path.join(macUserApps, 'Cursor.app'), { recursive: true });
  fs.mkdirSync(path.join(macUserApps, 'DeepSeek Harness.app'), { recursive: true });
  const macRes = detectLocalAgents({
    platform: 'darwin',
    macAppDirs: [macUserApps],
  });
  const macInstalled = macRes.filter((a) => a.installed).map((a) => a.id).sort();
  assert.deepEqual(macInstalled, ['cursor', 'dsh']);

  // Simulated Windows machine with exe + Start Menu .lnk shortcuts
  const winLocal = path.join(tmp, 'LocalAppData');
  const winStart = path.join(tmp, 'StartMenu');
  fs.mkdirSync(path.join(winLocal, 'Programs', 'WorkBuddy'), { recursive: true });
  fs.writeFileSync(path.join(winLocal, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'), '');
  fs.mkdirSync(path.join(winStart, '字节跳动'), { recursive: true });
  fs.writeFileSync(path.join(winStart, '字节跳动', '豆包.lnk'), '');
  fs.writeFileSync(path.join(winStart, 'DeepSeek Harness.lnk'), '');

  const winRes = detectLocalAgents({
    platform: 'win32',
    env: { LOCALAPPDATA: winLocal },
    winStartMenuDirs: [winStart],
  });
  const winInstalled = winRes.filter((a) => a.installed).map((a) => a.id).sort();
  assert.deepEqual(winInstalled, ['doubao', 'dsh', 'workbuddy']);
});

test('cleanLaunchEnv strips Electron/Node shim variables that break external GUI apps', () => {
  const cleaned = cleanLaunchEnv({
    PATH: '/usr/bin',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
    NODE_OPTIONS: '--require foo.js',
    SERVER__PORT: '61156',
    USER: 'tester',
  });
  assert.equal(cleaned.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(cleaned.ELECTRON_NO_ATTACH_CONSOLE, undefined);
  assert.equal(cleaned.NODE_OPTIONS, undefined);
  assert.equal(cleaned.SERVER__PORT, undefined);
  assert.equal(cleaned.USER, 'tester');

  const spec = resolveCliSpawn('C:\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy', ['--port', '0']);
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, process.platform === 'win32' && !/node(\.exe)?$/i.test(path.basename(spec.command)) ? '1' : undefined);
  if (process.platform === 'win32') {
    assert.ok(spec.args[0].endsWith('codebuddy'));
  }
});
