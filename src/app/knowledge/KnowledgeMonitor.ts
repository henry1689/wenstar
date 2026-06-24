/**
 * KnowledgeMonitor — 知识库健康监控（S2-4）
 *
 * 自检、统计、告警一体化。
 * 独立于 KnowledgeEngine，可被健康检查API直接调用。
 */
import type { VectorStore } from './VectorStore.js';
import { getEmbeddingStats } from './EmbeddingProvider.js';

export interface KnowledgeHealthReport {
  /** 总条目数 */
  totalItems: number;
  /** 总分块数 */
  totalChunks: number;
  /** 有embedding的分块数 */
  chunksWithEmbedding: number;
  /** embedding覆盖率（%） */
  embeddingRatio: number;
  /** 未分类条目数 */
  unclassifiedCount: number;
  /** 90天以上未分类的垃圾条数 */
  expiredCount: number;
  /** 向量索引中的条数 */
  vectorMemoryCount: number;
  /** 当前embedding提供商 */
  embeddingProvider: string;
  /** API成功率（%） */
  apiSuccessRate: number;
  /** 健康状态 */
  health: 'healthy' | 'degraded' | 'critical';
  /** 检查时间 */
  timestamp: string;
  /** 错误详情（如果有的话） */
  issues: string[];
}

export class KnowledgeMonitor {
  private sqlite: any;
  private vectorStore: VectorStore;

  constructor(sqlite: any, vectorStore: VectorStore) {
    this.sqlite = sqlite;
    this.vectorStore = vectorStore;
  }

  /** 全量自检 */
  selfCheck(): KnowledgeHealthReport {
    const issues: string[] = [];

    // 基础计数
    const totalItems = (this.sqlite.queryAll('SELECT COUNT(*) as c FROM knowledge_base')[0]?.c as number) || 0;
    const totalChunks = (this.sqlite.queryAll('SELECT COUNT(*) as c FROM knowledge_chunks')[0]?.c as number) || 0;
    const chunksWithEmbedding = (this.sqlite.queryAll("SELECT COUNT(*) as c FROM knowledge_chunks WHERE embedding IS NOT NULL")[0]?.c as number) || 0;
    const unclassifiedCount = (this.sqlite.queryAll("SELECT COUNT(*) as c FROM knowledge_base WHERE classification_pending = 1")[0]?.c as number) || 0;

    // 90天以上未分类的垃圾
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
    const expiredCount = (this.sqlite.queryAll("SELECT COUNT(*) as c FROM knowledge_base WHERE classification_pending = 1 AND created_at < ?", [cutoff])[0]?.c as number) || 0;

    const vectorMemoryCount = this.vectorStore.size();

    // Embedding 状态
    const embStats = getEmbeddingStats();
    const totalApiCalls = embStats.apiSuccess + embStats.apiFail;
    const apiSuccessRate = totalApiCalls > 0 ? Math.round(embStats.apiSuccess / totalApiCalls * 100) : 0;
    const embeddingRatio = totalChunks > 0 ? Math.round(chunksWithEmbedding / totalChunks * 100) : 0;

    // 诊断问题
    if (totalChunks === 0 && totalItems > 0) {
      issues.push('有知识条目但无分块（可能索引未完成）');
    }
    if (embeddingRatio < 100) {
      issues.push(`embedding覆盖率仅 ${embeddingRatio}%（${totalChunks - chunksWithEmbedding} 个分块缺失）`);
    }
    if (apiSuccessRate === 0 && totalApiCalls > 0) {
      issues.push('DeepSeek Embedding API 全部失败，持续使用本地N-gram降级');
    }
    if (unclassifiedCount > totalItems * 0.5 && totalItems > 0) {
      issues.push(`超过50%的知识条目未分类（${unclassifiedCount}/${totalItems}）`);
    }
    if (expiredCount > 0) {
      issues.push(`有 ${expiredCount} 条超过90天未分类的垃圾条目待清理`);
    }
    if (embStats.currentProvider === 'local') {
      issues.push('当前使用本地N-gram embedding（非API）');
    }

    // 健康判定
    let health: 'healthy' | 'degraded' | 'critical';
    if (embeddingRatio === 100 && apiSuccessRate > 0 && issues.length <= 1) {
      health = 'healthy';
    } else if (embeddingRatio > 0 && totalItems > 0) {
      health = 'degraded';
    } else {
      health = 'critical';
    }

    return {
      totalItems,
      totalChunks,
      chunksWithEmbedding,
      embeddingRatio,
      unclassifiedCount,
      expiredCount,
      vectorMemoryCount,
      embeddingProvider: embStats.currentProvider,
      apiSuccessRate,
      health,
      timestamp: new Date().toISOString(),
      issues,
    };
  }

  /** 修复缺失的embedding */
  async repairMissingEmbeddings(): Promise<number> {
    const missing = this.sqlite.queryAll(
      "SELECT id, kn_id, chunk_text FROM knowledge_chunks WHERE embedding IS NULL LIMIT 100"
    );
    let fixed = 0;
    for (const row of missing) {
      try {
        const { createLocalEmbedding } = await import('./EmbeddingProvider.js');
        const embed = createLocalEmbedding();
        const vec = await embed.embed(row.chunk_text as string);
        this.sqlite.writeRaw(
          "UPDATE knowledge_chunks SET embedding = ? WHERE id = ?",
          [JSON.stringify(vec), row.id as string]
        );
        fixed++;
      } catch (err) {
        console.warn('[KnowledgeMonitor] 修复失败:', err);
      }
    }
    return fixed;
  }
}
