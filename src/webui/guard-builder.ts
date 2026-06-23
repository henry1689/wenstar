/**
 * guard-builder.ts — 对话 Guard 消息构建模块
 *
 * SP3-2: 从 chat.ts 拆出的独立 Guard 逻辑。
 * 职责：构建所有防护消息（幻觉/重复/感受/日常/时间等）
 */
import type { M4Context } from '../m4/types/index.js';
import type { Perception24D } from '../m3/types/perception.js';
import type { ConversationTurn } from '../m5/types/index.js';
import type { MemoryGateOutput } from '../app/conversation/MemoryGate.js';

/** Guard 构建器输入 */
export interface GuardBuilderInput {
  message: string;
  perception: Perception24D;
  decision: { primary_emotion?: string; secondary_emotions?: string[] };
  ctx_m4: M4Context;
  conversationHistory: ConversationTurn[];
  hallucinationGuard: string;
  memoryGate: MemoryGateOutput;
  rpMatch: RegExpMatchArray | null;
  hasIntroMatch: boolean;
  introMatchName: string;
}

/** Guard 构建器输出 */
export interface GuardBuilderOutput {
  allGuardMsgs: string;
  familyConstraint: string;
  intimacyFilter: string;
  feelingGuard: string;
  dailyGuard: string;
  timeGuard: string;
  classificationGuard: string;
  hallucinationGuard: string;
  repeatHint: string;
}

/** 话题重复计数（模块级，跟踪同一话题追问次数） */
const topicAskCount = new Map<string, number>();

export function getTopicRepeatCount(message: string): number {
  const words = message.match(/[一-龥]{4,}/g);
  if (!words) return 0;
  for (const w of words) {
    const cnt = (topicAskCount.get(w) ?? 0) + 1;
    topicAskCount.set(w, cnt);
    return cnt;
  }
  return 0;
}

/**
 * 构建所有 Guard 消息
 */
export async function buildGuards(input: GuardBuilderInput): Promise<GuardBuilderOutput> {
  const { message, perception: p, decision, ctx_m4, conversationHistory, rpMatch } = input;
  let { hallucinationGuard } = input;

  // 话题追问检测
  const repeatCount = getTopicRepeatCount(message);
  let repeatHint = '';
  if (repeatCount >= 3) {
    repeatHint = '（鸿艺反复追问，你直接明确说没有/不知道/不记得就好）';
  } else if (repeatCount >= 2) {
    repeatHint = '（鸿艺在追问相同的事，你如果已经说过了不知道，就直接说真的不记得/没看过）';
  }

  // 感受分享检测
  let feelingGuard = '';
  if (/感觉|感受|分享|讲讲|说说|回忆|记得.*吗|怎样/.test(message) && !rpMatch) {
    feelingGuard = '📖【鸿艺在问你感受。请用300-500字充分展开，详细描述身体感觉和心情。不要简短回答。】';
  }

  // 工作模式亲密度过滤
  let intimacyFilter = '';
  if (/工作|项目|客户|会议|方案|报告|公司|合同|预算|数据|分析|策略|设计|电机|采购|成本|温升|版本|产品|技术|报价|订单|生产|测试|样品|图纸|规格|性能|参数|方案|工程|研发|工艺|质量|供应商/.test(message)) {
    const recentUser = conversationHistory.filter(t => t.role === 'user').slice(-3).map(t => t.content).join('');
    const isWorkContext = /工作|项目|客户|会议|方案|报告|公司/.test(recentUser + message);
    if (isWorkContext) {
      intimacyFilter = '【⚠️ 工作模式激活】当前是工作/事务对话。🚫 禁止使用任何亲密/伴侣/挑逗语气。✅ 使用专业、清晰的秘书语气回复。';
    }
  }

  // 日常问询幻觉防护
  let dailyGuard = '';
  if (/在忙啥|在干嘛|最近.*忙|在做什么|忙什么/.test(message) && !feelingGuard) {
    const recentUser = conversationHistory.filter(t => t.role === 'user').slice(-3).map(t => t.content).join('');
    const hasUserWork = /做.*方案|做.*项目|做.*产品|开发|设计|客户|开会|公司|工作/.test(recentUser);
    dailyGuard = hasUserWork
      ? '⚠️【身份边界险】鸿艺跟你说过他的工作内容，那些是他的事不是你的事。你不知道自己在忙什么。不要说"我在做..."。温柔回应"想你了"或"没什么特别的"。'
      : '⚠️ 你不知道自己具体在忙什么。不要编造具体的项目、客户、工作内容。可以温柔地说"想你了""没什么特别的"之类的。';
  }

  // 时间注入
  const now = new Date();
  const beijingTime = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const lunarMap: Record<number, string> = {
    119:'腊月廿一',128:'正月初一',129:'正月初二',217:'腊月三十',218:'正月初一',
    312:'正月廿四',405:'二月十八',502:'三月十五',605:'四月十九',619:'五月初五',
    702:'五月十七',801:'六月十七',905:'七月廿四',927:'八月十六',1003:'八月廿二',
    1101:'九月廿二',1201:'十月廿二',
  };
  const _md = (now.getMonth()+1)*100+now.getDate();
  const lunarDate = lunarMap[_md] || '';
  const timeGuard = `[当前时间] ${beijingTime}（北京时间）${lunarDate ? ' 农历' + lunarDate : ''}`;

  // 家族/社交关系铁律
  let familyConstraint = '';
  try {
    const personEntities = ctx_m4.family_context || ctx_m4.social_context || [];
    if (personEntities && personEntities.length > 0) {
      const knownList = personEntities.map((p: any) => {
        let text = '  - ' + p.entity + '（' + p.relation + '）';
        if (p.appearance) text += '\n      外貌：' + String(p.appearance).substring(0, 150);
        if (p.body_features) text += '\n      身体特征：' + String(p.body_features).substring(0, 150);
        if (p.description) text += '\n      其他信息：' + String(p.description).substring(0, 200);
        if (p.traits?.length) text += '\n      性格：' + p.traits.join('、');
        if (p.occupation) text += '\n      职业：' + p.occupation;
        return text;
      }).join('\n');
      familyConstraint = '【📋 人物档案 — 以鸿艺告诉你的为准】\n' + knownList + '\n\n⚠️ 规则：\n1. 上面写了的信息你可以用来回答。\n2. 没写的信息你不知道——直接说不知道/没说过。\n3. 🔴 绝对禁止编造任何你记忆中不存在的内容。';
    } else {
      familyConstraint = '【家庭/社交铁律】你不知道鸿艺有哪些家人和社交关系。如果鸿艺提到任何人，你不知道他们是谁，直接说"这个人我没听你提过呢"。';
    }
  } catch (err) { familyConstraint = ''; }

  // 知识分类反问
  let classificationGuard = '';
  try {
    const isIntimate = p && (p.intimacy > 0.3 || p.sexual_attraction > 0.2 || p.sensory_craving > 0.3);
    const isDistressed = p && p.pleasure < -0.2;
    const isCasual = !isIntimate && !isDistressed;
    if (isCasual) {
      const oneDayMs = 86400000;
      classificationGuard = ''; // 简版 — 保留扩展点
    }
  } catch (err) { classificationGuard = ''; }

  const allGuardMsgs = [hallucinationGuard, repeatHint, feelingGuard, dailyGuard, timeGuard, classificationGuard, intimacyFilter].filter(Boolean).join('\n');

  return {
    allGuardMsgs,
    familyConstraint,
    intimacyFilter,
    feelingGuard,
    dailyGuard,
    timeGuard,
    classificationGuard,
    hallucinationGuard,
    repeatHint,
  };
}
