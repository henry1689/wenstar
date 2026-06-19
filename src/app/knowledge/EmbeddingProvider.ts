/**
 * EmbeddingProvider — 嵌入提供者（双层策略）
 *
 * P0: 首选 DeepSeek API (1536维真实语义)
 *     降级 本地 N-gram 256维（API不可用时）
 *
 * 设计原则：这是识别类工具，不是创造类。
 * 嵌入是将文本转为向量用于相似度检索，属于分类/识别范畴。
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): boolean;
  readonly dimension: number;
}

/** 本地 N-gram 特征提取（降级方案） */
function extractNgrams(text: string, maxFeatures = 2000): Map<string, number> {
  const freq = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const gram = text.slice(i, i + 2);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }
  for (let i = 0; i < text.length - 2; i++) {
    const gram = text.slice(i, i + 3);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const result = new Map<string, number>();
  for (const [k, v] of sorted.slice(0, maxFeatures)) result.set(k, v);
  return result;
}

function ngramsToVector(ngrams: Map<string, number>, dim = 256): number[] {
  const vec = new Array(dim).fill(0);
  let idx = 0;
  for (const [gram, count] of ngrams) {
    let hash = 0;
    for (let i = 0; i < gram.length; i++) {
      hash = ((hash << 5) - hash) + gram.charCodeAt(i);
      hash = hash & hash;
    }
    const pos = Math.abs(hash) % dim;
    vec[pos] += Math.log(1 + count);
    idx++;
    if (idx >= 2000) break;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) { for (let i = 0; i < dim; i++) vec[i] /= norm; }
  return vec;
}

function localEmbed(text: string): number[] {
  const normalized = text.replace(/[\s\r\n]+/g, '').toLowerCase();
  const ngrams = extractNgrams(normalized);
  return ngramsToVector(ngrams, 256);
}

/**
 * 创建双层策略嵌入提供者
 * - 首选 DeepSeek API (1536维)
 * - 降级 本地 N-gram (256维)
 */
export function createLocalEmbedding(): EmbeddingProvider {
  const API_DIMENSION = 1536;
  const LOCAL_DIMENSION = 256;

  async function embed(text: string): Promise<number[]> {
    // 首选：DeepSeek API
    try {
      const key = typeof process !== 'undefined' && process.env ? process.env['DEEPSEEK_API_KEY'] : undefined;
      if (key) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('https://api.deepseek.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'deepseek-embedding', input: text }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          if (data?.data?.[0]?.embedding) return data.data[0].embedding;
        }
      }
    } catch { /* 静默降级到本地 */ }
    // 降级：本地 N-gram
    return localEmbed(text);
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // DeepSeek API 批量
    try {
      const key = typeof process !== 'undefined' && process.env ? process.env['DEEPSEEK_API_KEY'] : undefined;
      if (key && texts.length > 0) {
        const BATCH_SIZE = 20;
        for (let i = 0; i < texts.length; i += BATCH_SIZE) {
          const batch = texts.slice(i, i + BATCH_SIZE);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch('https://api.deepseek.com/v1/embeddings', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'deepseek-embedding', input: batch }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data = await res.json();
            if (data?.data) {
              for (const d of data.data) results.push(d.embedding);
              continue;
            }
          }
          // 批量失败，逐条降级
          for (const t of batch) results.push(localEmbed(t));
        }
        return results;
      }
    } catch { /* 批量失败 */ }
    // 降级：逐条本地嵌入
    for (const t of texts) results.push(localEmbed(t));
    return results;
  }

  function isAvailable(): boolean { return true; }

  return {
    embed,
    embedBatch,
    isAvailable,
    dimension: API_DIMENSION,
  };
}
