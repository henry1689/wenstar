// M6 M6Orchestrator — 对话后触发演化主控制器
// Ref: docs/M6-design-v1.md §5

import { SelfModelManager } from './SelfModelManager.js';
import { TraitEvolver } from './TraitEvolver.js';
import { PreferenceManager } from './PreferenceManager.js';
import { BoundaryManager } from './BoundaryManager.js';
import { NarrativeBuilder } from './NarrativeBuilder.js';
import type { EvolutionDecision } from './types/index.js';

export interface M6InputSignal {
  dimension: string;
  direction: 'increase' | 'decrease';
  delta: number;
  e1_pleasure: number;
  i2_intimacy: number;
  c1_conflict: number;
  calcium: number;
  triggerEvent: string;
}

export class M6Orchestrator {
  public manager: SelfModelManager;
  public evolver: TraitEvolver;
  public prefs: PreferenceManager;
  public boundaries: BoundaryManager;
  public narrative: NarrativeBuilder;

  constructor(manager?: SelfModelManager) {
    this.manager = manager ?? new SelfModelManager();
    this.evolver = new TraitEvolver(this.manager);
    this.prefs = new PreferenceManager(this.manager);
    this.boundaries = new BoundaryManager(this.manager);
    this.narrative = new NarrativeBuilder(this.manager);
  }

  /**
   * 对话后触发演化 — 完整流程
   * 1. 收集本轮感知信号
   * 2. 逐支柱分析
   * 3. 衰减维护
   */
  async processSignal(signal: M6InputSignal): Promise<EvolutionDecision[]> {
    const decisions: EvolutionDecision[] = [];

    // 第1步：特质演化
    // 先映射到 trait 再存储和计算，否则 buffer 里的原始实体名与 trait 键不匹配
    const mappedDim = this.evolver.mapToTrait(signal.dimension) ?? signal.dimension;
    this.evolver.addFeedback({
      dimension: mappedDim, direction: signal.direction,
      delta: signal.delta, e1_pleasure: signal.e1_pleasure,
      i2_intimacy: signal.i2_intimacy, c1_conflict: signal.c1_conflict,
      timestamp: new Date().toISOString(),
    });
    decisions.push(this.evolver.proposeEvolution(mappedDim, signal.direction, signal.delta));

    // 第2步：偏好管理（使用原始实体名，"开心"作为偏好才有意义）
    this.prefs.recordMention(signal.dimension, signal.e1_pleasure);

    // 第3步：叙事层（重大事件）
    if (signal.calcium >= 2) {
      // 冲突检测后添加
      const conflictWarnings = this.narrative.detectConflict(
        `多元感知到强烈信号: ${signal.dimension} ${signal.direction}`
      );
      if (conflictWarnings.length > 0) {
        console.warn('[M6] 叙事冲突:', conflictWarnings);
      }
      this.narrative.addLayer(
        `多元感知到强烈信号: ${signal.dimension} ${signal.direction}`,
        signal.triggerEvent, signal.calcium
      );
    }

    return decisions;
  }

  /** 空闲期维护（可定时调用） */
  maintenance(): void {
    this.prefs.applyDecay();
    this.boundaries.applyDecay();
    this.evolver.clearBuffer();
  }
}
