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
import { PerceptionAnalyzer } from '../m3/PerceptionAnalyzer.js';

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
  /** P2: M3 情绪标签 */
  primaryEmotion?: string;
  secondaryEmotions?: string[];
}

export class WorkingMemory {
  /** R6: 当前对话角色标签（用于记忆定向过滤） */
  static currentTag: string | null = null;

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
  push(dna: DNA, perception: Perception24D, seqPos: number, primaryEmotion?: string, secondaryEmotions?: string[]): void {
    // 使用 M3 钙质公式（与决策路由同源，避免两套标准打架）
    const calcium = PerceptionAnalyzer.recalculateCalcium(perception);
    const meaningful = dna.entity_genes.some(g =>
      g.type !== 'self' && g.name.length > 0
    );

    const entry: WorkingEntry = {
      dna,
      perception,
      calciumScore: calcium.score,
      calciumLevel: calcium.level,
      seqPos,
      cycleCount: 0,
      hasMeaningfulEntity: meaningful,
      createdAt: Date.now(),
    };

    // 毕业即写入 — 符合条件的直接进金库
    const tier = this.shouldGraduate(entry);
    if (tier === 'full') {
      entry.dna.seq_pos = entry.seqPos;
      this.storage.write(entry.dna, entry.perception, primaryEmotion, secondaryEmotions).then(() => {
        console.log('[WM] 即时毕业');
      }).catch((err) => {
        console.warn('[WM] 即时毕业失败，入buffer:', err);
        this.buffer.push(entry);
      });
    } else {
      this.buffer.push(entry);
    }

    // 超过阈值时触发巩固（通过 consolidateSafe 避免并发重叠）
    if (this.buffer.length >= this.maxSize) {
      this.consolidateSafe().catch(() => {});
    }
  }

  /** 巩固：毕业高价值记录到 M2，丢弃噪音 */
  //
  // 毕业规则：砂金库(conversations.json)已有全部原始对话
  // 合格(钙质≥1+实体)→进金库；不合格→丢弃

  /** 毕业策略
   *  full: 钙质≥0.3+有实体 → 完整24D写入金库
   *  false: 无实体 → 留在砂金库等闭组
   *  (light 已移除：所有记忆统一走 storage.write()，由 flushDialogGroup 管理归组) */
  private shouldGraduate(entry: WorkingEntry): 'full' | false {
    if (!entry.hasMeaningfulEntity) return false;
    if (entry.calciumLevel >= 0.3) return 'full';
    return false; // 一律走砂金库，等闭组写入金库
  }

  async consolidate(): Promise<WriteResult[]> {
    const results: WriteResult[] = [];
    const snapshot: WorkingEntry[] = [...this.buffer];
    snapshot.sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of snapshot) {
      const tier = this.shouldGraduate(entry);
      if (tier === 'full') {
        const result = await this.writeEntry(entry);
        results.push(result);
      }
    }
    this.buffer = [];
    if (results.length > 0) {
      console.log("[WM] 巩固: " + results.length + " 条进入金库");
    }
    return results;
  }

  /** 写入一条记录到 M2，使用预分配的 seqPos */
  private async writeEntry(entry: WorkingEntry): Promise<WriteResult> {
    // 在 DNA 中设入预分配的 seq_pos，FusionStorageAdapter.write() 会读取它
    entry.dna.seq_pos = entry.seqPos;
    return this.storage.write(entry.dna, entry.perception, entry.primaryEmotion, entry.secondaryEmotions);
  }

  /** 获取缓冲状态 */
  getStatus(): { size: number; maxSize: number; utilization: number; pendingGraduates: number } {
    const pending = this.buffer.filter(function(e) { return !!e.hasMeaningfulEntity; }).length;
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
        const _tier = this.shouldGraduate(entry);
        if (!_tier) {
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
      console.log("[WM] 刷出: " + results.length + " 条进金库 (丢弃 " + dropped.length + " 条)");
    }
    return results;
  }
}
