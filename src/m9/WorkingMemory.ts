/**
 * M9 WorkingMemory — 工作记忆缓冲（唯一 M2 写入入口）
 *
 * 短期记忆环缓冲区。所有消息先进入这里，
 * 只有达到毕业阈值（钙化够高或有实体）才写入 M2 长期存储。
 * 粉末级的日常噪音直接丢弃。
 *
 * 设计变更 (2026-06-04):
 * - 现在是 M2 的唯一写入入口（server.ts 不再直接调用 storage.write()）
 * - seq_pos 由 FusionStorageAdapter.reserveNextSeq() 预分配，consolidate 时携带
 */
import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { Perception24D } from '../m3/types/perception.js';
import type { DNA } from '../m1/types/dna.js';
import type { WriteResult } from '../m2/types/index.js';
import { computeCalcium } from '../m2/math.js';

interface WorkingEntry {
  dna: DNA;
  perception: Perception24D;
  calciumScore: number;
  calciumLevel: number;
  /** 预分配的 seq_pos */
  seqPos: number;
  /** 在缓冲中停留的 consolidation 轮数 */
  cycleCount: number;
  /** 是否有值得保留的实体 */
  hasMeaningfulEntity: boolean;
  createdAt: number;
}

export class WorkingMemory {
  private buffer: WorkingEntry[] = [];
  private maxSize: number;
  private storage: FusionStorageAdapter;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(storage: FusionStorageAdapter, maxSize = 50) {
    this.storage = storage;
    this.maxSize = maxSize;
  }

  /** 启动定时刷出（每 60s 将缓冲中已就绪的记录写入 M2） */
  startFlushTimer(intervalMs = 60_000): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(async () => {
      if (this.buffer.length > 0) {
        const results = await this.consolidate();
        if (results.length > 0) {
          console.log(`[WM] 定时刷出: ${results.length} 条`);
        }
      }
    }, intervalMs);
  }

  stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * 推入一条新记录
   * @param seqPos 由 FusionStorageAdapter.reserveNextSeq() 预分配的位置
   */
  push(dna: DNA, perception: Perception24D, seqPos: number): void {
    const calcium = computeCalcium(perception);
    const meaningful = dna.entity_genes.some(g =>
      g.type !== 'self' && g.name.length > 0
    );

    this.buffer.push({
      dna,
      perception,
      calciumScore: calcium.score,
      calciumLevel: calcium.level,
      seqPos,
      cycleCount: 0,
      hasMeaningfulEntity: meaningful,
      createdAt: Date.now(),
    });

    // 超过阈值时触发巩固
    if (this.buffer.length >= this.maxSize) {
      this.consolidate().catch(() => {});
    }
  }

  /** 巩固：毕业高价值记录到 M2，丢弃噪音 */
  async consolidate(): Promise<WriteResult[]> {
    const results: WriteResult[] = [];

    // 按创建时间排序（最早的先处理）
    this.buffer.sort((a, b) => a.createdAt - b.createdAt);

    // 逐条判定
    const keep: WorkingEntry[] = [];
    for (const entry of this.buffer) {
      entry.cycleCount++;

      // ─── 毕业判定 ───
      const shouldGraduate =
        entry.calciumLevel >= 2 ||                    // 固体/晶体级
        (entry.calciumLevel === 1 && entry.hasMeaningfulEntity) || // 液体级 + 有实体
        (entry.calciumLevel === 1 && entry.cycleCount >= 3);      // 液体级且停留了3轮

      // ─── 丢弃判定 ───
      let shouldDiscard =
        entry.calciumLevel === 0 ||                    // 粉末级 → 噪音
        (!entry.hasMeaningfulEntity && entry.cycleCount >= 2);    // 无实体且停留2轮

      // ─── 安全阀：cycleCount ≥ 6 强制处理（防止堆积） ───
      if (entry.cycleCount >= 6) {
        if (entry.calciumLevel >= 1 && entry.hasMeaningfulEntity) {
          // 有值但迟迟未毕业 → 强制毕业
          const result = await this.writeEntry(entry);
          results.push(result);
        }
        // 否则强制丢弃（不进 keep）
        continue;
      }

      if (shouldGraduate) {
        const result = await this.writeEntry(entry);
        results.push(result);
      } else if (!shouldDiscard) {
        // 还不确定 → 留在缓冲中等下一轮
        keep.push(entry);
      }
      // shouldDiscard → 直接丢弃
    }

    this.buffer = keep;

    if (results.length > 0) {
      console.log(`[WM] 巩固: ${results.length} 条毕业, ${keep.length} 条保留在缓冲`);
    }

    return results;
  }

  /** 写入一条记录到 M2，使用预分配的 seqPos */
  private async writeEntry(entry: WorkingEntry): Promise<WriteResult> {
    // 在 DNA 中设入预分配的 seq_pos，FusionStorageAdapter.write() 会读取它
    entry.dna.seq_pos = entry.seqPos;
    return this.storage.write(entry.dna, entry.perception);
  }

  /** 获取缓冲状态 */
  getStatus(): { size: number; maxSize: number; utilization: number; pendingGraduates: number } {
    const pending = this.buffer.filter(e =>
      e.calciumLevel >= 2 ||
      (e.calciumLevel === 1 && e.hasMeaningfulEntity)
    ).length;
    return {
      size: this.buffer.length,
      maxSize: this.maxSize,
      utilization: Math.round(this.buffer.length / this.maxSize * 100),
      pendingGraduates: pending,
    };
  }

  /** 强制写入所有剩余记录（服务器关闭前调用） */
  async flushAll(): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    for (const entry of this.buffer) {
      try {
        entry.dna.seq_pos = entry.seqPos;
        results.push(await this.storage.write(entry.dna, entry.perception));
      } catch (err) {
        console.warn("[WM] 写入失败:", err);
        results.push({ success: false, real_ref: '', seq_pos: -1, error: 'flush failed' });
      }
    }
    this.buffer = [];
    if (results.length > 0) {
      console.log(`[WM] 强制刷出: ${results.length} 条`);
    }
    return results;
  }
}
