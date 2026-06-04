// M7-Dream · M7Orchestrator — 梦境空闲时段批量处理
// Ref: docs/M7-design-v1.md §3-§6
// @module M7-Dream

import { DreamQueue } from './DreamQueue.js';
import { DreamInternalizer } from './DreamInternalizer.js';
import { ClueTracker } from './ClueTracker.js';
import type { M8Engine } from '../m8/M8Engine.js';
export function startM7Interval(m7: M7Orchestrator, intervalMs: number = 60000): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      if (m7.queue.shouldProcess()) {
        const result = await m7.processIdle();
        console.log(`[M7] 梦境批处理: ${result.internalized} 条`);
        // 内化完成后清理已处理的条目
        m7.queue.cleanResolved();
      }
    } catch (err) {
      console.error('[M7] 批处理失败:', err);
    }
  }, intervalMs);
}

export class M7Orchestrator {
  public queue: DreamQueue;
  public internalizer: DreamInternalizer;
  public tracker: ClueTracker;

  constructor(m8: M8Engine) {
    this.queue = new DreamQueue();
    this.internalizer = new DreamInternalizer(this.queue, m8);
    this.tracker = new ClueTracker();
  }

  /** 空闲时段批处理 */
  async processIdle(): Promise<{ internalized: number; advice: string[] }> {
    const results = await this.internalizer.internalizeBatch();
    this.internalizer.discardStale();
    const advice = this.tracker.generateAdvice();
    return { internalized: results.length, advice };
  }
}
