/**
 * Reranker — 规则密集型检索重排
 *
 * 在 SQLite 初筛结果上，应用三条规则重新打分：
 * 1. 因果关联提权：记忆中含有"因为""导致""所以"等因果词时加分
 * 2. 时间连续性加分：连续时间内的记忆相关性更高
 * 3. 实体深度共现：超出简单重叠的深度实体匹配加分
 *
 * 纯规则，零 LLM，零模型加载。
 */
import type { ScoredMemory } from '../m2/types/index.js';

/** 因果关键词 */
const CAUSAL_WORDS = ['因为', '所以', '导致', '因此', '于是', '结果', '从而', '引起', '造成', '为了'];

/** 强转折/对比关键词（上下文相关性可能降低） */
const CONTRAST_WORDS = ['但是', '可是', '然而', '不过', '却', '反而'];

export interface RerankWeights {
  causalBoost: number;     // 因果匹配额外加分
  temporalBonus: number;   // 时间连续加分
  entityDeepBonus: number; // 实体深度匹配加分
}

const DEFAULT_WEIGHTS: RerankWeights = {
  causalBoost: 0.15,
  temporalBonus: 0.10,
  entityDeepBonus: 0.10,
};

/**
 * 对情感检索结果进行重排
 * @param results 初筛评分结果
 * @param currentInput 当前用户输入原文
 * @param weights 可选权重覆盖
 * @returns 重排后的结果（直接修改原数组，避免深拷贝）
 */
export function rerank(
  results: ScoredMemory[],
  currentInput: string,
  weights?: Partial<RerankWeights>,
): ScoredMemory[] {
  if (results.length <= 1) return results;

  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const lowerInput = currentInput.toLowerCase();

  // 当前输入的因果词
  const inputCausalWords = CAUSAL_WORDS.filter(cw => lowerInput.includes(cw));

  // 为每条结果计算额外加分
  for (const item of results) {
    const raw = item.record.raw_input?.toLowerCase() ?? '';
    let bonus = 0;

    // 1. 因果关联提权
    //    当前输入有因果词 且 记忆也有因果词 → 加分
    if (inputCausalWords.length > 0) {
      const memoryCausalHits = CAUSAL_WORDS.filter(cw => raw.includes(cw)).length;
      if (memoryCausalHits > 0) {
        bonus += w.causalBoost * Math.min(1, memoryCausalHits / 2);
      }
    }

    // 2. 时间连续性加分
    //    记忆创建时间越接近现在，加分越多（线性衰减，2小时内有效）
    try {
      const created = new Date(item.record.created_at).getTime();
      const now = Date.now();
      const hoursAgo = (now - created) / (1000 * 3600);
      if (hoursAgo < 2) {
        bonus += w.temporalBonus * (1 - hoursAgo / 2);
      }
    } catch (err) { console.warn("[Reranker] 重排失败:", err); }

    // 3. 实体深度匹配加分
    //    不只是简单重叠，而是看实体在记忆中是否处于"关键位置"（即 phenotype=enhance）
    const currentEntityNames = extractEntities(currentInput, item.record.entity_genes);
    if (currentEntityNames.length > 0) {
      const deepMatches = item.record.entity_genes.filter(
        g => currentEntityNames.includes(g.name) && g.phenotype === 'enhance',
      ).length;
      if (deepMatches > 0) {
        bonus += w.entityDeepBonus * Math.min(1, deepMatches / 2);
      }
    }

    // 4. 对比词降权
    const contrastHits = CONTRAST_WORDS.filter(cw => raw.includes(cw)).length;
    if (contrastHits > 0) {
      bonus -= 0.05 * contrastHits;
    }

    // 5. 场景贴合度：记忆的 calcium_level 高说明同样情感强烈，加分
    if (item.record.calcium_level >= 2) {
      bonus += 0.10;
    }

    // 应用加分
    item.composite = Math.min(1, Math.max(0, item.composite + bonus));
  }

  // 重排序
  return results.sort((a, b) => b.composite - a.composite);
}

/**
 * 从用户输入中提取实体名称（与已有 entity_genes 做对照）
 */
function extractEntities(input: string, existingGenes: Array<{ name: string }>): string[] {
  const lower = input.toLowerCase();
  return existingGenes
    .map(g => g.name)
    .filter(name => name.length > 0 && lower.includes(name.toLowerCase()));
}
