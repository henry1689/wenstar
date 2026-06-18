// M6 M6Orchestrator — 对话后触发演化主控制器
// Ref: docs/M6-design-v1.md §5

import { SelfModelManager } from './SelfModelManager.js';
import { TraitEvolver } from './TraitEvolver.js';
import { PreferenceManager } from './PreferenceManager.js';
import { BoundaryManager } from './BoundaryManager.js';
import { NarrativeBuilder } from './NarrativeBuilder.js';
import type { EvolutionDecision, M6SelfModel, SelfModelTraits, Preference, Boundary, NarrativeLayer, CoreIdentityAnchors } from './types/index.js';
import type { M8Engine } from '../m8/M8Engine.js';

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
  private m8: M8Engine | null = null;
  /** @deprecated 直接访问内部引擎破坏封装，请改用编排器代理方法（getModel/getTraits 等） */
  public manager: SelfModelManager;
  /** @deprecated 直接访问内部引擎破坏封装，请改用编排器代理方法（applyConfirmed 等） */
  public evolver: TraitEvolver;
  /** @deprecated 直接访问内部引擎破坏封装，请改用编排器代理方法 */
  public prefs: PreferenceManager;
  /** @deprecated 直接访问内部引擎破坏封装，请改用编排器代理方法 */
  public boundaries: BoundaryManager;
  /** @deprecated 直接访问内部引擎破坏封装，请改用编排器代理方法 */
  public narrative: NarrativeBuilder;

  constructor(manager?: SelfModelManager) {
    this.manager = manager ?? new SelfModelManager();
    this.evolver = new TraitEvolver(this.manager);
    this.prefs = new PreferenceManager(this.manager);
    this.boundaries = new BoundaryManager(this.manager);
    this.narrative = new NarrativeBuilder(this.manager);
  }

  // ─── 代理方法（收敛外部访问，替代直接访问内部引擎） ───

  /** 注入 M8 引擎（可选，用于疤痕冲突检查） */
  setM8(m8: M8Engine): void { this.m8 = m8; }

  getModel(): M6SelfModel { return this.manager.getModel(); }
  getTraits(): SelfModelTraits { return this.manager.getTraits(); }
  getPreferences(): Preference[] { return this.manager.getPreferences(); }
  getBoundaries(): Boundary[] { return this.manager.getBoundaries(); }
  getNarrativeLayers(): NarrativeLayer[] { return this.manager.getNarrativeLayers(); }
  getAnchors(): CoreIdentityAnchors { return this.manager.getAnchors(); }
  applyConfirmed(dimension: string, direction: 'increase' | 'decrease', delta: number): EvolutionDecision {
    return this.evolver.applyConfirmed(dimension, direction, delta);
  }

  /**
   * 对话后触发演化 — 完整流程
   * 1. 收集本轮感知信号
   * 2. 逐支柱分析
   * 3. 衰减维护
   */
  async processSignal(signal: M6InputSignal): Promise<EvolutionDecision[]> {
    const decisions: EvolutionDecision[] = [];

    // ① M8 疤痕冲突检查（如有 M8 引擎）
    if (this.m8) {
      try {
        const conflict = await this.m8.checkConflict({
          target: signal.dimension,
          direction: signal.direction,
          delta: signal.delta,
        });
        if (conflict.hasConflict) {
          console.warn('[M6] 疤痕冲突: ' + conflict.description + ' → 建议: ' + conflict.suggestion);
          if (conflict.suggestion === 'block') {
            console.warn('[M6] 疤痕拦截: ' + signal.dimension + ' 变更被阻止');
            return [{ applied: false, level: 'blocked', reason: 'blocked_by_scar: ' + conflict.description }];
          }
          if (conflict.suggestion === 'soften') {
            signal.delta = Math.min(signal.delta, 3);
            console.log('[M6] 疤痕软化: delta 降至 ' + signal.delta);
          }
        }
      } catch (err) {
        console.warn('[M6] checkConflict 失败:', err);
      }
    }

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
    this.prefs.recordMention(signal.dimension, signal.e1_pleasure, signal.triggerEvent);

    // 第3步：叙事层（重大事件）
    if (signal.calcium >= 2) {
      const narrativeText = signal.triggerEvent.substring(0, 60);
      // 冲突检测后添加
      const conflictWarnings = this.narrative.detectConflict(narrativeText);
      if (conflictWarnings.length > 0) {
        console.warn('[M6] 叙事冲突:', conflictWarnings);
      }
      this.narrative.addLayer(
        narrativeText,
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
