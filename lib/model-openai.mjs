// OpenAI 兼容接口的整理后端：DeepSeek / OpenAI / Moonshot / 硅基流动 / OpenRouter 等都能用。
// 用户只需要在设置里填 Base URL、API Key、模型名，整理就走这个接口。
// Key 只保存在本机 data/settings.json（已 gitignore），不会上传到任何地方。
const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

export function openaiKey(settings = {}) {
  return String(
    settings.apiKey || settings.deepseekApiKey || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
  ).trim();
}

export function openaiBase(settings = {}) {
  const raw = String(
    settings.apiBaseUrl || settings.deepseekBaseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE
  ).trim();
  return raw.replace(/\/+$/, '');
}

export function openaiModel(settings = {}) {
  return String(
    settings.apiModel || settings.deepseekModel || process.env.OPENAI_MODEL || DEFAULT_MODEL
  ).trim();
}

export async function organizeByOpenAI({ prompt, settings = {}, timeoutMs = 180_000 } = {}) {
  const key = openaiKey(settings);
  if (!key) throw new Error('还没有填写 API Key');
  const base = openaiBase(settings);
  const model = openaiModel(settings);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是「轻松日程」的整理助手，只输出 JSON 对象，不要输出解释。' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 4096,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401) throw new Error('API Key 无效或已过期');
      if (res.status === 402) throw new Error('账户余额不足');
      if (res.status === 404) throw new Error(`接口地址不对（${base}），检查 Base URL 是否填到 /v1`);
      if (res.status === 429) throw new Error('请求太频繁或额度用尽，稍后再试');
      throw new Error(`接口返回 ${res.status}：${text.slice(0, 160)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('模型没有返回内容');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('模型响应超时');
    if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(String(e.message))) {
      throw new Error(`连不上 ${base}，请检查网络、代理或 Base URL`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 极短自检：确认 Key 可用、模型能回话 */
export async function checkOpenAI(settings = {}) {
  const raw = await organizeByOpenAI({
    prompt: '只输出一个 JSON：{"ok":true}',
    settings,
    timeoutMs: 45_000,
  });
  return raw.trim().slice(0, 80);
}
