/**
 * RAGPipeline — 混合检索管道
 *
 * 向量语义 + 关键词 LIKE + 情绪相似度 三重混合。
 * API 不可用时自动降级回纯 LIKE 搜索。
 */
import type { EmbeddingProvider } from './EmbeddingProvider.js';
import { VectorStore } from './VectorStore.js';
import type { KnowledgeItem } from './types.js';

export interface RAGSearchResult {
  item: KnowledgeItem;
  score: number;
  source: 'vector' | 'keyword' | 'hybrid';
}

/** 从 tags 中解析情绪上下文标签 */
function parseEmotionTag(tags: string[]): { pleasure: number; arousal: number; intimacy: number } | null {
  for (const tag of tags) {
    const m = tag.match(/^emotion:p([\d.-]+)_a([\d.-]+)_i([\d.-]+)$/);
    if (m) {
      return {
        pleasure: parseFloat(m[1]),
        arousal: parseFloat(m[2]),
        intimacy: parseFloat(m[3]),
      };
    }
  }
  return null;
}

/** 计算两个情绪状态之间的相似度 (0,1) */
function emotionalSimilarity(
  a: { pleasure: number; arousal: number; intimacy: number },
  b: { pleasure: number; arousal: number; intimacy: number },
): number {
  const dot = a.pleasure * b.pleasure + a.arousal * b.arousal + a.intimacy * b.intimacy;
  const normA = Math.sqrt(a.pleasure ** 2 + a.arousal ** 2 + a.intimacy ** 2);
  const normB = Math.sqrt(b.pleasure ** 2 + b.arousal ** 2 + b.intimacy ** 2);
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, dot / (normA * normB));
}

/**
 * 混合搜索（支持情绪相似度加成）
 * @param currentPerception 当前情绪状态，用于情绪关联提升
 */
export async function hybridSearch(
  query: string,
  embed: EmbeddingProvider,
  vectorStore: VectorStore,
  keywordSearch: (keyword: string, limit: number) => KnowledgeItem[],
  limit = 3,
  currentPerception?: { pleasure: number; arousal: number; intimacy: number },
): Promise<KnowledgeItem[]> {
  // ── 1. 关键词路径（始终可用） ──
  const keywordResults = keywordSearch(query, limit * 3);

  // ── 2. 向量路径（API 可用时） ──
  let vectorResults: Array<{ item: KnowledgeItem; score: number }> = [];
  if (embed.isAvailable()) {
    try {
      const queryVec = await embed.embed(query);
      if (queryVec.length > 0) {
        const hits = vectorStore.similaritySearch(queryVec, limit * 3);
        for (const hit of hits) {
          const knId = hit.id.split('_')[0];
          const found = keywordResults.find(k => k.id === knId)
            ?? (await findByIdFallback(keywordSearch, knId));
          if (found && !vectorResults.some(v => v.item.id === found.id)) {
            // 情绪相似度加成
            let emotionalBoost = 0;
            if (currentPerception) {
              const storedEmotion = parseEmotionTag(found.tags);
              if (storedEmotion) {
                emotionalBoost = emotionalSimilarity(currentPerception, storedEmotion) * 0.15;
              }
            }
            vectorResults.push({ item: found, score: hit.score + emotionalBoost });
          }
        }
      }
    } catch (err) {
      console.warn('[RAG] 向量搜索失败，降级为纯关键词:', err);
    }
  }

  // ── 3. 混合 ──
  if (vectorResults.length === 0) {
    return keywordResults.slice(0, limit);
  }

  // 情绪加成后重新排序
  vectorResults.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const merged: Array<{ item: KnowledgeItem; score: number }> = [];

  for (const v of vectorResults) {
    if (!seen.has(v.item.id)) {
      seen.add(v.item.id);
      merged.push(v);
    }
  }

  if (merged.length < limit) {
    for (const k of keywordResults) {
      if (!seen.has(k.id)) {
        seen.add(k.id);
        merged.push({ item: k, score: 0.3 });
      }
      if (merged.length >= limit) break;
    }
  }

  return merged.slice(0, limit).map(m => m.item);
}

async function findByIdFallback(
  searchFn: (keyword: string, limit: number) => KnowledgeItem[],
  id: string,
): Promise<KnowledgeItem | undefined> {
  const recent = searchFn('', 50);
  return recent.find(r => r.id === id);
}
