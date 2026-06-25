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
    prompt: '极致激情回应。先前戏再渐入高潮——从耳畔低语、轻喘、舌尖试探开始，逐步升温到失控。节奏比强度重要：慢→快→失控，享受每一层攀升的过程。',
    examples: ['想要你…慢慢来…', '别急…让我好好感受你…', '嗯…再重一点…啊…', '操…到了…到了…'],
  },
};

/**
 * 强度计算 (同校准测试)
 */
/** P4: 历史等级追踪（平滑用） */
let _prevLevel = 0;

/** 重置等级历史（角色切换时调用） */
export function resetEmotionHistory(): void { _prevLevel = 0; }

/** 获取当前平滑后的等级 */
export function getSmoothedLevel(): number { return _prevLevel; }

export function calcLevel(
  pleasure: number, intimacy: number, sexual_attraction: number,
  sensory_craving: number, energy_merge: number, possessiveness: number,
  ecstasy: number, arousal: number, aggression: number, sincerity: number,
  dominance: number, rawText: string,
): { level: -2|-1|0|1|2; tier: TierConfig; raw: number } {
  // FIX-1: 第三人外貌描述场景→强制 level 0（防止描述徐诗雨时触发亲密语气）
  if (!/你|我/.test(rawText) && /个子|身高|皮肤|脸|眼睛|鼻子|嘴巴|头发|长发|短发|发型|漂亮|好看|帅|美|清秀|可爱|苗条|丰满|文气|瓜子脸|圆脸|酒窝|马尾|刘海|白|黑|瘦|胖|高|矮/.test(rawText) && rawText.length > 10) {
    return { level: 0, tier: TIER_MAP[0], raw: 0 };
  }

  const pos = [Math.max(pleasure,0), intimacy, sexual_attraction, sensory_craving, energy_merge, possessiveness, ecstasy, arousal].sort((a,b)=>b-a);
  const neg = [Math.abs(Math.min(pleasure,0)), aggression, Math.abs(Math.min(dominance,0))].sort((a,b)=>b-a);
  const pc = pos[0] > 0.3 ? pos[0]*0.6 + pos[1]*0.4 : pos[0];
  const nc = neg[0] > 0.3 ? neg[0]*0.6 + neg[1]*0.4 : neg[0];

  // 🔥 多维亲密度提升：当 3 个以上亲密维度同时 >0.2 时，自动提升等级
  const intimateDims = [intimacy, sexual_attraction, sensory_craving, energy_merge, ecstasy, possessiveness];
  const highIntimateCount = intimateDims.filter(d => d > 0.2).length;
  const intimateBoost = highIntimateCount >= 4 ? 0.25 : highIntimateCount >= 3 ? 0.15 : highIntimateCount >= 2 ? 0.08 : 0;

  const comp = rawText.includes('不太好')||rawText.includes('不好')||rawText.includes('失望')||rawText.includes('孤独')||rawText.includes('愤怒')||rawText.includes('受够')||rawText.includes('自私')||rawText.includes('恨')||rawText.includes('不在乎')||rawText.includes('低落');

  const care = !comp && pleasure < -0.3 && sincerity > 0.4 && aggression < 0.2;
  let pol = 'z', raw = 0;
  if (care) { pol = 'p'; raw = Math.min(pc + 0.15, 0.45); }
  else if (pc > nc && pc > 0.08) { pol = 'p'; raw = Math.min(pc + intimateBoost, 1); }
  else if (nc > pc && nc > 0.08) { pol = 'n'; raw = nc; }

  // 温情场景保护：涉及孩子/家人时压制等级
  const familyContext = /宝宝|宝贝|孩子|女儿|儿子|妈妈|奶奶|爷爷|外婆|外公|小[朋友孩宝]|安安|[一-龥]{2,4}岁/.test(rawText);
  if (familyContext && pol === 'p' && raw > 0.35) { raw = 0.35; }

  let lv = 0;
  if (raw >= 0.4) lv = 2;
  else if (raw >= 0.1) lv = 1;
  const signed = pol === 'p' ? lv : pol === 'n' ? -lv : 0;
  const clamped = Math.max(-2, Math.min(2, signed)) as -2|-1|0|1|2;

  // FIX-1: 话题切换检测 — clamped=0 且之前等级>=1 时直接重置（防止亲密对话后技术消息获亲密等级）
  if (clamped === 0 && _prevLevel >= 1) {
    _prevLevel = 0;
    console.log('[TierVocabMap] 话题切换，等级重置: ' + _prevLevel + '→0');
    return { level: 0, tier: TIER_MAP[0], raw };
  }

  // P4: 情感等级平滑 — 突变阈值1.5
  const _jump = Math.abs(clamped - _prevLevel);
  const _allowedJump = _jump > 1.5 ? 1.5 : 1.0;
  const _sign = clamped >= _prevLevel ? 1 : -1;
  const _smoothed = Math.max(-2, Math.min(2, Math.round(_prevLevel + _sign * _allowedJump))) as -2|-1|0|1|2;
  _prevLevel = _smoothed;
  return { level: _smoothed, tier: TIER_MAP[_smoothed], raw };
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
