/**
 * MemoryAssessor — 三库自动流转调度器（S2-2 新规格对齐）
 *
 * 后台异步运行三个评估任务：
 *   ① 砂金库→金库（每 30 分钟）：calcium ≥ 1 晋升
 *   ② 金库→黑钻库（每 2 小时）：calcium ≥ 4.5 或 recall ≥ 5 晋升
 *   ③ 钙化分衰减（每 24 小时）：场景差异化衰减
 *
 * 复用 VaultManager 现有函数，只加调度逻辑。
 * 所有任务通过 setTimeout 异步执行，不阻塞主回复流程。
 */
import type { FusionStorageAdapter } from '../../m2/FusionStorageAdapter.js';
import { autoPromoteCandidatesV2 } from './VaultManager.js';

export class MemoryAssessor {
  private storage: FusionStorageAdapter;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private started = false;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    console.log('[MemoryAssessor] 启动三库流转调度器 (S2-2新规格)');

    this.schedule('sandToGold', 30 * 60 * 1000, () => this.runSandToGold());
    this.schedule('goldToDiamond', 2 * 60 * 60 * 1000, () => this.runGoldToDiamond());
    this.schedule('decay', 24 * 60 * 60 * 1000, () => this.runDecay());
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.started = false;
  }

  private schedule(name: string, interval: number, fn: () => Promise<void>): void {
    const tick = () => {
      fn().catch(err => console.warn(`[MemoryAssessor] ${name} 失败:`, err));
      this.timers.push(setTimeout(tick, interval));
    };
    const delay = Math.random() * 60000 + 5000;
    this.timers.push(setTimeout(tick, delay));
  }

  // --- ① 砂金库→金库（新规格: calcium ≥ 1 晋升）---

  private async runSandToGold(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      const recentConvs = sqlite.queryAll(
        `SELECT id, role, content, calcium_score, entity_json, dna_root_id, timestamp
         FROM conversations
         WHERE is_promoted = 0 AND calcium_score >= 1.0
         ORDER BY calcium_score DESC LIMIT 30`
      ) as any[];

      if (recentConvs.length === 0) {
        console.log('[MemoryAssessor] 砂金→金库: 无待晋升数据');
        return;
      }

      let promoted = 0;
      sqlite.writeRaw('BEGIN');

      for (const conv of recentConvs) {
        if (conv.role !== 'user') continue;
        const text = (conv.content || '') as string;
        if (text.length < 10) continue;

        const dnaRootId = conv.dna_root_id || `sand_fallback_${Date.now()}`;
        const calciumScore = conv.calcium_score || 1.0;
        const memoryId = `mem_${dnaRootId}`;

        try {
          sqlite.writeRaw(
            `INSERT OR IGNORE INTO memories
             (id, raw_input, entity_genes, created_at, calcium_score, calcium_level, effective_strength, dna_root_id, strength_updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [memoryId, text.substring(0, 500),
             conv.entity_json || '[]',
             new Date().toISOString(),
             calciumScore,
             Math.min(3, Math.floor(calciumScore)),
             Math.min(1.0, calciumScore / 10),
             dnaRootId,
             new Date().toISOString()]
          );
          sqlite.writeRaw('UPDATE conversations SET is_promoted = 1 WHERE id = ?', [conv.id]);
          promoted++;
        } catch { /* 去重跳过 */ }
      }

      sqlite.writeRaw('COMMIT');
      if (promoted > 0) {
        console.log(`[MemoryAssessor] 砂金→金库: ${promoted} 条 (calcium>=1)`);
      }
    } catch (err) {
      console.warn('[MemoryAssessor] 砂金→金库失败:', err);
    }
  }

  // --- ② 金库→黑钻（新规格: calcium ≥ 4.5 或 recall ≥ 5）---

  private async runGoldToDiamond(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      const entries = autoPromoteCandidatesV2(sqlite, 5);
      if (entries.length > 0) {
        console.log(`[MemoryAssessor] 金库→黑钻: ${entries.length} 条 (钙化>=4.5或召回>=5)`);
      }
    } catch (err) {
      console.warn('[MemoryAssessor] 金库→黑钻失败:', err);
    }
  }

  // --- ③ 钙化分衰减（新规格: 场景差异化）---

  private async runDecay(): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      const now = new Date().toISOString();

      // 强烈情感记忆 (calcium >= 3) → 极慢衰减 -0.02
      sqlite.writeRaw(
        `UPDATE memories SET calcium_score = ROUND(MAX(0, calcium_score - 0.02), 1),
         effective_strength = ROUND(MAX(0.1, effective_strength * 0.995), 4),
         strength_updated_at = ?
         WHERE calcium_score > 0 AND is_promoted = 0 AND calcium_score >= 3.0`,
        [now]
      );

      // 工作相关记忆 → 慢衰减 -0.05
      sqlite.writeRaw(
        `UPDATE memories SET calcium_score = ROUND(MAX(0, calcium_score - 0.05), 1),
         effective_strength = ROUND(MAX(0.1, effective_strength * 0.985), 4),
         strength_updated_at = ?
         WHERE calcium_score > 0 AND is_promoted = 0 AND calcium_score < 3.0
         AND (COALESCE(narrative_tag, '') LIKE '%工作%' OR COALESCE(narrative_tag, '') LIKE '%项目%'
              OR COALESCE(narrative_tag, '') LIKE '%公司%' OR COALESCE(narrative_tag, '') LIKE '%会议%')`,
        [now]
      );

      // 普通中性记忆 → 正常衰减 -0.10
      sqlite.writeRaw(
        `UPDATE memories SET calcium_score = ROUND(MAX(0, calcium_score - 0.10), 1),
         effective_strength = ROUND(MAX(0.1, effective_strength * 0.95), 4),
         strength_updated_at = ?
         WHERE calcium_score > 0 AND is_promoted = 0 AND calcium_score < 3.0
         AND (COALESCE(narrative_tag, '') NOT LIKE '%工作%' AND COALESCE(narrative_tag, '') NOT LIKE '%项目%'
              AND COALESCE(narrative_tag, '') NOT LIKE '%公司%' AND COALESCE(narrative_tag, '') NOT LIKE '%会议%')`,
        [now]
      );

      console.log('[MemoryAssessor] 钙化分衰减完成: 情感-0.02, 工作-0.05, 中性-0.10');
    } catch (err) {
      console.warn('[MemoryAssessor] 钙化分衰减失败:', err);
    }
  }

  async triggerSandToGold(): Promise<number> {
    await this.runSandToGold();
    const sqlite = this.storage.getSQLite();
    const count = sqlite.queryAll('SELECT COUNT(*) as c FROM memories') as any[];
    return count[0]?.c || 0;
  }

  async triggerGoldToDiamond(): Promise<number> {
    await this.runGoldToDiamond();
    const sqlite = this.storage.getSQLite();
    const count = sqlite.queryAll('SELECT COUNT(*) as c FROM black_diamond') as any[];
    return count[0]?.c || 0;
  }
}
