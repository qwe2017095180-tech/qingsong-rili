// OpenAI 兼容接口的整理后端：DeepSeek / 通义千问 / Kimi / 智谱 / 豆包 / 硅基流动 / OpenAI / 自定义等都能用。
// Key 只保存在本机 data/settings.json（已 gitignore），不会上传到任何地方。
import { resolveOpenAIConfig } from './providers.mjs';

export function openaiKey(settings = {}) {
  return resolveOpenAIConfig(settings).apiKey;
}

export function openaiBase(settings = {}) {
  return resolveOpenAIConfig(settings).baseUrl;
}

export function openaiModel(settings = {}) {
  return resolveOpenAIConfig(settings).model;
}

export function openaiReady(settings = {}) {
  const cfg = resolveOpenAIConfig(settings);
  if (!cfg.baseUrl || !cfg.model) return false;
  return Boolean(cfg.apiKey) || cfg.isLocal;
}

export async function organizeByOpenAI({
  prompt,
  systemPrompt = '你是「轻松日程」的整理助手，只输出 JSON 对象，不要输出解释。',
  settings = {},
  timeoutMs = 180_000,
  temperature = 0.2,
  maxTokens = 4096,
  fetchImpl = fetch,
} = {}) {
  const cfg = resolveOpenAIConfig(settings);
  const { apiKey: key, baseUrl: base, model, isLocal } = cfg;
  if (!key && !isLocal) throw new Error(`还没有填写 ${cfg.provider.shortName} 的 API Key`);
  if (!base) throw new Error('还没有填写接口 Base URL');
  if (!model) throw new Error('还没有填写模型名称');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const isReasoner = /reasoner|r1\b|^o[134]/i.test(model);
    const body = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
    };
    if (!isReasoner) {
      body.response_format = { type: 'json_object' };
      body.temperature = temperature;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;

    const doRequest = (payload) => fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    let res = await doRequest(body);
    // 部分兼容接口（如个别模型或中转站）不支持 response_format，遇 400 时自动降级重试一次
    if (res.status === 400 && body.response_format) {
      const errText = await res.text().catch(() => '');
      if (/response_format|json_object/i.test(errText)) {
        const retryBody = { ...body };
        delete retryBody.response_format;
        res = await doRequest(retryBody);
      } else {
        throw new Error(`接口参数被拒绝（400）：${errText.slice(0, 160)}`);
      }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new Error(`${cfg.provider.shortName} API Key 无效或已过期`);
      if (res.status === 402) throw new Error(`${cfg.provider.shortName} 账户余额不足，请先充值`);
      if (res.status === 404) throw new Error(`接口地址或模型名不对（${base} / ${model}），请检查配置`);
      if (res.status === 429) throw new Error('请求太频繁或额度用尽，稍后再试');
      throw new Error(`接口返回 ${res.status}：${text.slice(0, 160)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型没有返回内容');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('模型响应超时，请稍后重试');
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(String(e.message))) {
      throw new Error(`连不上 ${base}，请检查网络、代理或 Base URL`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 极短自检：确认 Key 可用、模型能回话 */
export async function checkOpenAI(settings = {}, { fetchImpl = fetch } = {}) {
  const raw = await organizeByOpenAI({
    prompt: '只输出一个 JSON：{"ok":true}',
    settings,
    timeoutMs: 45_000,
    maxTokens: 64,
    fetchImpl,
  });
  return raw.trim().slice(0, 80);
}
