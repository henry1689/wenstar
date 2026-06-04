/**
 * EmbeddingProvider — 嵌入提供者
 *
 * 使用本地中文 N-gram 频率向量作为嵌入（零外部依赖）。
 * 基于字符 Bigram + Trigram 统计，对中文语义相似度效果良好。
 *
 * 如需更高质量嵌入，可替换为 OpenAI/其他 Embedding API。
 */

export interface EmbeddingProvider {
  /** 将文本转为向量 */
  embed(text: string): Promise<number[]>;
  /** 批量文本转向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** 是否可用 */
  isAvailable(): boolean;
  /** 向量维度 */
  readonly dimension: number;
}

/** N-gram 特征提取：字符 bigram + trigram */
function extractNgrams(text: string, maxFeatures = 2000): Map<string, number> {
  const freq = new Map<string, number>();

  // Bigrams
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }

  // Trigrams
  for (let i = 0; i < text.length - 2; i++) {
    const gram = text.slice(i, i + 3);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }

  // 限制特征数
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const result = new Map<string, number>();
  for (const [k, v] of sorted.slice(0, maxFeatures)) {
    result.set(k, v);
  }
  return result;
}

/** 从 N-gram 频率图生成固定维度向量 */
function ngramsToVector(ngrams: Map<string, number>, dim = 256): number[] {
  const vec = new Array(dim).fill(0);
  let idx = 0;
  for (const [gram, count] of ngrams) {
    // 用 gram 的哈希值决定位置
    let hash = 0;
    for (let i = 0; i < gram.length; i++) {
      hash = ((hash << 5) - hash) + gram.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    const pos = Math.abs(hash) % dim;
    vec[pos] += Math.log(1 + count); // log 频率减少长文本偏差
    idx++;
    if (idx >= 2000) break; // 最多用 2000 个特征
  }
  // L2 归一化
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] /= norm;
  }
  return vec;
}

/**
 * 创建本地嵌入提供者
 *
 * 基于中文 N-gram 统计，零外部依赖，同步计算。
 */
export function createLocalEmbedding(): EmbeddingProvider {
  const dimension = 256;

  function embed(text: string): Promise<number[]> {
    const normalized = text.replace(/[\s\r\n]+/g, '').toLowerCase();
    const ngrams = extractNgrams(normalized);
    const vec = ngramsToVector(ngrams, dimension);
    return Promise.resolve(vec);
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const t of texts) {
      results.push(await embed(t));
    }
    return results;
  }

  function isAvailable(): boolean {
    return true; // 本地嵌入永远可用
  }

  return { embed, embedBatch, isAvailable, dimension };
}
