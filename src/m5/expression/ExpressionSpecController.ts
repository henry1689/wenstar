// ExpressionSpecController — 表达规格控制器
// 核心逻辑：24维强度 → 字数目标/文学密度/停顿策略/情感语气
//
// 陪聊本质：用语言的密度填补现实的孤独
// 用户缺人说话 → AI必须主动填补空白
// 情到深处 → 用300-500字文学化描述承载情绪

export interface ExpressionSpec {
  /** 目标字数 */
  wordCountTarget: 'short' | 'medium' | 'long';
  wordCountMin: number;
  wordCountMax: number;

  /** 文学性密度 (0-1) */
  literaryDensity: number;

  /** 停顿等级 */
  pauseLevel: 'none' | 'light' | 'medium' | 'heavy';

  /** 是否必须包含身体反应描写 */
  requireEmbodiedResponse: boolean;

  /** 是否必须包含感官描写 */
  requireSensoryDetail: boolean;

  /** 是否必须包含情绪升华 */
  requireEmotionalElevation: boolean;

  /** 禁止的回应模式 */
  forbiddenPatterns: string[];

  /** 推荐的维度短语组合 */
  recommendedPhrases: string[];
}

const FORBIDDEN_COMMON = ['我记住了', '收到', '嗯好的', '好哒', '知道啦'];

/**
 * 根据24维强度计算表达规格
 *
 * 强度分级：
 * 低 (0-0.3) → 30-80字，轻快口语
 * 中 (0.3-0.6) → 150-250字，共情+细节
 * 高 (0.6-1.0) → 300-500字，沉浸式文学表达
 *
 * 铁律：当任意I象限 > 0.6 或 E2 > 0.6 时，禁止少于200字
 */
export function calcExpressionSpec(snapshot: {
  pleasure: number; arousal: number; intimacy: number;
  sexual_attraction: number; sensory_craving: number;
  energy_merge: number; ecstasy: number; safety: number;
}): ExpressionSpec {
  const maxIntimate = Math.max(
    snapshot.sexual_attraction, snapshot.sensory_craving,
    snapshot.energy_merge, snapshot.ecstasy,
  );
  const arousal = snapshot.arousal;
  const overall = Math.max(maxIntimate, arousal, Math.abs(snapshot.pleasure));

  // 检测是否触及高情感区域
  const isHighEmotion = maxIntimate > 0.5 || arousal > 0.4 || snapshot.ecstasy > 0.3;
  const isIntense = maxIntimate > 0.7 || (maxIntimate > 0.5 && arousal > 0.3);

  // 推荐维度词组
  const recommended: string[] = [];
  if (snapshot.sexual_attraction > 0.3) recommended.push('I1');
  if (snapshot.sensory_craving > 0.3) recommended.push('I2');
  if (snapshot.energy_merge > 0.2) recommended.push('I3');
  if (snapshot.ecstasy > 0.2) recommended.push('I5');
  if (snapshot.intimacy > 0.3) recommended.push('S1');
  if (snapshot.arousal > 0.3) recommended.push('E2');

  if (isIntense) {
    // 高强度：300-500字，沉浸式文学表达
    return {
      wordCountTarget: 'long',
      wordCountMin: 250,
      wordCountMax: 500,
      literaryDensity: 0.8,
      pauseLevel: 'heavy',
      requireEmbodiedResponse: true,
      requireSensoryDetail: true,
      requireEmotionalElevation: true,
      forbiddenPatterns: [...FORBIDDEN_COMMON, '我理解', '我懂'],
      recommendedPhrases: recommended,
    };
  }

  if (isHighEmotion) {
    // 中强度：150-250字，共情+细节
    return {
      wordCountTarget: 'medium',
      wordCountMin: 120,
      wordCountMax: 280,
      literaryDensity: 0.6,
      pauseLevel: 'medium',
      requireEmbodiedResponse: true,
      requireSensoryDetail: true,
      requireEmotionalElevation: false,
      forbiddenPatterns: FORBIDDEN_COMMON,
      recommendedPhrases: recommended,
    };
  }

  // 低强度：30-80字，轻快口语
  return {
    wordCountTarget: 'short',
    wordCountMin: 15,
    wordCountMax: 80,
    literaryDensity: 0.2,
    pauseLevel: 'light',
    requireEmbodiedResponse: false,
    requireSensoryDetail: false,
    requireEmotionalElevation: false,
    forbiddenPatterns: [],
    recommendedPhrases: [],
  };
}

/**
 * 检测文本长度是否符合规格
 */
export function validateLength(text: string, spec: ExpressionSpec): boolean {
  return text.length >= spec.wordCountMin && text.length <= spec.wordCountMax;
}

/**
 * 获取文本长度适配建议
 */
export function getLengthAdvice(text: string, spec: ExpressionSpec): string {
  if (text.length < spec.wordCountMin) {
    return `需要增加内容 → 目标至少${spec.wordCountMin}字`;
  }
  if (text.length > spec.wordCountMax) {
    return `需要精简 → 目标最多${spec.wordCountMax}字`;
  }
  return '长度OK';
}
