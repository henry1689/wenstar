/**
 * EmbeddingProvider — 嵌入提供者（双层策略 + 监控）
 *
 * P0: 首选 DeepSeek API (1536维真实语义)
 *     降级 本地词级 TF-IDF N-gram 256维（API不可用时）
 *
 * S2-2: 新增 embedding 健康监控 + N-gram升级为词级别TF-IDF
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): boolean;
  readonly dimension: number;
}

// ═══ S2-2: Embedding 健康统计 ═══
export interface EmbeddingStats {
  apiSuccess: number;
  apiFail: number;
  lastApiSuccess: number | null;
  lastApiFail: number | null;
  currentProvider: 'api' | 'local';
  totalCalls: number;
}

let _embeddingStats: EmbeddingStats = {
  apiSuccess: 0,
  apiFail: 0,
  lastApiSuccess: null,
  lastApiFail: null,
  currentProvider: 'local',
  totalCalls: 0,
};

export function getEmbeddingStats(): EmbeddingStats {
  return { ..._embeddingStats };
}

// 中文常见停用词（用于词级特征提取）
const CN_STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '有', '不', '就',
  '也', '和', '这', '那', '都', '要', '会', '对', '上', '下', '去', '来',
  '能', '做', '说', '到', '看', '知', '道', '给', '为', '与', '之', '其',
  '一个', '可以', '这个', '那个', '没有', '不是', '但是', '而且', '因为',
  '所以', '如果', '虽然', '然后', '还是', '只是', '就是', '已经', '什么',
  '怎么', '自己', '我们', '他们', '她们', '你们', '时候', '这样', '那样',
]);

/** S2-2: 简单中文分词（按标点/虚词切分） */
function simpleTokenize(text: string): string[] {
  // 先按标点切分
  const segments = text.split(/[，。！？、；：""''（）\s\r\n,.!?;:()]+/g).filter(s => s.length > 0);
  // 再按停用词进一步切分
  const tokens: string[] = [];
  for (const seg of segments) {
    let current = '';
    for (const ch of seg) {
      if (CN_STOP_WORDS.has(ch)) {
        if (current.length >= 2) tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.length >= 2) tokens.push(current);
  }
  return tokens;
}

/** S2-2: 词级 TF-IDF 特征提取替代原来的字符级 2-gram+3-gram */
function extractWordNgrams(tokens: string[], maxFeatures = 1000): Map<string, number> {
  const freq = new Map<string, number>();
  // 单词语义：每个词单独作为一个特征
  for (const token of tokens) {
    if (!CN_STOP_WORDS.has(token)) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }
  // 词对语义：相邻词组合
  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = tokens[i] + tokens[i + 1];
    if (pair.length >= 3) {
      freq.set(pair, (freq.get(pair) || 0) + 1);
    }
  }
  // 保留高频特征
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const result = new Map<string, number>();
  for (const [k, v] of sorted.slice(0, maxFeatures)) result.set(k, v);
  return result;
}

function tfidfToVector(ngrams: Map<string, number>, dim = 256, totalTokens: number): number[] {
  const vec = new Array(dim).fill(0);
  // 全局文档频率（模拟IDF：长词/罕见词权重更高）
  const totalDocs = 100;
  let idx = 0;
  for (const [gram, count] of ngrams) {
    // TF: 词频/总词数
    const tf = count / Math.max(totalTokens, 1);
    // IDF模拟: 长词的"文档频率"更低（更罕见）
    const docFreq = Math.max(1, totalDocs - gram.length * 5);
    const idf = Math.log(totalDocs / docFreq);
    // TF-IDF 哈希到向量
    let hash = 5381;
    for (let i = 0; i < gram.length; i++) {
      hash = ((hash << 5) + hash) + gram.charCodeAt(i);
    }
    const pos = Math.abs(hash) % dim;
    vec[pos] += tf * idf;
    idx++;
    if (idx >= 2000) break;
  }
  // L2 归一化
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) { for (let i = 0; i < dim; i++) vec[i] /= norm; }
  return vec;
}

function localEmbed(text: string): number[] {
  // 保留原文中的中文/英文/数字
  const cleanText = text.replace(/[^一-鿿\w]/g, ' ').toLowerCase();
  const tokens = simpleTokenize(cleanText);
  if (tokens.length === 0) {
    // 兜底：字符级2-gram
    return charLevelEmbed(cleanText);
  }
  const ngrams = extractWordNgrams(tokens);
  return tfidfToVector(ngrams, 256, tokens.length);
}

/** 兜底：字符级 2-gram（极短文本或无有效token时） */
function charLevelEmbed(text: string): number[] {
  const normalized = text.replace(/[\s\r\n]+/g, '');
  const freq = new Map<string, number>();
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2);
    freq.set(gram, (freq.get(gram) ?? 0) + 1);
  }
  const vec = new Array(256).fill(0);
  let idx = 0;
  for (const [gram, count] of freq) {
    let hash = 0;
    for (let i = 0; i < gram.length; i++) {
      hash = ((hash << 5) - hash) + gram.charCodeAt(i);
    }
    vec[Math.abs(hash) % 256] += Math.log(1 + count);
    idx++;
    if (idx >= 500) break;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) { for (let i = 0; i < 256; i++) vec[i] /= norm; }
  return vec;
}

/**
 * 创建嵌入提供者
 * - DeepSeek v4 无 embedding API（经测试 404），统一使用本地词级 TF-IDF (256维)
 * - DEEPSEEK_API_KEY 已配置但仅用于聊天，不用于嵌入
 *
 * TF-IDF 256 维本地嵌入对于 ngram 关键词匹配效果足够，
 * 配合 weightedSearch 的全表扫描 + 情感向量 + 印象值三重排序效果良好。
 */
export function createLocalEmbedding(): EmbeddingProvider {
  const LOCAL_DIMENSION = 256;

  // DeepSeek v4 无 embedding API（经测试 404），统一使用本地词级 TF-IDF (256维)

  async function embed(text: string): Promise<number[]> {
    _embeddingStats.totalCalls++;
    // 直接使用本地词级 TF-IDF（已验证 DeepSeek v4 无 embedding API）
    _embeddingStats.currentProvider = 'local';
    return localEmbed(text);
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    _embeddingStats.currentProvider = 'local';
    for (const t of texts) results.push(localEmbed(t));
    return results;
  }

  function isAvailable(): boolean { return true; }

  return {
    embed,
    embedBatch,
    isAvailable,
    dimension: LOCAL_DIMENSION,
  };
}
