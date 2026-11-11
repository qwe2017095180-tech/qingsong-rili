// 娱乐群：只生成「这段时间群里在聊什么」的概括句，不负责通知卡片整理。
// 从原来的 organize-sync.mjs 里单独保留下来，通知整理已全部交给 WorkBuddy 模型。
const NOISE_RE = [
  /^\s*https?:\/\//,
  /\| 来源：|\| 页面：/,
  /mp\.weixin\.qq\.com\/mp\/waerrpage/,
  /\.(wps|docx?|xlsx?|pptx?|pdf|zip|7z|rar|webp|jpe?g|png|mp4|mov|avi|mkv)\s*$/i,
  /^(@\S+\s*)+$/,
  /拍了拍|的聊天记录|\[链接分享\]/,
  /^<?\?xml|^<msg>|^\[?↩/,
  /^QQNT\s|\.DVR\./i,
  /^[A-Za-z0-9._@-]{6,}$/,
];

function scrubFun(t) {
  let s = String(t || '');
  if (/<\?xml|<msg|<appmsg|aeskey|cdnthumb|clientmsgid|voiceurl/i.test(s)) return '';
  if (/拍了拍|的聊天记录|\[链接分享\]|分享了活动/.test(s)) return '';
  return s
    .replace(/\[↩[\s\S]*?\]\s*/g, '')
    .replace(/\[(引用消息|图片|表情|语音|视频)\]\s*/g, '')
    .replace(/@[^\s，。：:、]{1,24}/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\|[^|]{0,80}$/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FUN_TOPICS = [
  [/宣讲会|推文|招聘部|部长|签到|表格/, '部门工作与宣讲会安排'],
  [/体测|引体|50分|体育课|跑步/, '体测和体育课'],
  [/明日方舟|舟游|剿灭|干员|抽卡|活动商店|卫戍/, '明日方舟版本与活动'],
  [/第五人格|监管者|求生者|赛季|东玄|四抓|ban/i, '第五人格赛事'],
  [/校园网|学生手册|复习|考试|认证|流量/, '校园生活问答'],
  [/食堂|外卖|奶茶|约饭|打球|开黑|游戏/, '约局和日常'],
];

/** 生成概括性小结，不把原文堆到卡片上 */
export function summarizeFun(messages) {
  const lines = (messages || [])
    .map((m) => scrubFun(m.content))
    .filter((t) => t.length >= 6 && !NOISE_RE.some((re) => re.test(t)) &&
      !/^(收到|好的?|哈哈+|嗯+|哦+|ok|111+|[0-9\s.,，。!！?？~～]+)$/i.test(t));
  const uniq = [...new Set(lines.map((t) => t.slice(0, 80)))];
  if (!uniq.length) return { summary: '这段时间群里没有新消息。', highlights: [], hotspot: null, messageCount: 0 };
  const all = uniq.join(' ');
  const topic = (FUN_TOPICS.find(([re]) => re.test(all)) || [null, '日常闲聊'])[1];
  const facts = uniq
    .filter((t) => /[0-9]|时间|前|点|号|日|报名|交|发|做|准备|要不要|能不能|怎么/.test(t))
    .slice(0, 3)
    .map((t) => t.replace(/[。！？!?；;].*$/, '').slice(0, 24));
  const parts = [`这段时间群里主要在聊「${topic}」，共 ${uniq.length} 条有效消息。`];
  if (facts.length) parts.push(`大家提到：${facts.map((x) => `「${x}」`).join('、')}。`);
  parts.push(/报名|截止|交|提交|前发|签到|作业/.test(all)
    ? '里面有带时间或交付要求的事，具体看下面要点。'
    : '基本是闲聊和讨论，没有看到明确要报名或要交的东西。');
  const highlights = uniq.slice(0, 5).map((t) => t.replace(/^(其实|就是|然后|但是|不过|所以|因为)\s*/, '').slice(0, 20));
  return { summary: parts.join(''), highlights, hotspot: topic, messageCount: uniq.length };
}
