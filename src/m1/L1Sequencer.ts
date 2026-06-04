// Ref: ARCH.md §3.1 L1 分支路由码
// Ref: ARCH.md §3.2 写入正向流 — L1 seq_pos 由时空情景区原子性分配

import type { L1SequenceResult } from './types/dna.js';

/**
 * L1 序列生成器
 *
 * 生成当前会话内的临时 branch_id 和 seq_pos。
 * branch_id 格式：evt_YYYYMMDD_NNN
 * seq_pos 为会话内严格单调递增序列。
 *
 * M2 会接管真正的原子性序列分配和持久化。
 * 当前实现使用内存计数器，每次创建新实例会重置。
 *
 * Ref: ARCH.md §3.1 分支路由码规范
 */
export class L1Sequencer {
  private counter = 0;
  private currentDate: string;

  constructor() {
    this.currentDate = this.getDateString();
  }

  /**
   * 生成下一个序列值
   * 每次调用返回严格递增的 (branch_id, seq_pos)
   * 跨日期时 branch_id 的日期部分自动更新，counter 从0重新开始
   */
  next(): L1SequenceResult {
    const today = this.getDateString();

    // 如果日期变更，重置 counter
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.counter = 0;
    }

    this.counter++;
    const seq = this.counter;

    const branchId = `evt_${today}_${String(seq).padStart(3, '0')}`;

    return {
      branch_id: branchId,
      seq_pos: seq,
    };
  }

  /**
   * 重置序列（用于测试或新会话）
   */
  reset(): void {
    this.counter = 0;
    this.currentDate = this.getDateString();
  }

  /**
   * 获取当前计数（仅用于测试/调试）
   */
  getCurrentCount(): number {
    return this.counter;
  }

  private getDateString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }
}
