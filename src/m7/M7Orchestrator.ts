// M7-Dream · M7Orchestrator — 梦境空闲时段批量处理
// Ref: docs/M7-design-v1.md §3-§6
// @module M7-Dream

import { DreamQueue } from './DreamQueue.js';
import { DreamInternalizer } from './DreamInternalizer.js';
import { ClueTracker } from './ClueTracker.js';
import type { PendingDream } from './types/index.js';
import type { M8Engine } from '../m8/M8Engine.js';
import type { M6Orchestrator } from '../m6/M6Orchestrator.js';

/**
 * M7 空闲批处理定时器
 *（修复: 通过编排器代理方法访问 queue，不再直接访问内部引擎）
 */
export function startM7Interval(m7: M7Orchestrator, intervalMs: number = 60000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      if (m7.shouldProcessQueue()) {
        const result = await m7.processIdle();
        console.log(`[M7] 梦境批处理: ${result.internalized} 条`);
        m7.cleanResolvedQueue();
      }
    } catch (err) {
      console.error('[M7] 批处理失败:', err);
    }
  }, intervalMs);
}

export class M7Orchestrator {
  /** @deprecated 请通过编排器代理方法访问（shouldProcessQueue/cleanResolvedQueue/getPendingDreams 等） */
  public queue: DreamQueue;
  /** @deprecated 请通过编排器代理方法访问 */
  public internalizer: DreamInternalizer;
  /** @deprecated 请通过编排器代理方法访问 */
  public tracker: ClueTracker;

  constructor(m8: M8Engine) {
    this.queue = new DreamQueue();
    this.internalizer = new DreamInternalizer(this.queue, m8);
    this.tracker = new ClueTracker();
  }

  /** 延迟注入 M6 */
  setM6(m6: M6Orchestrator): void {
    this.internalizer.setM6(m6);
  }

  /** 空闲时段批处理 */
  async processIdle(): Promise<{ internalized: number; advice: string[] }> {
    const results = await this.internalizer.internalizeBatch();
    this.internalizer.discardStale();
    const advice = this.tracker.generateAdvice();
    return { internalized: results.length, advice };
  }

  // ─── 代理方法（收敛对外部引擎的直接访问） ───

  shouldProcessQueue(): boolean { return this.queue.shouldProcess(); }
  cleanResolvedQueue(): void { this.queue.cleanResolved(); }
  getPendingDreams(): PendingDream[] { return this.queue.getPending(); }
  getDreamCount(): number { return this.queue.getCount(); }
  addDream(dream: Omit<PendingDream, 'id' | 'created_at' | 'status'>): PendingDream {
    return this.queue.add(dream);
  }
  getDreamsByStatus(status: PendingDream['status']): PendingDream[] {
    return this.queue.getByStatus(status);
  }
}
