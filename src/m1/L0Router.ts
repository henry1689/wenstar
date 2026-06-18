// Ref: ARCH.md §3.1 L0 基因组锚点
// Ref: 架构决策备忘录 v1.1（修正版决策①）—— 纯规则路由，禁止LLM介入
// Ref: 架构决策备忘录 v1.2 —— 初始2层深度，版本化管理

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { L0RouteResult, TaxonomyTree } from './types/dna.js';
import { loadL0Rules, loadSet } from './LexiconLoader.js';

// 强情感极性词（用于L0无匹配时的情感兜底路由）
// 从 emotion_lexicon.json 验证存在性，与 M3/L3 同源
const STRONG_NEGATIVE = ['难过', '伤心', '痛苦', '绝望', '焦虑', '抑郁', '崩溃', '无助', '生气', '愤怒', '恐惧', '哭'];
const STRONG_POSITIVE = ['开心', '快乐', '幸福', '感动', '兴奋', '温暖', '甜蜜', '美好', '太好了'];
// 验证：确保 emotion_lexicon.json 包含所有情感词（开发阶段发现漂移）
(function validateLexicon() {
  const negSet = loadSet('emotion_lexicon.json', 'negative_words');
  const posSet = loadSet('emotion_lexicon.json', 'positive_words');
  const missingNeg = STRONG_NEGATIVE.filter(w => !negSet.has(w));
  const missingPos = STRONG_POSITIVE.filter(w => !posSet.has(w));
  if (missingNeg.length > 0 || missingPos.length > 0) {
    console.warn(`[L0Router] 词表漂移警告 — emotion_lexicon.json 缺少: ${[...missingNeg, ...missingPos].join(', ')}`);
  }
})();

// ─── 当前文件所在目录 ───
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── 分类树配置路径 ───
const DEFAULT_TAXONOMY_PATH = join(__dirname, 'config', 'taxonomy_v1.json');

// ─── 默认兜底分类树（当文件缺失时使用）───
const FALLBACK_TAXONOMY: TaxonomyTree = {
  version: '0.0-fallback',
  description: '内存默认分类树（文件加载失败时启用）',
  tree: {
    user: {
      family: ['general'],
      emotion: ['neutral'],
      work: ['general'],
      misc: ['default'],
    },
  },
};

// ─── 关键词规则库 ───
// 每个规则包含：匹配关键词列表、目标domain、目标subcategory、规则ID
// Ref: ARCH.md §4.2 确定性路由核心逻辑

interface KeywordRule {
  id: string;
  keywords: string[];
  domain: string;
  subcategory: string;
  /** 权重优先级（数字越小优先级越高） */
  priority: number;
}
const KEYWORD_RULES = loadL0Rules();

/** 内存缓存的分类树（惰性加载） */
let cachedTaxonomy: TaxonomyTree | null = null;

/**
 * 加载认知分类树
 * 内部使用惰性缓存：首次加载后缓存到内存，后续调用直接返回缓存。
 * 外部可注入自定义路径覆盖缓存，默认从config目录加载。
 * 文件缺失时使用内存默认树（不崩溃）。
 * Ref: ARCH.md §4.2 确定性路由，架构决策备忘录 v1.2
 */
export function loadTaxonomy(customPath?: string): TaxonomyTree {
  // 无自定义路径且缓存命中 → 直接返回
  if (!customPath && cachedTaxonomy) return cachedTaxonomy;

  const targetPath = customPath ?? DEFAULT_TAXONOMY_PATH;
  try {
    if (!existsSync(targetPath)) {
      console.warn(`[L0Router] taxonomy.json not found at ${targetPath}, using fallback.`);
      return FALLBACK_TAXONOMY;
    }
    const raw = readFileSync(targetPath, 'utf-8');
    const taxonomy: TaxonomyTree = JSON.parse(raw);

    // 校验基本结构
    if (!taxonomy.version || !taxonomy.tree) {
      throw new Error('Invalid taxonomy structure: missing version or tree');
    }

    // 仅缓存默认路径的加载结果
    if (!customPath) cachedTaxonomy = taxonomy;
    return taxonomy;
  } catch (err) {
    console.warn(`[L0Router] Failed to load taxonomy: ${err instanceof Error ? err.message : String(err)}`);
    return FALLBACK_TAXONOMY;
  }
}

/** 清除分类树缓存（用于测试热更新） */
export function clearTaxonomyCache(): void {
  cachedTaxonomy = null;
}

/**
 * 规范化输入文本：转小写、去除多余空白
 */
function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

interface BestMatchResult {
  rule: KeywordRule;
  matchedKeywords: string[];
}

/**
 * 统计匹配的规则，按优先级排序返回最佳匹配
 * 返回前两名用于 ambiguity 计算
 */
