/**
 * M7-Consolidation · ConsolidationQueue — 记忆巩固队列
 *
 * 当系统空闲时（无用户消息 >30s），从近期记忆中挑选高钙化候选，
 * 验证其钙化是否维持高水平，晋升符合条件的到 M8 地标。
 *
 * 与 DreamQueue 联动：晋升为地标的记忆同时生成梦境条目，
 * 让巩固发现的"值得记住的事"进入梦境处理流水线
 *（修复: 将三个独立后台合并为联动闭环）
 *
 * @module M7-Consolidation
 */
import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { DreamQueue } from './DreamQueue.js';

export class ConsolidationQueue {
  private storage: FusionStorageAdapter;
  private dreamQueue: DreamQueue | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivity = Date.now();
  private readonly IDLE_THRESHOLD = 30_000;
  private readonly CHECK_INTERVAL = 10_000;

  constructor(storage: FusionStorageAdapter, dreamQueue?: DreamQueue) {
    this.storage = storage;
    this.dreamQueue = dreamQueue ?? null;
  }

  /** 注入 DreamQueue（可选 — 联动: 晋升→梦境） */
  setDreamQueue(dq: DreamQueue): void { this.dreamQueue = dq; }

  /** 记录用户活动 */
  recordActivity(): void {
    this.lastActivity = Date.now();
  }

  start(): void {
    console.log('[Consolidation] 启动巩固队列');
    const loop = () => {
      const idle = Date.now() - this.lastActivity;
      if (idle > this.IDLE_THRESHOLD) {
        this.runConsolidation().catch(() => {});
      }
      this.idleTimer = setTimeout(loop, this.CHECK_INTERVAL);
    };
    this.idleTimer = setTimeout(loop, this.CHECK_INTERVAL * 3); // 首次延迟
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
  }

  private async runConsolidation(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();

      // 获取最近 30 条记录，寻找钙化候选
      const recent = sqlite.findBySeqPosRange(0, 999_999_999, 30);
      const candidates = recent
        .filter(r => !r.is_landmark && r.calcium_level >= 1)
        .sort((a, b) => b.calcium_score - a.calcium_score)
        .slice(0, 5);

      let promoted = 0;
      for (const candidate of candidates) {
        if (candidate.calcium_score >= 0.25 && candidate.effective_strength > 0.2) {
          const success = sqlite.promoteToLandmark(
            candidate.id,
            candidate.calcium_score >= 0.7 ? '重要时刻' : '日常印记',
            candidate.entity_genes.map(g => g.name).join('、'),
          );
          if (success) {
            promoted++;
            // 联动: 晋升地标的同时生成梦境条目，让"值得记住的事"进入梦境流水线
            if (this.dreamQueue && this.dreamQueue.getCount() < 20) {
              try {
                const traits: string[] = ['extraversion'];
                if (candidate.calcium_score > 0.4) traits.push('agreeableness');
                this.dreamQueue.add({
                  source: 'Consolidation',
                  content: `系统注意到一条重要记忆: ${candidate.raw_input.substring(0, 40)}`,
                  affected_traits: traits,
                  related_memory_id: candidate.id,
                });
              } catch (err) {
                console.warn('[Consolid→Dream] 联动失败:', err);
              }
            }
          }
        }
      }

      if (promoted > 0) {
        console.log(`[Consolidation] 晋升 ${promoted} 条记忆为地标`);
      }
    } catch (err) {
      console.warn('[Consolidation] 巩固失败:', err);
    }
  }
}
