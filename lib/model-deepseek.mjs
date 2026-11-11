// DeepSeek（OpenAI 兼容）整理后端。
// 给没有 WorkBuddy 的 Windows 机器用：在设置里填 API Key，点整理就当场调模型。
// 不读取 ~/.dsh、不调用 codex，和 macOS 上的 WorkBuddy 通道互不影响。
const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';

export function deepseekKey(settings = {}) {
  return String(settings.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '').trim();
}

export async function organizeByDeepseek({ prompt, settings = {}, timeoutMs = 180_000 } = {}) {
  const key = deepseekKey(settings);
  if (!key) throw new Error('没有配置 DeepSeek API Key');
  const base = String(settings.deepseekBaseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');
  const model = String(settings.deepseekModel || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL);

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
      if (res.status === 401) throw new Error('DeepSeek API Key 无效或已过期');
      if (res.status === 402) throw new Error('DeepSeek 账户余额不足');
      throw new Error(`DeepSeek 接口返回 ${res.status}：${text.slice(0, 160)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek 没有返回内容');
    return content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('DeepSeek 响应超时');
    if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(String(e.message))) {
      throw new Error('连不上 DeepSeek 接口，请检查网络或代理');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** 极短自检：确认 Key 可用、模型能回话 */
export async function checkDeepseek(settings = {}) {
  const raw = await organizeByDeepseek({
    prompt: '只输出一个 JSON：{"ok":true}',
    settings,
    timeoutMs: 45_000,
  });
  return raw.trim().slice(0, 80);
}
