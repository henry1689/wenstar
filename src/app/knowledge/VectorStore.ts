/**
 * VectorStore — 内存向量存储
 *
 * 用 Float64Array 存储嵌入向量，搜索时线性扫描计算余弦相似度。
 * 文档数 <10K 时性能足够，零外部依赖。
 *
 * 支持操作：
 *   upsert(id, vector) — 插入或更新
 *   remove(id)         — 删除
 *   similaritySearch(queryVec, topK) — 搜索最相似的 topK 条
 *   clear()            — 清空
 *   size()             — 条目数
 */

interface VectorEntry {
  id: string;
  vector: Float64Array;
}

export class VectorStore {
  private items: VectorEntry[] = [];

  /** 插入或更新向量 */
  upsert(id: string, vector: number[]): void {
    const idx = this.items.findIndex(e => e.id === id);
    const entry: VectorEntry = { id, vector: new Float64Array(vector) };
    if (idx >= 0) {
      this.items[idx] = entry;
    } else {
      this.items.push(entry);
    }
  }

  /** 批量 upsert */
  upsertBatch(entries: Array<{ id: string; vector: number[] }>): void {
    for (const e of entries) this.upsert(e.id, e.vector);
  }

  /** 删除向量 */
  remove(id: string): boolean {
    const idx = this.items.findIndex(e => e.id === id);
    if (idx >= 0) {
      this.items.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** 按 ID 清除多个 */
  removeByPrefix(prefix: string): number {
    const before = this.items.length;
    this.items = this.items.filter(e => !e.id.startsWith(prefix));
    return before - this.items.length;
  }

  /**
   * 搜索最相似的 topK 条
   * 返回 [{ id, score }]，score ∈ [0, 1]
   */
  similaritySearch(queryVec: number[], topK = 10): Array<{ id: string; score: number }> {
    if (this.items.length === 0 || queryVec.length === 0) return [];

    const q = new Float64Array(queryVec);
    const scored: Array<{ id: string; score: number }> = [];

    for (const entry of this.items) {
      const score = cosineSimilarity(q, entry.vector);
      if (score > 0) {
        scored.push({ id: entry.id, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** 获取向量以供调试 */
  getVector(id: string): Float64Array | undefined {
    return this.items.find(e => e.id === id)?.vector;
  }

  /** 清空全部 */
  clear(): void {
    this.items = [];
  }

  /** 条目数 */
  size(): number {
    return this.items.length;
  }
}

/** 余弦相似度 */
function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