function findBestMatchingRule(text: string): { best: BestMatchResult | null; secondBest: BestMatchResult | null } {
  const lowerText = text.toLowerCase();
  const matched: BestMatchResult[] = [];

  for (const rule of KEYWORD_RULES) {
    const matchedKws = rule.keywords.filter((kw) => lowerText.includes(kw.toLowerCase()));
    if (matchedKws.length > 0) {
      matched.push({ rule, matchedKeywords: matchedKws });
    }
  }

  if (matched.length === 0) return { best: null, secondBest: null };

  // 按优先级排序（数字越小优先级越高）
  // 相同优先级下，匹配关键词数量越多越优先
  matched.sort((a, b) => {
    const priorityDiff = a.rule.priority - b.rule.priority;
    if (priorityDiff !== 0) return priorityDiff;
    return b.matchedKeywords.length - a.matchedKeywords.length;
  });

  return {
    best: matched[0],
    secondBest: matched.length > 1 ? matched[1] : null,
  };
}

/**
 * 验证生成的locus_path是否存在于给定的分类树中
 * 如果不存在则回退到该domain的general子分类或misc
 * Ref: ARCH.md §4.2 降级兜底
 */
function validatePath(tree: TaxonomyTree, domain: string, subcategory: string): string {
  const domainNode = tree.tree['user']?.[domain];
  if (!domainNode) {
    return 'user.misc.default';
  }
  if (!domainNode.includes(subcategory)) {
    // domain存在但subcategory不存在，使用该domain的general或第一个可用节点
    if (domainNode.includes('general')) return `user.${domain}.general`;
    return `user.${domain}.${domainNode[0]}`;
  }
  return `user.${domain}.${subcategory}`;
}

/**
 * L0 基因组锚点生成器
 *
 * 基于规则和分类树的确定性路由，将用户话语映射到认知拓扑坐标。
 * 不含任何LLM调用，给定相同输入始终返回相同结果。
 *
 * @param utterance - 用户输入文本
 * @param taxonomyTree - 认知分类树（可选，默认从文件加载）
 * @returns L0路由结果
 *
 * Ref: ARCH.md §3.1 L0基因组锚点
 * Ref: 架构决策备忘录 v1.1（修正版）
 */
export function routeL0(
  utterance: string,
  taxonomyTree?: TaxonomyTree
): L0RouteResult {
  const tree = taxonomyTree ?? loadTaxonomy();
  const text = normalizeText(utterance);

  if (!text) {
    return {
      locus_path: 'user.misc.default',
      taxonomy_version: tree.version,
      rule_id: 'empty-input-fallback',
      is_fallback: true,
    };
  }

  // 第一阶段：尝试关键词规则匹配（含 ambiguity 计算）
  const { best: bestMatch, secondBest: secondMatch } = findBestMatchingRule(text);

  if (bestMatch) {
    const { rule } = bestMatch;
    const locus_path = validatePath(tree, rule.domain, rule.subcategory);

    // 计算 ambiguity_score：仅有多条匹配时才需要计算
    let ambiguity_score = 0;
    if (secondMatch) {
      const priorityGap = secondMatch.rule.priority - rule.priority;
      if (priorityGap <= 0) {
        // 同一优先级 → 高模糊
        ambiguity_score = 0.7 + Math.min(0.3, (1 - secondMatch.matchedKeywords.length / Math.max(1, bestMatch.matchedKeywords.length)) * 0.3);
      } else if (priorityGap === 1) {
        // 差1级 → 中模糊
        ambiguity_score = 0.4;
      } else {
        // 差≥2级 → 低模糊
        ambiguity_score = 0.1;
      }
    }

    return {
      locus_path,
      taxonomy_version: tree.version,
      rule_id: rule.id,
      is_fallback: locus_path === 'user.misc.default',
      ambiguity_score,
    };
  }

  // 第二阶段：纯情感极性探测（当没有明确domain匹配时）
  // 使用强情感词（来自 emotion_lexicon.json 验证的子集，与 M3/L3 同源）
  const hasStrongNeg = STRONG_NEGATIVE.some((w) => text.includes(w));
  const hasStrongPos = STRONG_POSITIVE.some((w) => text.includes(w));

  if (hasStrongNeg && !hasStrongPos) {
    const path = validatePath(tree, 'emotion', 'negative');
    return {
      locus_path: path,
      taxonomy_version: tree.version,
      rule_id: 'emotion-negative-fallback',
      is_fallback: false,
    };
  }
  if (hasStrongPos && !hasStrongNeg) {
    const path = validatePath(tree, 'emotion', 'positive');
    return {
      locus_path: path,
      taxonomy_version: tree.version,
      rule_id: 'emotion-positive-fallback',
      is_fallback: false,
    };
  }

  // 第三阶段：完全未匹配 → misc兜底
  return {
    locus_path: 'user.misc.default',
    taxonomy_version: tree.version,
    rule_id: 'misc-default-fallback',
    is_fallback: true,
  };
}
