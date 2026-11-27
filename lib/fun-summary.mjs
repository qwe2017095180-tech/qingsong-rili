// 娱乐群总结：优先调用当前配置的 AI 模型生成自然流畅的「省流版群聊总结」，
// 把零散聊天梳理成氛围标签、核心概述、话题分块、看点提炼与约局提醒。
import { completeJsonWithModel, parseJsonObject } from './workbuddy-model.mjs';
import { activeProviderId, getProvider } from './providers.mjs';

const FUN_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    vibe: { type: 'string' },
    hotspot: { type: ['string', 'null'] },
    summary: { type: 'string' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['title', 'detail'],
      },
    },
    highlights: {
      type: 'array',
      items: { type: 'string' },
    },
    meetups: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['vibe', 'hotspot', 'summary', 'topics', 'highlights', 'meetups'],
});

const NOISE_RE = [
  /^\s*https?:\/\/\S+\s*$/,
  /mp\.weixin\.qq\.com\/mp\/waerrpage/,
  /\.(wps|docx?|xlsx?|pptx?|pdf|zip|7z|rar|webp|jpe?g|png|mp4|mov|avi|mkv)\s*$/i,
  /^(@\S+\s*)+$/,
  /^<\?xml|^<msg>|<appmsg|aeskey|cdnthumb|clientmsgid|voiceurl/i,
  /^QQNT\s|\.DVR\./i,
  /^[A-Za-z0-9._@-]{16,}$/,
  /^\[(图片|表情|动画表情|语音|视频|文件|链接分享|位置)\]\s*$/,
];

function cleanFunText(raw) {
  let s = String(raw || '');
  if (/<\?xml|<msg|<appmsg|aeskey|cdnthumb|clientmsgid|voiceurl/i.test(s)) return '';
  if (/拍了拍|的聊天记录|撤回了一条消息/.test(s)) return '';
  s = s
    .replace(/\[↩[\s\S]*?\]\s*/g, '[引用] ')
    .replace(/https?:\/\/\S+/g, '[链接]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s || NOISE_RE.some((re) => re.test(s))) return '';
  // 纯符号/纯单个敷衍词跳过，但保留有上下文意义的短句（如「算我一个」「几点开黑」）
  if (/^[\s.,，。!！?？~～…·\-_=+]+$/.test(s)) return '';
  if (/^(嗯+|哦+|啊+|好|行|1+|ok)$/i.test(s)) return '';
  return s.slice(0, 260);
}

function formatShortTime(m) {
  if (typeof m?.time === 'string') {
    const match = /(\d{2}:\d{2})/.exec(m.time);
    if (match) return match[1];
  }
  if (typeof m?._ts === 'number' && m._ts > 0) {
    const d = new Date(m._ts * 1000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return '';
}

function resolveSpeaker(m) {
  if (m?.is_self) return '我';
  const name = String(m?.sender_name || m?.sender || m?.nick || '').trim();
  if (!name || /^wxid_/i.test(name)) return '';
  return name.slice(0, 14);
}

/**
 * 把娱乐群原始消息整理成适合大模型阅读的对话文本：
 * 保留真实语境、发言人与时间顺序，合并同一人连续刷屏，优先保留较新对话。
 */
export function prepareFunTranscript(messages, { maxChars = 16000 } = {}) {
  const entries = [];
  const speakers = new Set();
  let lastKey = '';

  for (const m of messages || []) {
    if (!m || m.is_system) continue;
    const text = cleanFunText(m.content);
    if (!text) continue;
    const time = formatShortTime(m);
    const speaker = resolveSpeaker(m);
    if (speaker) speakers.add(speaker);

    // 去重完全相同的连续刷屏
    const dedupKey = `${speaker}|${text}`;
    if (dedupKey === lastKey) continue;
    lastKey = dedupKey;

    const prev = entries[entries.length - 1];
    if (prev && speaker && prev.speaker === speaker && prev.time === time && prev.text.length + text.length < 320) {
      prev.text += ` / ${text}`;
    } else {
      entries.push({ time, speaker, text });
    }
  }

  const lines = entries.map((e) => {
    const prefix = [e.time ? `[${e.time}]` : '', e.speaker ? `${e.speaker}：` : ''].filter(Boolean).join(' ');
    return prefix ? `${prefix}${e.text}` : e.text;
  });

  // 超长时保留最新一段，保证重点聊到的近期内容不丢失
  let transcript = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] + '\n';
    if (transcript.length + line.length > maxChars && transcript.length > 0) break;
    transcript = line + transcript;
  }

  return {
    transcript: transcript.trim(),
    messageCount: entries.length,
    speakerCount: speakers.size,
  };
}

function buildFunPrompt({ groupName, transcript, messageCount, hours, now }) {
  return [
    `你在替本机应用「轻松日程」给微信群「${groupName}」写一份「省流版群聊总结」，让没来得及爬楼的群友 10 秒看懂群里刚聊了什么。`,
    `现在是 ${now.toLocaleString('zh-CN')}，下面记录了最近 ${hours} 小时内的 ${messageCount} 条对话。`,
    '',
    '请只输出一个合法 JSON 对象，不要输出任何额外解释或 markdown 代码块，字段如下：',
    '{',
    '  "vibe": "2-6字群聊氛围标签，如 热闹开黑 / 吐槽吃瓜 / 约饭策划 / 日常闲聊 / 攻略交流",',
    '  "hotspot": "18字以内最热话题（说具体聊的事，不要泛泛写「日常闲聊」）",',
    '  "summary": "80-180字自然流畅的群聊总述，像真人群友给你复盘：讲清大家围绕哪几个话题聊起来、各自态度或笑点是什么、有没有结论或悬念。",',
    '  "topics": [',
    '    { "title": "12字以内话题小标题", "detail": "30-90字把这一段聊的来龙去脉和观点说清楚" }',
    '  ],',
    '  "highlights": ["2-4条完整成句的精彩看点、热梗或关键结论，每条36字以内"],',
    '  "meetups": ["如果群里明确提到约饭/开黑/看电影/出游/活动时间地点，拎出来写清时间与内容；没有就输出空数组 []"]',
    '}',
    '',
    '写作硬要求：',
    '1. 严禁使用「这段时间群里主要在聊…共 X 条有效消息」「大家提到：「…」」「基本是闲聊和讨论」这类机械模板句。',
    '2. 必须真正理解上下文并归纳转述，不要生硬复制或截断零碎原话。',
    '3. 语气轻松自然、像朋友口头转述，但严格忠于聊天记录，绝不编造没提到的人名、时间或事件。',
    '4. 如果群里只聊了一两件小事，如实精简概括即可，topics 输出 1-2 条就行，不必硬凑。',
    '',
    '群聊记录：',
    transcript,
  ].join('\n');
}

export function normalizeFunSummary(raw, { messageCount = 0, engine = '' } = {}) {
  const vibe = String(raw?.vibe || '').trim().slice(0, 10) || '日常闲聊';
  const hotspot = raw?.hotspot ? String(raw.hotspot).trim().slice(0, 28) : null;
  const summary = String(raw?.summary || '').trim().slice(0, 360);
  const topics = Array.isArray(raw?.topics)
    ? raw.topics
        .filter((t) => t && typeof t === 'object' && String(t.title || '').trim())
        .slice(0, 4)
        .map((t) => ({
          title: String(t.title).trim().slice(0, 20),
          detail: String(t.detail || '').trim().slice(0, 180),
        }))
    : [];
  const highlights = Array.isArray(raw?.highlights)
    ? raw.highlights.map((x) => String(x || '').trim().slice(0, 60)).filter(Boolean).slice(0, 4)
    : [];
  const meetups = Array.isArray(raw?.meetups)
    ? raw.meetups.map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 3)
    : [];

  return {
    vibe,
    hotspot,
    summary: summary || (topics[0]?.detail || '这段时间群里有些零星闲聊，暂无明显主线话题。'),
    topics,
    highlights,
    meetups,
    messageCount,
    curated: true,
    engine,
  };
}

