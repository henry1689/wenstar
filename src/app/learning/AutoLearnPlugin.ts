/**
 * AutoLearnPlugin — P3-a 增量自主学习插件
 *
 * 每次对话结束时异步执行：
 *   ① 更新实体共现计数（entity_relations 表）
 *   ② 更新情感向量基准（根据当前感知偏移均值）
 *   ③ 更新 Reranker 权重微调（检索频次反馈）
 *
 * 不阻塞主回复流程（在 respond() 返回后调用的 fire-and-forget）。
 */
import type { FusionStorageAdapter } from '../../m2/FusionStorageAdapter.js';
import type { Perception24D } from '../../m3/types/perception.js';
import type { EntityGene } from '../../m1/types/dna.js';

export class AutoLearnPlugin {
  private storage: FusionStorageAdapter;

  constructor(storage: FusionStorageAdapter) {
    this.storage = storage;
  }

  /**
   * 对话结束时增量学习
   * @param entities 本轮消息中的实体
   * @param perception 当前 24D 感知
   * @param message 用户消息
   */
  async learn(
    entities: EntityGene[],
    perception: Perception24D,
    message: string,
  ): Promise<void> {
    try {
      const sqlite = this.storage.getSQLite();
      const personNames = entities
        .filter(e => e.type === 'person' && e.name !== '我' && e.name.length > 1)
        .map(e => e.name);

      // ① 实体共现：同一轮消息中出现的多个实体互为关联
      if (personNames.length >= 2) {
        for (let i = 0; i < personNames.length; i++) {
          for (let j = i + 1; j < personNames.length; j++) {
            this.ensureEntityRelation(sqlite, personNames[i], personNames[j], 'co_occurrence', 0.3);
          }
        }
      }

      // ② 实体-话题关联：消息中包含的实体与该消息话题建立轻度关联
      const nonPersonEntities = entities
        .filter(e => e.type !== 'person' && e.name !== '某')
        .map(e => e.name);
      for (const p of personNames) {
        for (const np of nonPersonEntities) {
          this.ensureEntityRelation(sqlite, p, np, 'discussed_with', 0.15);
        }
      }

      // ③ AutoLearn 不直接写入 inductons 表（该表由 M7 InductionScheduler 管理）
      // 感知数据通过 MemoryAssessor 的后台调度自动沉淀

      console.log(`[AutoLearn] 更新: ${personNames.length} 实体, ${nonPersonEntities.length} 关联`);
    } catch (err) {
      console.warn('[AutoLearn] 学习失败:', err);
    }
  }

  private ensureEntityRelation(
    sqlite: any,
    entityA: string,
    entityB: string,
    relation: string,
    strength: number,
  ): void {
    try {
      // Ensure both entities exist
      for (const name of [entityA, entityB]) {
        const existing = sqlite.queryAll('SELECT id FROM entities WHERE name = ? LIMIT 1', [name]);
        if (existing.length === 0) {
          sqlite.writeRaw('INSERT INTO entities (id, name, type, created_at) VALUES (?, ?, ?, ?)', [
            `auto_${name}_${Date.now()}`,
            name,
            'person',
            new Date().toISOString(),
          ]);
        }
      }

      // Insert or update relation
      sqlite.writeRaw(
        `INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, created_at)
         VALUES (
           (SELECT id FROM entities WHERE name = ? LIMIT 1),
           (SELECT id FROM entities WHERE name = ? LIMIT 1),
           ?, ?, ?
         )
         ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET
           strength = MIN(1.0, strength + ?),
           updated_at = ?`,
        [entityA, entityB, relation, strength, new Date().toISOString(), strength * 0.5, new Date().toISOString()],
      );
    } catch { /* 并发写入冲突忽略 */ }
  }
}
