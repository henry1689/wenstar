// M3LogicOrchestrator — M3 逻辑决策层编排器
//
// ╔═══════════════════════════════════════════════════════╗
// ║  M3LogicOrchestrator.ts  v1.0                         ║
// ║  归属: M3 (逻辑决策层)                                ║
// ║  职责: 感知分析 → 钙质计算 → 决策路由 → 动作输出      ║
// ║  日期: 2026-06-02                                    ║
// ╚═══════════════════════════════════════════════════════╝
//
// 流水线: M1(编码) → M2(存储) → M3(感知+决策) → M4/M5
//
// 工作流:
//   1. 接收 M1 的 DNA + M3Context
//   2. PerceptionAnalyzer.analyze(dna) → 24维感知 + 钙质
//   3. injectContext(context) → 时间/地点修正感知维度
//   4. recalculateCalcium → 重新计算钙质
//   5. 决策路由表 → 输出 M3Action[]
//   6. 返回 M3Decision

import type { DNA } from '../m1/types/dna.js';
import type {
  M3Decision,
  M3Action,
  M3Context,
  CalciumLevel,
  EnhancedDNA,
} from './types/perception.js';
import { PerceptionAnalyzer } from './PerceptionAnalyzer.js';

/**
 * M3 逻辑决策层编排器
 *
 * 决策路由表（钙质等级 × 情绪极性 → 动作）:
 *
 * | 钙质等级 | 愉悦度 > 0.2 | 愉悦度 < -0.2 | 中性 (-0.2~0.2) |
 * | :--- | :--- | :--- | :--- |
 * | 粉末 (0) | ignore | ignore | ignore |
 * | 液体 (1) | memorize | memorize | memorize |
 * | 固体 (2) | ask | comfort | memorize + ask |
 * | 晶体 (3) | act (分享喜悦) | act (紧急安抚) | act (触发核心) |
 *
 * Ref: M3-design-v1.md §3
 */
export class M3LogicOrchestrator {
  private analyzer: PerceptionAnalyzer;

  constructor() {
    this.analyzer = new PerceptionAnalyzer();
  }

  /**
   * 对一条 DNA 执行完整的 M3 逻辑决策流程
   *
   * Phase 1: 24维感知分析
   * Phase 2: 上下文注入（时间 + 地点）
   * Phase 3: 钙质重算
   * Phase 4: 决策路由
   * Phase 5: 构建输出
   *
   * @param dna - M1 编码产出的 DNA 对象
   * @param context - 决策上下文（时间、地点、历史）
   * @returns M3 决策结果
   */
  decide(dna: DNA, context?: M3Context): M3Decision {
    // Phase 1: 24维感知（含场景感知基线调整）
    const enhanced = this.analyzer.analyze(dna, dna.scene_tags);

    // Phase 2: 上下文注入（时间词修正 C5，地点词修正 S6）
    this.analyzer.injectContext(enhanced, context);

    // Phase 3: 钙质重算（含场景配置偏移 + P1-1结构化人物信息加权）
    const calcium = PerceptionAnalyzer.recalculateCalcium(enhanced.perception, enhanced.calcium_config, dna.entity_genes);
    enhanced.calcium_score = calcium.score;
    enhanced.calcium_level = calcium.level;

    // Phase 4: 决策路由
    const actions = this.route(enhanced);

    // Phase 5: P2 — 从 24D 向量推导情绪标签 + 置信度
    const { primary, secondary } = PerceptionAnalyzer.deriveEmotionLabels(enhanced.perception);
    const rawHits = Math.round(
      (enhanced.perception.pleasure !== 0 ? 1 : 0) +
      (enhanced.perception.arousal > 0 ? 1 : 0) +
      (enhanced.perception.intimacy > 0 ? 1 : 0) +
      (enhanced.perception.aggression > 0 ? 1 : 0) +
      (enhanced.perception.sincerity > 0.5 ? 1 : 0) +
      ((enhanced.perception as any).sexual_attraction > 0 ? 1 : 0) +
      ((enhanced.perception as any).ecstasy > 0 ? 1 : 0)
    );
    const emotions: string[] = [primary, ...(secondary || [])].filter((e): e is string => Boolean(e));
    const confidence = PerceptionAnalyzer.estimateConfidence(emotions, dna.raw_input.length, rawHits, enhanced.calcium_score);

    // Phase 6: 构建输出
    const reason = this.describeActions(actions, enhanced);
    const timestamp = context?.current_time ?? new Date().toISOString();

    return {
      enhanced, actions, reason, timestamp,
      primary_emotion: primary,
      secondary_emotions: secondary && secondary.length > 0 ? secondary : undefined,
      confidence,
    };
  }

  /**
   * 批量决策
   */
  decideBatch(dnas: DNA[], context?: M3Context): M3Decision[] {
    return dnas.map((dna) => this.decide(dna, context));
  }

  // ─── 私有方法 ───

  /**
   * 核心决策路由表
   *
   * 根据钙质等级和愉悦度确定动作。
   * Ref: M3-design-v1.md §3.2
   */
  private route(enhanced: EnhancedDNA): M3Action[] {
    const level = enhanced.calcium_level;
    const pleasure = enhanced.perception.pleasure;

    // 粉末级：一律忽略
    if (level === 0) return ['ignore'];

    // 晶体级：触发核心行动
    if (level === 3) return ['act'];

    // 固体级：分情绪极性
    if (level === 2) {
      if (pleasure < -0.2) return ['comfort', 'memorize'];
      if (pleasure > 0.2) return ['ask', 'memorize'];
      return ['memorize', 'ask'];
    }

    // 液体级：正常记忆
    if (level === 1) {
      if (pleasure < -0.5) return ['comfort', 'memorize'];
      if (pleasure > 0.5) return ['memorize'];
      return ['memorize'];
    }

    // fallback（不应到达）
    return ['memorize'];
  }

  /**
   * 生成决策理由
   */
  private describeActions(actions: M3Action[], enhanced: EnhancedDNA): string {
    const levelName = PerceptionAnalyzer.describeLevel(enhanced.calcium_level);
    const actionNames = actions.map((a) => this.actionName(a)).join(' → ');
    return `钙质等级 ${enhanced.calcium_level} (${levelName})。决策: ${actionNames}`;
  }

  private actionName(action: M3Action): string {
    switch (action) {
      case 'ignore': return '忽略';
      case 'memorize': return '记忆';
      case 'ask': return '追问';
      case 'comfort': return '安慰';
      case 'act': return '行动';
    }
  }
}
