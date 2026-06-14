// M6 BoundaryManager — 边界强化/软化 + hitCount 跟踪
// Ref: docs/M6-design-v1.md §3.3

import type { Boundary } from './types/index.js';
import { SelfModelManager } from './SelfModelManager.js';

const SOFTEN_DECAY_DAYS = 90;

export class BoundaryManager {
  private manager: SelfModelManager;

  constructor(manager: SelfModelManager) {
    this.manager = manager;
  }

  /**
   * 记录边界触碰
   *
   * ⚠️ 当前未被调用。
   * 设计意图：每次 LLM 回复后检测用户是否触碰边界时调用此方法，
   * 驱动边界动态强化/软化。但"边界触碰检测"逻辑在 DeepSeekLLMProvider
   * 的回复解析链路中尚未实现，导致此方法处于待接入状态。
   *
   * 激活条件：需要在 chat.ts 的 M6 processSignal() 调用中传入
   * boundaryHits 参数，或在 HumanisticCalibrator 中增加边界检测。
   *
   * 保留原因：方法实现完整（新边界自动学习/触碰计数/强化/软化/衰减），
   * 接入检测链路后即可激活，无需重新编写逻辑。
   */
  recordHit(rule: string, wasRejected: boolean, calcium: number, arousal: number): void {
    const boundaries = this.manager.getBoundaries();
    const boundary = boundaries.find(b => b.rule === rule);

    if (!boundary) {
      // 新边界：自动学习
      this.manager.addBoundary({
        rule, severity: 'soft', hitCount: 1,
        lastHit: new Date().toISOString(), context: '自动学习',
      });
      return;
    }

    boundary.lastHit = new Date().toISOString();

    if (wasRejected) {
      boundary.hitCount++;
      // ≥5次触碰 + 被拒绝 → 边界强化
      if (boundary.hitCount >= 5 && boundary.severity === 'soft') {
        boundary.severity = 'hard';
      }
    } else {
      // 未被拒绝 + 高唤醒 → 边界软化提议
      if (calcium >= 2 && arousal > 0.6 && boundary.severity === 'hard') {
        boundary.severity = 'soft';
      }
    }

    this.manager.addBoundary(boundary);
  }

  /** 衰减：90天无触碰 → hitCount 归零 */
  applyDecay(): void {
    const now = Date.now();
    const boundaries = this.manager.getBoundaries();
    for (const b of boundaries) {
      if (!b.lastHit) continue;
      const daysSince = (now - new Date(b.lastHit).getTime()) / (1000 * 86400);
      if (daysSince >= SOFTEN_DECAY_DAYS) {
        b.hitCount = 0;
        this.manager.addBoundary(b);
      }
    }
  }
}
