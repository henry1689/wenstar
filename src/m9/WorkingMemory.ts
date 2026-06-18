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
  /** 巩固锁：防止并发 consolidate 同时操作 buffer */
  private _consolidating = false;
  /** 溢出时待调用的巩固（防丢失） */
  private _pendingConsolidate = false;

  constructor(storage: FusionStorageAdapter, maxSize = 50) {
    this.storage = storage;
    this.maxSize = maxSize;
  }

  /** 启动定时刷出（每 60s 将缓冲中已就绪的记录写入 M2） */
  startFlushTimer(intervalMs = 60_000): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(async () => {
      if (this.buffer.length > 0) {
        await this.consolidateSafe();
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
   * 安全巩固（带锁 + 防重叠）
   * 定时器和溢出都可能触发 consolidate，必须串行化
   */
  private async consolidateSafe(): Promise<void> {
    if (this._consolidating) {
      this._pendingConsolidate = true;
      return;
    }
    this._consolidating = true;
    try {
      const results = await this.consolidate();
      if (results.length > 0) {
        console.log(`[WM] 刷出: ${results.length} 条`);
      }
    } finally {
      this._consolidating = false;
      // 如果执行期间又有新的溢出请求，立即再跑一轮
      if (this._pendingConsolidate) {
        this._pendingConsolidate = false;
        await this.consolidateSafe();
      }
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

    // 超过阈值时触发巩固（通过 consolidateSafe 避免并发重叠）
    if (this.buffer.length >= this.maxSize) {
      this.consolidateSafe().catch(() => {});
    }
  }

  /** 巩固：毕业高价值记录到 M2，丢弃噪音 */
  //
  // 毕业/丢弃阈值说明（引用 M3 钙质等级规范）:
  //   钙质等级: 0=粉末(噪音)  1=液体(普通)  2=固体(值得记)  3=晶体(刻骨铭心)
  //   液体级停留超过 GRADUATE_CYCLE_MAX 轮未有实体 → 毕业
  //   粉末级 → 直接丢弃
  //   无实体且超过 DISCARD_CYCLE_MAX 轮 → 丢弃
  //   安全阀 FORCE_GRADUATE_CYCLE: 超过此轮数强制处理
  private static readonly GRADUATE_CYCLE_MAX = 3;       // 液体级最长停留轮数
  private static readonly DISCARD_CYCLE_MAX = 2;        // 无实体条目最长停留轮数
  private static readonly FORCE_GRADUATE_CYCLE = 6;     // 安全阀：强制处理阈值

  /** 判断条目是否应毕业（共享方法，供 consolidate 和 getStatus 使用） */
  private shouldGraduate(entry: WorkingEntry): boolean {
    return entry.calciumLevel >= 2 ||
      (entry.calciumLevel === 1 && entry.hasMeaningfulEntity) ||
      (entry.calciumLevel === 1 && entry.cycleCount >= WorkingMemory.GRADUATE_CYCLE_MAX) ||
      (entry.cycleCount >= WorkingMemory.FORCE_GRADUATE_CYCLE && entry.calciumLevel >= 1 && entry.hasMeaningfulEntity);
  }

  /** 判断条目是否应丢弃 */
  private shouldDiscard(entry: WorkingEntry): boolean {
    return entry.calciumLevel === 0 ||
      (!entry.hasMeaningfulEntity && entry.cycleCount >= WorkingMemory.DISCARD_CYCLE_MAX);
  }

  async consolidate(): Promise<WriteResult[]> {
    const results: WriteResult[] = [];

    // 快照当前缓冲（避免 consolidate 期间 push 修改 buffer）
    const snapshot = [...this.buffer];
    snapshot.sort((a, b) => a.createdAt - b.createdAt);

    // 逐条判定（使用共享方法 shouldGraduate/shouldDiscard）
    const keep: WorkingEntry[] = [];
    for (const entry of snapshot) {
      entry.cycleCount++;

      // ─── 安全阀：cycleCount ≥ FORCE_GRADUATE_CYCLE 强制处理（防止堆积） ───
      if (entry.cycleCount >= WorkingMemory.FORCE_GRADUATE_CYCLE) {
        if (entry.calciumLevel >= 1 && entry.hasMeaningfulEntity) {
          const result = await this.writeEntry(entry);
          results.push(result);
        }
        continue;
      }

      if (this.shouldGraduate(entry)) {
        const result = await this.writeEntry(entry);
        results.push(result);
      } else if (!this.shouldDiscard(entry)) {
        keep.push(entry);
      }
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
    const pending = this.buffer.filter(e => this.shouldGraduate(e)).length;
    return {
      size: this.buffer.length,
      maxSize: this.maxSize,
      utilization: Math.round(this.buffer.length / this.maxSize * 100),
      pendingGraduates: pending,
    };
  }

  /** 强制写入所有剩余记录（服务器关闭前调用）— 保留毕业逻辑，噪声不写入 */
  async flushAll(): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    const dropped: number[] = [];
    for (const entry of this.buffer) {
      try {
        // 保留毕业逻辑：钙质 0 且无实体 → 噪声，跳过
        if (!this.shouldGraduate(entry)) {
          dropped.push(entry.seqPos);
          continue;
        }
        entry.dna.seq_pos = entry.seqPos;
        results.push(await this.storage.write(entry.dna, entry.perception));
      } catch (err) {
        console.warn("[WM] 写入失败:", err);
        results.push({ success: false, real_ref: '', seq_pos: -1, error: 'flush failed' });
      }
    }
    this.buffer = [];
    if (results.length > 0) {
      console.log(`[WM] 强制刷出: ${results.length} 条 (丢弃 ${dropped.length} 条噪声)`);
    }
    return results;
  }
}
