// M6 TraitEvolver — 特质偏移计算引擎
// Ref: docs/M6-design-v1.md §3.1

import type { SelfModelTraits, EvolutionSignal, EvolutionDecision } from './types/index.js';
import { DEFAULT_TRAITS } from './types/index.js';
import { SelfModelManager } from './SelfModelManager.js';

/** 大五人格合法键白名单 */
const VALID_TRAIT_KEYS = new Set(['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism']);

/** 大五人格到实体的映射关系（用于从实体名推断受影响特质） */
const ENTITY_TRAIT_MAP: Record<string, keyof typeof DEFAULT_TRAITS> = {
  '累': 'neuroticism', '压力': 'neuroticism', '失眠': 'neuroticism',
  '开心': 'extraversion', '快乐': 'extraversion', '兴奋': 'extraversion',
  '焦虑': 'neuroticism', '抑郁': 'neuroticism',
  '温柔': 'agreeableness', '共情': 'agreeableness', '亲密': 'agreeableness',
  '好奇': 'openness', '探索': 'openness', '兴趣': 'openness',
  '责任': 'conscientiousness', '工作': 'conscientiousness', '认真': 'conscientiousness',
};

/** 安全 clamp：NaN/undefined 防护 */
function safeClamp(v: number): number {
  if (typeof v !== 'number' || isNaN(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

export class TraitEvolver {
  private manager: SelfModelManager;
  private feedbackBuffer: EvolutionSignal[] = [];

  constructor(manager: SelfModelManager) {
    this.manager = manager;
  }

  /** 添加反馈信号 */
  addFeedback(signal: EvolutionSignal): void {
    this.feedbackBuffer.push(signal);
  }

  /** 获取同类反馈计数 */
  private countSimilar(dimension: string): number {
    return this.feedbackBuffer.filter(f => f.dimension === dimension).length;
  }

  /** 计算当前强度（最近反馈的 E1 均值） */
  private avgE1(dimension: string): number {
    const signals = this.feedbackBuffer.filter(f => f.dimension === dimension);
    if (signals.length === 0) return 0;
    return signals.reduce((s, f) => s + f.e1_pleasure, 0) / signals.length;
  }

  /** 将实体名/触发词映射到大五人格维度 */
  mapToTrait(dimension: string): string | null {
    if (VALID_TRAIT_KEYS.has(dimension)) return dimension;
    if (ENTITY_TRAIT_MAP[dimension]) return ENTITY_TRAIT_MAP[dimension];
    return null;
  }

  /** 提议演化，返回决策 */
  proposeEvolution(dimension: string, direction: 'increase' | 'decrease', delta: number): EvolutionDecision {
    // 白名单校验：非大五人格维度跳过（如实体名"巧克力""咖啡"→交给 PreferenceManager）
    const mappedDim = this.mapToTrait(dimension);
    if (!mappedDim) {
      return { applied: false, level: 'auto', reason: `"${dimension}"不是大五人格维度, 已路由至PreferenceManager处理` };
    }

    // 底线锁定
    if (!this.manager.checkCoreIdentity(mappedDim, direction)) {
      return { applied: false, level: 'blocked', reason: 'CORE_IDENTITY_ANCHOR：核心身份不可修改' };
    }

    const count = this.countSimilar(mappedDim);
    const avgE1 = this.avgE1(mappedDim);

    // 小幅自动 (≤5%)
    if (delta <= 5) {
      if (count >= 5 && avgE1 > 0.4) {
        const traits = this.manager.getTraits();
        const key = mappedDim as keyof SelfModelTraits;
        const oldVal = traits[key];
        const step = direction === 'increase' ? delta / 100 : -delta / 100;
        const newVal = safeClamp((oldVal ?? 0.5) + step);
        if (!isNaN(newVal)) {
          traits[key] = newVal;
          this.manager.updateTraits(traits);
          return { applied: true, level: 'auto', reason: `小幅自动微调 ${mappedDim} ${direction} ${delta}%`, oldValue: oldVal, newValue: newVal };
        }
        return { applied: false, level: 'auto', reason: `数值异常: ${mappedDim} ${oldVal}+${step}=${newVal}` };
      }
      return { applied: false, level: 'auto', reason: `信号不足: need≥5, have=${count}` };
    }

    // 中幅软化 (5-15%)
    if (delta <= 15) {
      if (count >= 15) {
        return { applied: false, level: 'soften', reason: `中幅调整需梦境试探: ${mappedDim} ${direction} ${delta}%` };
      }
      return { applied: false, level: 'soften', reason: `信号不足: need≥15, have=${count}` };
    }

    // 大幅阻塞 (>15%)
    return { applied: false, level: 'blocked', reason: `大幅调整(>15%)需M7梦境确认 + M8历史仲裁` };
  }

  /** 执行已确认的大幅演化 */
  applyConfirmed(dimension: string, direction: 'increase' | 'decrease', delta: number): EvolutionDecision {
    const mappedDim = this.mapToTrait(dimension);
    if (!mappedDim) {
      return { applied: false, level: 'auto', reason: `"${dimension}"不是大五人格维度，跳过` };
    }
    if (!this.manager.checkCoreIdentity(mappedDim, direction)) {
      return { applied: false, level: 'blocked', reason: 'CORE_IDENTITY_ANCHOR' };
    }
    const traits = this.manager.getTraits();
    const key = mappedDim as keyof SelfModelTraits;
    const oldVal = traits[key];
    const step = direction === 'increase' ? delta / 100 : -delta / 100;
    const newVal = safeClamp((oldVal ?? 0.5) + step);
    if (isNaN(newVal)) {
      return { applied: false, level: 'blocked', reason: `数值异常: ${mappedDim} ${oldVal}+${step}=NaN` };
    }
    traits[key] = newVal;
    this.manager.updateTraits(traits);
    return { applied: true, level: 'auto', reason: `梦境确认后已演化 ${mappedDim}`, oldValue: oldVal, newValue: newVal };
  }

  getBufferSize(): number { return this.feedbackBuffer.length; }
  clearBuffer(): void { this.feedbackBuffer = []; }
}
