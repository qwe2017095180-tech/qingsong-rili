// AI 整理渠道商注册表（前后端共用唯一数据源）：默认 DeepSeek，支持多家 OpenAI 兼容接口与 WorkBuddy 账号登录。

export const DEFAULT_PROVIDER_ID = 'deepseek';

export const AI_PROVIDERS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    shortName: 'DeepSeek',
    badge: '默认推荐',
    authType: 'apiKey',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    consoleLabel: '前往 DeepSeek 开放平台获取 Key',
    help: '中文理解与总结效果好、成本低，填入 API Key 即可开箱使用。',
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云百炼）',
    shortName: '通义千问',
    badge: '国内直连',
    authType: 'apiKey',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://bailian.console.aliyun.com/',
    consoleLabel: '前往阿里云百炼获取 Key',
    help: '阿里云百炼 OpenAI 兼容模式，国内直连速度快、稳定。',
  },
  {
    id: 'moonshot',
    name: 'Kimi（月之暗面）',
    shortName: 'Kimi',
    badge: '长文本',
    authType: 'apiKey',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2-0711-preview',
    models: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.moonshot.cn/console/api-keys',
    consoleLabel: '前往 Moonshot 开放平台获取 Key',
    help: '擅长超长群聊上下文梳理，适合消息量大的活跃群。',
  },
  {
    id: 'zhipu',
    name: '智谱清言（GLM）',
    shortName: '智谱 GLM',
    badge: '高性价比',
    authType: 'apiKey',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
    keyPlaceholder: '输入智谱 API Key',
    consoleUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    consoleLabel: '前往智谱开放平台获取 Key',
    help: 'glm-4-flash 成本极低，适合日常高频整理。',
  },
  {
    id: 'doubao',
    name: '豆包（火山方舟）',
    shortName: '豆包',
    badge: '',
    authType: 'apiKey',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1-5-pro-32k-250115',
    models: ['doubao-1-5-pro-32k-250115', 'doubao-1-5-lite-32k-250115'],
    keyPlaceholder: '输入火山方舟 API Key',
    consoleUrl: 'https://console.volcengine.com/ark',
    consoleLabel: '前往火山方舟控制台获取 Key',
    help: '支持标准模型名，也支持填入自己创建的推理接入点 ID（ep-...）。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动（SiliconFlow）',
    shortName: '硅基流动',
    badge: '模型聚合',
    authType: 'apiKey',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct', 'THUDM/glm-4-9b-chat'],
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://cloud.siliconflow.cn/account/ak',
    consoleLabel: '前往硅基流动获取 Key',
    help: '一个 Key 可调用 DeepSeek、Qwen、GLM 等多种开源模型。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    badge: '',
    authType: 'apiKey',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
    keyPlaceholder: 'sk-...',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: '前往 OpenAI 获取 Key',
    help: 'OpenAI 官方接口（需要可访问国际网络的环境）。',
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容接口',
    shortName: '自定义接口',
    badge: '本地/中转',
    authType: 'apiKey',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyPlaceholder: 'API Key（本地 Ollama 可留空）',
    consoleUrl: '',
    consoleLabel: '',
    help: '支持任意 OpenAI 兼容中转站、OneAPI、NewAPI 或本地 Ollama（如 http://127.0.0.1:11434/v1）。',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy 账号登录',
    shortName: 'WorkBuddy 账号',
    badge: '免填 Key',
    authType: 'account',
    baseUrl: '',
    defaultModel: '',
    models: [],
    keyPlaceholder: '',
    consoleUrl: '',
    consoleLabel: '',
    help: '通过本机 WorkBuddy 命令行完成一次账号授权（/login）后直接整理，无需配置 API Key。',
  },
];

const PROVIDER_MAP = new Map(AI_PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id) {
  return PROVIDER_MAP.get(String(id || '').toLowerCase()) || PROVIDER_MAP.get(DEFAULT_PROVIDER_ID);
}

export function isValidProviderId(id) {
  return PROVIDER_MAP.has(String(id || '').toLowerCase());
}

/** 根据 baseUrl 推断最接近的渠道商（兼容老版本只有 apiBaseUrl 的配置） */
export function inferProviderFromBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim().toLowerCase();
  if (!raw) return DEFAULT_PROVIDER_ID;
  for (const p of AI_PROVIDERS) {
    if (p.baseUrl && raw.startsWith(p.baseUrl.toLowerCase().replace(/\/+$/, ''))) {
      return p.id;
    }
  }
  if (raw.includes('deepseek')) return 'deepseek';
  if (raw.includes('dashscope') || raw.includes('aliyuncs')) return 'qwen';
  if (raw.includes('moonshot')) return 'moonshot';
  if (raw.includes('bigmodel')) return 'zhipu';
  if (raw.includes('volces')) return 'doubao';
  if (raw.includes('siliconflow')) return 'siliconflow';
  if (raw.includes('api.openai.com')) return 'openai';
  return 'custom';
}

/** 判断用户当前选择的渠道商 ID */
export function activeProviderId(settings = {}) {
  const explicit = String(settings.aiProvider || '').trim().toLowerCase();
  if (isValidProviderId(explicit)) return explicit;

  const backend = String(settings.organizeBackend || '').trim().toLowerCase();
  if (backend === 'workbuddy') return 'workbuddy';
  if (isValidProviderId(backend)) return backend;
  if (backend === 'openai') return inferProviderFromBaseUrl(settings.apiBaseUrl || settings.deepseekBaseUrl);
  return DEFAULT_PROVIDER_ID;
}

/** 是否指向本机接口（如 Ollama / LM Studio，允许不填 API Key） */
export function isLocalBaseUrl(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(\/|$)/i.test(String(url || '').trim());
}

/** 解析当前生效的 OpenAI 兼容连接参数 */
export function resolveOpenAIConfig(settings = {}) {
  const providerId = activeProviderId(settings);
  const provider = getProvider(providerId);
  const savedProfile = (settings.providerProfiles && typeof settings.providerProfiles === 'object'
    ? settings.providerProfiles[provider.id]
    : null) || {};

  const envKey = provider.id === 'deepseek'
    ? (process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '')
    : (process.env.OPENAI_API_KEY || '');

  const key = String(
    savedProfile.apiKey || settings.apiKey || settings.deepseekApiKey || envKey || ''
  ).trim();

  const base = String(
    savedProfile.baseUrl || settings.apiBaseUrl || settings.deepseekBaseUrl || provider.baseUrl || 'https://api.deepseek.com'
  ).trim().replace(/\/+$/, '');

  const model = String(
    savedProfile.model || settings.apiModel || settings.deepseekModel || provider.defaultModel || 'deepseek-chat'
  ).trim();

  return {
    providerId: provider.id,
    provider,
    apiKey: key,
    baseUrl: base,
    model,
    isLocal: isLocalBaseUrl(base),
  };
}
