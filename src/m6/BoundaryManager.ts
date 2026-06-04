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

  /** 记录边界触碰 */
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
