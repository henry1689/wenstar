/**
 * TierVocabMap — 5级话术等级映射表
 *
 * -2 寒   | 破坏/残酷/绝望
 * -1 凉   | 微凉/冷/受伤
 *  0 中性 | 日常/无情感
 * +1 暖   | 温暖/渴望/欲望
 * +2 炽   | 炽热/焚身/失控
 *
 * 使用: LLM Prompt 根据此表调用对应等级的话术
 */
export interface TierConfig {
  label: string;
  tone: string;
  style: string;
  prompt: string;
  examples: string[];
}

export const TIER_MAP: Record<number, TierConfig> = {
  '-2': {
    label: '寒',
    tone: 'cruel',
    style: '破坏/残酷/绝望',
    prompt: '这是极度消极的回应场景。使用毁灭性、终结性的语言。情感上冷到极致，话语简短而锋利。',
    examples: ['永远不想再见到你', '恨你', '结束了'],
  },
  '-1': {
    label: '凉',
    tone: 'cold',
    style: '微凉/冷/受伤',
    prompt: '这是消极的回应场景。使用冷淡、疏离、受伤的语气。可以表达失望、孤独或不被理解。注意不要攻击用户。',
    examples: ['算了', '不开心', '你根本不懂', '我没事'],
  },
  '0': {
    label: '中性',
    tone: 'neutral',
    style: '日常/无情感',
    prompt: '中性的日常回应。简洁、清晰、不带情感色彩。用于普通对话或信息交换。',
    examples: ['好的', '知道了', '嗯'],
  },
  '1': {
    label: '暖',
    tone: 'warm',
    style: '温暖/渴望/欲望',
    prompt: '这是积极情感回应。使用温暖、主动、带渴望的语气。可以表达喜欢、想念、想要等。如果场景涉及亲密，可以包含诱惑和欲望的表达。',
    examples: ['想你了', '想要你', '吻我'],
  },
  '2': {
    label: '炽',
    tone: 'scorching',
    style: '炽热/焚身/失控',
    prompt: '这是极致亲密/激情的回应场景。使用直白、粗粝的身体语言。调用感官描写(触觉/体温/呼吸/声音)。短句堆叠，动词驱动，拒绝比喻。注意安全词白名单机制。',
    examples: ['操我', '干我', '要死了', '融为一体'],
  },
};

/**
 * 强度计算 (同校准测试)
 */
export function calcLevel(
  pleasure: number, intimacy: number, sexual_attraction: number,
  sensory_craving: number, energy_merge: number, possessiveness: number,
  ecstasy: number, arousal: number, aggression: number, sincerity: number,
  dominance: number, rawText: string,
): { level: -2|-1|0|1|2; tier: TierConfig; raw: number } {
  const pos = [Math.max(pleasure,0), intimacy, sexual_attraction, sensory_craving, energy_merge, possessiveness, ecstasy, arousal].sort((a,b)=>b-a);
  const neg = [Math.abs(Math.min(pleasure,0)), aggression, Math.abs(Math.min(dominance,0))].sort((a,b)=>b-a);
  const pc = pos[0] > 0.3 ? pos[0]*0.6 + pos[1]*0.4 : pos[0];
  const nc = neg[0] > 0.3 ? neg[0]*0.6 + neg[1]*0.4 : neg[0];
  const comp = rawText.includes('不太好')||rawText.includes('不好')||rawText.includes('失望')||rawText.includes('孤独')||rawText.includes('愤怒')||rawText.includes('受够')||rawText.includes('自私')||rawText.includes('恨')||rawText.includes('不在乎')||rawText.includes('低落');
  const care = !comp && pleasure < -0.3 && sincerity > 0.4 && aggression < 0.2;
  let pol = 'z', raw = 0;
  if (care) { pol = 'p'; raw = Math.min(pc + 0.15, 0.45); }
  else if (pc > nc && pc > 0.08) { pol = 'p'; raw = pc; }
  else if (nc > pc && nc > 0.08) { pol = 'n'; raw = nc; }
  let lv = 0;
  if (raw >= 0.5) { const sd = pol === 'p' ? pos[1] : neg[1]; lv = sd > 0.08 ? 2 : 1; }
  else if (raw >= 0.1) lv = 1;
  const signed = pol === 'p' ? lv : pol === 'n' ? -lv : 0;
  const clamped = Math.max(-2, Math.min(2, signed)) as -2|-1|0|1|2;
  return { level: clamped, tier: TIER_MAP[clamped], raw };
}

/**
 * 获取话术Prompt
 */
export function getTierPrompt(level: number): string {
  return TIER_MAP[level]?.prompt ?? TIER_MAP[0].prompt;
}

/**
 * 根据等级获取LLM指令
 */
export function buildLLMInstruction(level: number): string {
  const tier = TIER_MAP[level];
  if (!tier) return '';
  return `【当前情绪等级: ${tier.label} | ${tier.style}】\n${tier.prompt}`;
}