/**
 * 调用当前配置的 AI 模型生成自然流畅的群聊总结。
 */
export async function summarizeFunWithModel({
  groupName = '群聊',
  messages = [],
  hours = 24,
  now = new Date(),
  settings = {},
  fetchImpl = fetch,
} = {}) {
  const { transcript, messageCount } = prepareFunTranscript(messages);
  if (!messageCount) {
    return {
      vibe: '静悄悄',
      hotspot: null,
      summary: '这段时间群里安安静静的，没有新消息。',
      topics: [],
      highlights: [],
      meetups: [],
      messageCount: 0,
      curated: true,
      engine: 'none',
    };
  }

  const prompt = buildFunPrompt({ groupName, transcript, messageCount, hours, now });
  const rawText = await completeJsonWithModel({
    prompt,
    systemPrompt: '你是「轻松日程」的群聊总结助手，擅长把杂乱微信群聊梳理成自然、风趣、忠于原意的中文省流总结。只输出合法 JSON 对象。',
    jsonSchema: FUN_SCHEMA,
    settings,
    temperature: 0.45,
    maxTokens: 2048,
    fetchImpl,
  });
  const parsed = parseJsonObject(rawText);
  const provider = getProvider(activeProviderId(settings));
  return normalizeFunSummary(parsed, { messageCount, engine: provider.shortName });
}

/** 无模型时的极简兜底（仅供离线单测或旧脚本兼容） */
export function summarizeFun(messages) {
  const { transcript, messageCount } = prepareFunTranscript(messages, { maxChars: 2000 });
  if (!messageCount) {
    return {
      vibe: '静悄悄',
      summary: '这段时间群里安安静静的，没有新消息。',
      topics: [],
      highlights: [],
      meetups: [],
      hotspot: null,
      messageCount: 0,
    };
  }
  const lines = transcript.split('\n').map((l) => l.replace(/^\[\d{2}:\d{2}\]\s*/, '').trim()).filter(Boolean);
  return {
    vibe: '待 AI 总结',
    summary: `共收到 ${messageCount} 条群聊消息，配置 AI 整理渠道后即可生成完整群聊总结。`,
    topics: [],
    highlights: lines.slice(-3).map((l) => l.slice(0, 40)),
    meetups: [],
    hotspot: null,
    messageCount,
  };
}
