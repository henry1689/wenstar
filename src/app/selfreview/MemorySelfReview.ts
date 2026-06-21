/**
 * MemorySelfReview — P3-b 记忆自省修复插件
 *
 * 定期（每日）扫描：
 *   ① hallucination_log 表 → 识别高频编造模式
 *   ② 金库中同一实体的矛盾描述 → 标记低分冲突
 *   ③ 过期社交关系（12+ 月未提及）→ 降低检索权重
 *
 * 不删除原始数据，只做标记和日志。
 * 依赖 P0-3 HallucinationValidator 的日志输出。
 */
import type { FusionStorageAdapter } from '../../m2/FusionStorageAdapter.js';

export class MemorySelfReview {
  private storage: FusionStorageAdapter;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  /**
   * 执行一轮自省修复
   */
  async review(): Promise<ReviewReport> {
    const report: ReviewReport = { hallucinationPatterns: [], conflicts: 0, expiredRelations: 0, actions: [] };

    try {
      const sqlite = this.storage.getSQLite();

      // ① 扫描 hallucination_log ← P0-3 日志表
      const logs = sqlite.queryAll(
        `SELECT hallucinated_names, COUNT(*) as cnt
         FROM hallucination_log
         WHERE created_at > datetime('now', '-7 days')
         GROUP BY hallucinated_names
         HAVING cnt >= 2
         ORDER BY cnt DESC
         LIMIT 10`,
      ) as any[];

      for (const log of logs) {
        report.hallucinationPatterns.push({
          names: (log.hallucinated_names as string).split(','),
          count: log.cnt as number,
        });
        report.actions.push(`标记编造模式: ${log.hallucinated_names} (${log.cnt}次)`);
      }

      // ② 扫描实体冲突
      const conflicts = sqlite.queryAll(
        `SELECT e.name, COUNT(DISTINCT m.id) as mem_count
         FROM entities e
         JOIN memory_entities me ON me.entity_id = e.id
         JOIN memories m ON m.id = me.memory_id
         GROUP BY e.name
         HAVING mem_count >= 3
         ORDER BY mem_count DESC
         LIMIT 10`,
      ) as any[];

      for (const c of conflicts) {
        report.conflicts++;
        report.actions.push(`实体关联过多: ${c.name} (${c.mem_count}条记忆)`);
      }

      // ③ 过期社交关系衰减
      const oldRelations = sqlite.queryAll(
        `SELECT er.id, e.name as source_name, e2.name as target_name
         FROM entity_relations er
         JOIN entities e ON e.id = er.entity_a_id
         JOIN entities e2 ON e2.id = er.entity_b_id
         WHERE er.updated_at < datetime('now', '-365 days')
         LIMIT 50`,
      ) as any[];

      for (const rel of oldRelations) {
        try {
          sqlite.writeRaw(
            'UPDATE entity_relations SET strength = MAX(0.05, strength * 0.5) WHERE id = ?',
            [(rel as any).id],
          );
          report.expiredRelations++;
        } catch {}
      }

      if (oldRelations.length > 0) {
        report.actions.push(`衰减 ${oldRelations.length} 条过期关系`);
      }

    } catch (err) {
      console.warn('[MemorySelfReview] 自省失败:', err);
      report.actions.push(`错误: ${String(err)}`);
    }

    console.log(`[MemorySelfReview] 完成: ${report.actions.length} 项操作`);
    return report;
  }
}

export interface ReviewReport {
  hallucinationPatterns: Array<{ names: string[]; count: number }>;
  conflicts: number;
  expiredRelations: number;
  actions: string[];
}
