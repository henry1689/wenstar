// PerceptionAnalyzer — 24维语义感知 + 钙质强度计算
// Ref: 24维语义感知与钙质强度定义规范
//
// ╔═══════════════════════════════════════════════════════╗
// ║  PerceptionAnalyzer.ts  v1.0                          ║
// ║  归属: M3 (逻辑决策层) — M1只做L0-L3编码             ║
// ║  变更: 从 M1 迁移至 M3 (架构纠偏)                    ║
// ║  原因: 24维感知是M3逻辑层的"眼睛"，不是M1编码层的"手" ║
// ║  日期: 2026-06-02                                    ║
// ╚═══════════════════════════════════════════════════════╝
//
// 设计原则:
// - 纯规则驱动，不调用任何LLM/ML模型
// - 所有评分基于关键词匹配 + 逻辑判断
// - 确定性：相同输入永远返回相同结果
// - 独立模块：只负责计算，不负责存储
//
// 调用时间: M2 存储完成后 → M3LogicOrchestrator 调用此分析器
// 不被 M1 调用，不在编码阶段执行

import type { DNA } from '../m1/types/dna.js';
import { loadSet } from '../m1/LexiconLoader.js';
/** 词级命中统计（用于调试 24D 感知分析 — 记录每个词在真实输入中命中了多少次） */
const wordHitCounters = new Map<string, number>();
export function getHitReport(): Record<string, number> {
  const report = Object.fromEntries(wordHitCounters);
  wordHitCounters.clear(); // 读取后清零，方便观测增量
  return report;
}
import type {
  Perception24D,
  EnhancedDNA,
  CalciumResult,
  CalciumLevel,
  M3Context,
} from './types/perception.js';

// ════════════════════════════════════════════════════════
// 第一层：情感极性词表
// ════════════════════════════════════════════════════════

const POSITIVE_WORDS = loadSet('emotion_lexicon.json', 'positive_words');

const NEGATIVE_WORDS = loadSet('emotion_lexicon.json', 'negative_words');

const HIGH_AROUSAL_WORDS = loadSet('emotion_lexicon.json', 'high_arousal');

const LOW_AROUSAL_WORDS = loadSet('emotion_lexicon.json', 'low_arousal');

const DOMINANT_WORDS = loadSet('emotion_lexicon.json', 'dominant');

const SUBMISSIVE_WORDS = loadSet('emotion_lexicon.json', 'submissive');

const AGGRESSION_WORDS = loadSet('emotion_lexicon.json', 'aggression');

const SINCERITY_WORDS = loadSet('emotion_lexicon.json', 'sincerity');

const HUMOR_WORDS = loadSet('emotion_lexicon.json', 'humor');

const CERTAIN_WORDS = loadSet('emotion_lexicon.json', 'certain');

const HEDGE_WORDS = loadSet('emotion_lexicon.json', 'hedge');

const LOGICAL_WORDS = loadSet('emotion_lexicon.json', 'logical');

const ABSTRACT_WORDS = loadSet('emotion_lexicon.json', 'abstract');

const TEMPORAL_PAST = loadSet('emotion_lexicon.json', 'temporal_past');

const TEMPORAL_FUTURE = loadSet('emotion_lexicon.json', 'temporal_future');

const INTIMACY_WORDS = loadSet('emotion_lexicon.json', 'intimacy');

const DEPENDENCY_WORDS = loadSet('emotion_lexicon.json', 'dependency');

const MORAL_POSITIVE = loadSet('emotion_lexicon.json', 'moral_positive');

const MORAL_NEGATIVE = loadSet('emotion_lexicon.json', 'moral_negative');

const ETIQUETTE_WORDS = loadSet('emotion_lexicon.json', 'etiquette');

const SEXUAL_ATTRACTION = loadSet('emotion_lexicon.json', 'sexual_attraction');

const SENSORY_CRAVING = loadSet('emotion_lexicon.json', 'sensory_craving');

const ENERGY_MERGE = loadSet('emotion_lexicon.json', 'energy_merge');

const POSSESSIVENESS = loadSet('emotion_lexicon.json', 'possessiveness');

const ECSTASY_WORDS = loadSet('emotion_lexicon.json', 'ecstasy');

const SAFETY_WORDS = loadSet('emotion_lexicon.json', 'safety');

const INSECURITY_WORDS = loadSet('emotion_lexicon.json', 'insecurity');

const SUPPRESSED_WORDS = loadSet('emotion_lexicon.json', 'suppressed_words');

// ════════════════════════════════════════════════════════
// 第二层：辅助函数
// ════════════════════════════════════════════════════════

/** 统计词集在文本中的匹配次数，并记录每个匹配词到调试面板 */
function countHits(text: string, wordSet: Set<string>): number {
  let hits = 0;
  for (const word of wordSet) {
    if (text.includes(word)) {
      hits++;
      wordHitCounters.set(word, (wordHitCounters.get(word) ?? 0) + 1);
    }
  }
  return hits;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** ① NaN/undefined/Infinity 安全钳 */
function safeVal(v: any, fallback: number = 0): number {
  if (typeof v !== 'number' || isNaN(v) || !isFinite(v)) return fallback;
  return v;
}

function normalizeHits(hits: number, max: number = 5): number {
  return clamp(hits / max, 0, 1);
}

function countFirstPerson(text: string): number {
  const patterns = ['我', '我自己', '我的', '我想', '我觉得', '我认为', '我感'];
  let count = 0;
  for (const p of patterns) {
    let idx = 0;
    while ((idx = text.indexOf(p, idx)) !== -1) {
      count++;
      idx += p.length;
    }
  }
  return count;
}

function countWe(text: string): number {
  const patterns = ['我们', '咱们', '大家一起', '我俩'];
  let count = 0;
  for (const p of patterns) {
    let idx = 0;
    while ((idx = text.indexOf(p, idx)) !== -1) {
      count++;
      idx += p.length;
    }
  }
  return count;
}

// ════════════════════════════════════════════════════════
// 第三层：24维评分引擎
// ════════════════════════════════════════════════════════

class EmotionScorer {
  static pleasure(text: string): number {
    const pos = countHits(text, POSITIVE_WORDS);
    const neg = countHits(text, NEGATIVE_WORDS);
    if (pos === 0 && neg === 0) return 0;
    const total = pos + neg;
    return clamp((pos - neg) / Math.max(total, 1), -1, 1);
  }

  static arousal(text: string): number {
    const high = countHits(text, HIGH_AROUSAL_WORDS);
    const low = countHits(text, LOW_AROUSAL_WORDS);
    const exclamationCount = (text.match(/！|!/g) || []).length;
    const hasEmoji = /[😡😭😤🔥😍🥰😘😱]/g.test(text);
    let score = 0;
    score += normalizeHits(high) * 0.5;
    score += clamp(exclamationCount * 0.1, 0, 0.3);
    if (hasEmoji) score += 0.2;
    if (low > 0) score = Math.max(0, score - normalizeHits(low) * 0.3);
    return clamp(score, 0, 1);
  }

  static dominance(text: string): number {
    const dom = countHits(text, DOMINANT_WORDS);
    const sub = countHits(text, SUBMISSIVE_WORDS);
    if (dom === 0 && sub === 0) return 0;
    const total = dom + sub;
    return clamp((dom - sub) / Math.max(total, 1), -1, 1);
  }

  static aggression(text: string): number {
    return normalizeHits(countHits(text, AGGRESSION_WORDS), 3);
  }

  static sincerity(text: string): number {
    const sincere = countHits(text, SINCERITY_WORDS);
    const firstPerson = countFirstPerson(text);
    let score = 0.5;
    score += normalizeHits(sincere) * 0.3;
    score += clamp(firstPerson * 0.05, 0, 0.2);
    return clamp(score, 0, 1);
  }

  static humor(text: string): number {
    return normalizeHits(countHits(text, HUMOR_WORDS), 3);
  }

  static all(text: string): Pick<Perception24D, 'pleasure' | 'arousal' | 'dominance' | 'aggression' | 'sincerity' | 'humor'> {
    return {
      pleasure: this.pleasure(text),
      arousal: this.arousal(text),
      dominance: this.dominance(text),
      aggression: this.aggression(text),
      sincerity: this.sincerity(text),
      humor: this.humor(text),
    };
  }
}

class CognitionScorer {
  /**
   * 事实性评分：只认具体日期/时间/量化数据，不认随意数字。
   * 避免"加班到10点"、"第3次"这种主观叙述被误判为事实性高。
   */
  static factual(text: string): number {
    // 具体日期/时间/量化模式（不匹配"1个"、"2天"这类随意数）
    const datePattern = /\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d{4}年/;
    const timePattern = /\d{1,2}:\d{2}(:\d{2})?|\d{1,2}点\d{0,2}分/;
    const quantPattern = /第\d+[次轮个位]|\d+[天小时分周月元年]|\d+(\.\d+)[%％]|\d{4,}/;
    const hasSpecificFact = datePattern.test(text) || timePattern.test(text) || quantPattern.test(text);
    let score = 0.2;
    if (hasSpecificFact) score += 0.3;
    // 长文本整体倾向叙事，加分幅度缩小
    if (text.length > 40) score += 0.1;
    // 情感词密集 → 主观表达，降低事实性
    const emoCount = countHits(text, POSITIVE_WORDS) + countHits(text, NEGATIVE_WORDS);
    if (emoCount >= 2) score = Math.max(0.1, score - emoCount * 0.1);
    return clamp(score, 0, 1);
  }

  static logical(text: string): number {
    return normalizeHits(countHits(text, LOGICAL_WORDS), 4);
  }

  static certainty(text: string): number {
    const certain = countHits(text, CERTAIN_WORDS);
    const hedge = countHits(text, HEDGE_WORDS);
    let score = 0.5;
    score += normalizeHits(certain, 3) * 0.3;
    score -= normalizeHits(hedge, 3) * 0.4;
    return clamp(score, 0, 1);
  }

  static abstract(text: string): number {
    return clamp(normalizeHits(countHits(text, ABSTRACT_WORDS), 3), 0, 1);
  }

  static temporalFocus(text: string): number {
    const past = countHits(text, TEMPORAL_PAST);
    const future = countHits(text, TEMPORAL_FUTURE);
    if (past === 0 && future === 0) return 0;
    return clamp((future - past) / Math.max(past + future, 1), -1, 1);
  }

  static selfRef(text: string): number {
    return clamp(countFirstPerson(text) * 0.15, 0, 1);
  }

  static all(text: string): Pick<Perception24D, 'factual' | 'logical' | 'certainty' | 'abstract' | 'temporal_focus' | 'self_ref'> {
    return {
      factual: this.factual(text),
      logical: this.logical(text),
      certainty: this.certainty(text),
      abstract: this.abstract(text),
      temporal_focus: this.temporalFocus(text),
      self_ref: this.selfRef(text),
    };
  }
}

class SocialScorer {
  static intimacy(text: string): number {
    return normalizeHits(countHits(text, INTIMACY_WORDS), 3);
  }

  static powerDiff(text: string): number {
    const dom = countHits(text, DOMINANT_WORDS);
    const sub = countHits(text, SUBMISSIVE_WORDS);
    if (dom === 0 && sub === 0) return 0;
    return clamp((dom - sub) / Math.max(dom + sub, 1), -1, 1);
  }

  static dependency(text: string): number {
    return normalizeHits(countHits(text, DEPENDENCY_WORDS), 3);
  }

  static moralJudgment(text: string): number {
    const pos = countHits(text, MORAL_POSITIVE);
    const neg = countHits(text, MORAL_NEGATIVE);
    if (pos === 0 && neg === 0) return 0;
    return clamp((pos - neg) / Math.max(pos + neg, 1), -1, 1);
  }

  static etiquette(text: string): number {
    return normalizeHits(countHits(text, ETIQUETTE_WORDS), 4);
  }

  static belonging(text: string): number {
    const weCount = countWe(text);
    const iCount = countFirstPerson(text);
    let score = 0;
    if (weCount > 0) score += clamp(weCount * 0.2, 0, 0.6);
    if (iCount > weCount * 3) score *= 0.5;
    return clamp(score, 0, 1);
  }

  static all(text: string): Pick<Perception24D, 'intimacy' | 'power_diff' | 'dependency' | 'moral_judgment' | 'etiquette' | 'belonging'> {
    return {
      intimacy: this.intimacy(text),
      power_diff: this.powerDiff(text),
      dependency: this.dependency(text),
      moral_judgment: this.moralJudgment(text),
      etiquette: this.etiquette(text),
      belonging: this.belonging(text),
    };
  }
}

class IntimacyScorer {
  static sexualAttraction(text: string): number {
    return normalizeHits(countHits(text, SEXUAL_ATTRACTION), 3);
  }

  static sensoryCraving(text: string): number {
    return normalizeHits(countHits(text, SENSORY_CRAVING), 3);
  }

  static energyMerge(text: string): number {
    return normalizeHits(countHits(text, ENERGY_MERGE), 3);
  }

  static possessiveness(text: string): number {
    return normalizeHits(countHits(text, POSSESSIVENESS), 3);
  }

  static ecstasy(text: string): number {
    return normalizeHits(countHits(text, ECSTASY_WORDS), 3);
  }

  static safety(text: string): number {
    const safe = countHits(text, SAFETY_WORDS);
    const insecure = countHits(text, INSECURITY_WORDS);
    let score = 0.5;
    score += normalizeHits(safe) * 0.3;
    score -= normalizeHits(insecure) * 0.4;
    return clamp(score, 0, 1);
  }

  static all(text: string): Pick<Perception24D, 'sexual_attraction' | 'sensory_craving' | 'energy_merge' | 'possessiveness' | 'ecstasy' | 'safety'> {
    return {
      sexual_attraction: this.sexualAttraction(text),
      sensory_craving: this.sensoryCraving(text),
      energy_merge: this.energyMerge(text),
      possessiveness: this.possessiveness(text),
      ecstasy: this.ecstasy(text),
      safety: this.safety(text),
    };
  }
}

// ════════════════════════════════════════════════════════
// 第四层：钙质强度计算
// ════════════════════════════════════════════════════════

/** 钙质计算可配置参数 — 支持阈值偏移和分数加成 */
export interface CalciumConfig {
  /** 等级阈值偏移（各等级阈值加此值，负值=更敏感） */
  thresholdOffset?: number;
  /** 直接钙质分数加成（场景/个性化修正，不改变维度计算） */
  scoreBonus?: number;
}

function calculateCalcium(p: Perception24D, config?: CalciumConfig): CalciumResult {
  // ① NaN/undefined 安全钳：所有维度值先经过 safeVal
  const pleasure = safeVal(p.pleasure);
  const arousal = safeVal(p.arousal);
  const dominance = safeVal(p.dominance);
  const aggression = safeVal(p.aggression);
  const sincerity = safeVal(p.sincerity);
  const humor = safeVal(p.humor);
  const factual = safeVal(p.factual);
  const logical = safeVal(p.logical);
  const certainty = safeVal(p.certainty);
  const abstract = safeVal(p.abstract);
  const temporalFocus = safeVal(p.temporal_focus);
  const selfRef = safeVal(p.self_ref);
  const safety = safeVal(p.safety, 0.5);
  const sexualAttraction = safeVal((p as any).sexual_attraction);

  // M3 自有的钙化公式（含威胁检测）
  const avgEmotion = (
    Math.abs(pleasure) + arousal + Math.abs(dominance) +
    aggression + sincerity + humor
  ) / 6;
  const avgCognition = (
    factual + logical + certainty + abstract +
    Math.abs(temporalFocus) + selfRef
  ) / 6;
  const baseCore = avgEmotion * 0.3 + avgCognition * 0.3;

  const emotionalBoost = Math.max(
    Math.abs(pleasure), arousal, Math.abs(dominance), aggression
  ) * 0.4;

  // 威胁检测
  const threatBonus =
    (aggression > 0.7 || safety < 0.2 || sexualAttraction > 0.8)
      ? 0.3 : 0.0;

  let score = clamp(baseCore + emotionalBoost + threatBonus, 0, 1);

  // P1: 可配置的分数加成
  if (config?.scoreBonus) {
    score = clamp(score + config.scoreBonus, 0, 1);
  }

  // ③ 自检校准：发现系统性偏差时微调分数
  score = selfCheck(score, { pleasure, aggression, sincerity, arousal, temporalFocus, safety });

  // ④ 边界标记计算（不改变 level，仅提供参考）
  const inBoundary = (score > 0.28 && score < 0.32) || (score > 0.58 && score < 0.62) || (score > 0.78 && score < 0.82);
  const boundaryHint = inBoundary ? 'boundary' : undefined;

  // 可配置的阈值偏移
  const t0 = 0.3 + (config?.thresholdOffset ?? 0);
  const t1 = 0.6 + (config?.thresholdOffset ?? 0);
  const t2 = 0.8 + (config?.thresholdOffset ?? 0);

  let level: CalciumLevel;
  if (score < t0) level = 0;
  else if (score < t1) level = 1;
  else if (score < t2) level = 2;
  else level = 3;

  return {
    score,
    level,
    breakdown: {
      base_core: Math.round(baseCore * 1000) / 1000,
      emotional_boost: Math.round(emotionalBoost * 1000) / 1000,
      threat_bonus: Math.round(threatBonus * 1000) / 1000,
    },
  };
}

/**
 * ③ 钙质自检校准：发现系统低估/高估时微调
 * 不改变计算方法，只做边界修正
 */
function selfCheck(score: number, ctx: { pleasure: number; aggression: number; sincerity: number; arousal: number; temporalFocus: number; safety: number }): number {
  // 场景A：pleasure 很低但 aggression 也低、sincerity 高 → 可能是压抑/委屈
  // 这种场景钙质容易被低估，上调 0.05
  if (ctx.pleasure < -0.2 && ctx.aggression < 0.1 && ctx.sincerity > 0.5) {
    return Math.min(1, score + 0.05);
  }
  // 场景B：所有维度都接近中性（0.35~0.65），score 不应超过 0.5
  // 防止偶然匹配导致误判
  const nearNeutral = Math.abs(ctx.pleasure) < 0.15 && ctx.arousal < 0.35 && ctx.aggression < 0.1;
  if (nearNeutral && score > 0.5) {
    return Math.min(0.5, score - 0.1);
  }
  // 场景C：安全指数极低且 pleasure 也低 → 情绪强度可能更大
  if (ctx.safety < 0.3 && ctx.pleasure < -0.3) {
    return Math.min(1, score + 0.03);
  }
  return score;
}

// ════════════════════════════════════════════════════════
// 第五层：PerceptionAnalyzer 主类
// ════════════════════════════════════════════════════════

/**
 * 感知分析器 — 将 M1 原始 DNA 增强为 EnhancedDNA
 *
 * 这是一个 M3 逻辑层的工具类，不在 M1 编码阶段执行。
 * 由 M3LogicOrchestrator 在 M2 存储完成后调用。
 *
 * 输入: DNA 对象（branch_id, locus_path, raw_input, entity_genes）
 * 输出: EnhancedDNA 对象（含 24 维感知 + 钙质强度）
 *
 * 三步走算法:
 * 1. 语境剥离 (Context Stripping): 忽略位置信息，只看 raw_input
 * 2. 情感着色 (Emotional Coloring): 结合语气词和实体基因
 * 3. 潜意识扫描 (Subconscious Scanning): 代词和隐喻扫描
 *
 * v1.1 新增: 场景感知调整 — analyze() 从 dna 读取 locus_path 和 scene_tags，
 * 在 24D 基线值上按场景微调（不改变核心关键词匹配算法）。
 * P3 新增: 隐性情绪检测 — 当显性正负情感词少但隐忍词命中时，调整感知基线。
 * Ref: M1 场景标签扩展 P0, M2 情感曲谱改善 P3
 */
export class PerceptionAnalyzer {
  /**
   * 分析一条 DNA，产出增强型 DNA
   * 支持传入可选 sceneTags 覆盖 dna.scene_tags（供调试用）
   */
  analyze(dna: DNA, sceneTags?: string[]): EnhancedDNA {
    const text = dna.raw_input;
    const emotion = EmotionScorer.all(text);
    const cognition = CognitionScorer.all(text);
    const social = SocialScorer.all(text);
    const intimacy = IntimacyScorer.all(text);
    const perception: Perception24D = { ...emotion, ...cognition, ...social, ...intimacy };

    // ── 场景感知基线调整（不改变核心算法，仅在基线层修正） ──
    const tags = sceneTags ?? dna.scene_tags;
    let calciumConfig: CalciumConfig | undefined;
    if (tags && tags.length > 0) {
      calciumConfig = this.applySceneAdjustments(perception, dna.locus_path, tags);
    }

    // ── P3: 隐性情绪检测 — 显性情感词少但隐忍词命中时，调整基线 ──
    const suppressedHits = countHits(text, SUPPRESSED_WORDS);
    if (suppressedHits > 0) {
      const posHits = countHits(text, POSITIVE_WORDS);
      const negHits = countHits(text, NEGATIVE_WORDS);
      // 显性情感词≤2且隐忍词≥1 → 有隐性情绪
      if (posHits + negHits <= 2) {
        perception.pleasure = Math.min(perception.pleasure - 0.2, 0);
        perception.sincerity = Math.min(perception.sincerity + 0.1, 1.0);
        perception.safety = Math.max(perception.safety - 0.1, 0);
        console.log(`[隐性情绪] 检测到${suppressedHits}个隐忍词, pleasure下调至${perception.pleasure.toFixed(2)}`);
      }
    }

    return {
      branch_id: dna.branch_id,
      locus_path: dna.locus_path,
      raw_input: dna.raw_input,
      entity_genes: dna.entity_genes,
      perception,
      calcium_score: 0, // 占位 — decide() 中 context 注入后统一计算
      calcium_level: 0,
      calcium_config: calciumConfig,
    };
  }

  /** 批量分析多条 DNA */
  analyzeBatch(dnas: DNA[]): EnhancedDNA[] {
    return dnas.map((dna) => this.analyze(dna));
  }

  /** 直接分析原始文本（快捷方式，仅用于测试/调试） */
  analyzeText(text: string, sceneTags?: string[]): EnhancedDNA {
    const mockDNA: DNA = {
      locus_path: 'user.misc.default',
      taxonomy_version: '1.0',
      branch_id: 'evt_00000000_000',
      seq_pos: 0,
      leaf_zone: 'language_semantic_zone',
      ref: 'tmp_na_00000',
      entity_genes: [],
      raw_input: text,
      created_at: new Date().toISOString(),
      scene_tags: sceneTags,
    };
    const enhanced = this.analyze(mockDNA);
    const calcium = calculateCalcium(enhanced.perception);
    enhanced.calcium_score = calcium.score;
    enhanced.calcium_level = calcium.level;
    return enhanced;
  }

  /**
   * 场景感知基线调整 — 从 dna.locus_path + scene_tags 微调 24D 基线 + 钙质偏移。
   *
   * 不改变核心关键词匹配算法，只在基线值上做场景修正。
   * P0: 场景标签组合 → 特定维度基线偏移
   * P1: 场景组合 → 钙质阈值偏移（使重要场景更敏感）
   *
   * @returns 钙质配置（阈值偏移 + 分数加成），用于后续钙质重算
   */
  private applySceneAdjustments(p: Perception24D, locusPath: string, tags: string[]): CalciumConfig {
    const tagSet = new Set(tags);
    let thresholdOffset = 0;
    let scoreBonus = 0;

    // ── 亲密/浪漫场景 → intimacy/ecstasy 基线上调 ──
    if (tagSet.has('亲密') || tagSet.has('浪漫')) {
      p.intimacy = Math.min(p.intimacy + 0.2, 1.0);
      p.ecstasy = Math.min(p.ecstasy + 0.1, 1.0);
      thresholdOffset += 0.05; // 稍微降低阈值，感性场景更容易被重视
    }

    // ── 思念场景 → temporal_focus 偏向过去，intimacy 上调 ──
    if (tagSet.has('思念')) {
      p.temporal_focus = Math.min(p.temporal_focus - 0.2, -0.1);
      p.intimacy = Math.min(p.intimacy + 0.15, 1.0);
      scoreBonus += 0.05; // 思念类情绪稍微提升权重
    }

    // ── 健身/运动场景 → arousal 上调 ──
    if (tagSet.has('健身') || tagSet.has('运动')) {
      p.arousal = Math.min(p.arousal + 0.1, 1.0);
    }

    // ── 倦怠/疲惫场景 → dominance/sincerity 下调 ──
    if (tagSet.has('倦怠') || tagSet.has('疲惫')) {
      p.dominance = Math.max(p.dominance - 0.15, -0.5);
      p.arousal = Math.max(p.arousal - 0.1, 0);
      scoreBonus += 0.05; // 疲惫场景值得更多关注
    }

    // ── 压抑/倾诉场景 → pleasure 下调，sincerity 上调 ──
    if (tagSet.has('压抑') || tagSet.has('倾诉')) {
      p.pleasure = Math.min(p.pleasure - 0.15, 0);
      p.sincerity = Math.min(p.sincerity + 0.15, 1.0);
      thresholdOffset += 0.1; // 压抑情绪很容易被低估，大幅降低阈值
    }

    // ── 工作/开发场景 → factual/certainty 上调 ──
    if (tagSet.has('开发') || tagSet.has('工作')) {
      p.factual = Math.min(p.factual + 0.1, 1.0);
      p.certainty = Math.min(p.certainty + 0.1, 1.0);
    }

    // ── 家庭矛盾场景 → dominance 下调，negative 加重 ──
    if (locusPath === 'user.family.conflict') {
      p.dominance = Math.max(p.dominance - 0.1, -0.5);
      p.aggression = Math.min(p.aggression + 0.1, 1.0);
      scoreBonus += 0.1;
    }

    return { thresholdOffset, scoreBonus };
  }

  /**
   * 注入决策上下文到增强型 DNA 中
   *
   * 根据 M3Context 中的时间、地点信息，修正感知维度。
   *
   * Ref: M3-design-v1.md §4.2
   */
  injectContext(enhanced: EnhancedDNA, context?: M3Context): void {
    if (!context) return;

    const text = enhanced.raw_input;

    // 时效性规则：时间词修正 C5 temporal_focus — 统一使用 emotion_lexicon.json 中的时间词集
    if (text.includes('今天') || text.includes('现在')) {
      enhanced.perception.temporal_focus = Math.max(enhanced.perception.temporal_focus, 0.2);
    }
    if (text.includes('刚才') || text.includes('刚刚')) {
      enhanced.perception.arousal = Math.min(enhanced.perception.arousal + 0.1, 1.0);
    }
    if (countHits(text, TEMPORAL_FUTURE) > 0) {
      enhanced.perception.temporal_focus = Math.max(enhanced.perception.temporal_focus, 0.3);
    }
    if (countHits(text, TEMPORAL_PAST) > 0) {
      enhanced.perception.temporal_focus = Math.min(enhanced.perception.temporal_focus, -0.2);
    }

    // 地点感知规则：本地地点提升 S6 belonging
    if (context.current_location) {
      const hasLocalPlace = enhanced.entity_genes.some(
        (e) => e.type === 'place' && e.name === context.current_location
      );
      if (hasLocalPlace) {
        enhanced.perception.belonging = Math.min(enhanced.perception.belonging + 0.15, 1.0);
        enhanced.perception.intimacy = Math.min(enhanced.perception.intimacy + 0.1, 1.0);
      }
    }

    // 情感基线异常检测
    if (context.emotion_baseline) {
      const base = context.emotion_baseline;
      const pDelta = Math.abs(enhanced.perception.pleasure - base.avg_pleasure);
      const aDelta = Math.abs(enhanced.perception.arousal - base.avg_arousal);
      if (pDelta > 0.5 || aDelta > 0.4) {
        enhanced.perception.arousal = Math.min(enhanced.perception.arousal + 0.15, 1.0);
      }
    }
  }

  /** 获取钙质强度的中文描述 */
  static describeLevel(level: CalciumLevel): string {
    switch (level) {
      case 0: return '粉末 — 忽略/合并';
      case 1: return '液体 — 流动/理解';
      case 2: return '固体 — 记忆/回应';
      case 3: return '晶体 — 刻录/行动';
    }
  }

  /**
   * P2: 从 24D 感知向量推导主情绪和次要情绪标签（30+ 规则）。
   * 纯规则，基于各维度阈值组合判定。
   * 注意：所有 a_safeVal 确保 NaN 不会导致规则跳过。
   */
  static deriveEmotionLabels(perception: Perception24D): { primary: string | undefined; secondary: string[] | undefined } {
    const p = perception;
    // 数据安全读取（防 NaN）
    const pleasure = safeVal(p.pleasure);
    const arousal = safeVal(p.arousal);
    const intimacy = safeVal(p.intimacy);
    const aggression = safeVal(p.aggression);
    const sincerity = safeVal(p.sincerity);
    const safety = safeVal(p.safety, 0.5);
    const sexual_attraction = safeVal((p as any).sexual_attraction);
    const sensory_craving = safeVal((p as any).sensory_craving);
    const energy_merge = safeVal((p as any).energy_merge);
    const possessiveness = safeVal((p as any).possessiveness);
    const ecstasy = safeVal((p as any).ecstasy);
    const dominance = safeVal(p.dominance);
    const temporal_focus = safeVal(p.temporal_focus);
    const self_ref = safeVal(p.self_ref);
    const dependency = safeVal(p.dependency);
    const humor = safeVal(p.humor);

    const emotions: string[] = [];

    // ── 强烈负面情绪 ──
    // 委屈：痛苦+低唤醒+高亲密（说不出的难受）
    if (pleasure < -0.5 && arousal < 0.4 && intimacy > 0.4) emotions.push('委屈');
    // 愤怒：痛苦+高攻击性
    if (pleasure < -0.4 && aggression > 0.3) emotions.push('愤怒');
    // 焦虑：痛苦+高唤醒+不安全
    if (pleasure < -0.3 && arousal > 0.5 && safety < 0.4) emotions.push('焦虑');
    // 不安：轻微痛苦+低安全感
    if (pleasure < -0.2 && safety < 0.3) emotions.push('不安');
    // 恐惧：极低安全+高唤醒
    if (pleasure < -0.3 && safety < 0.2 && arousal > 0.5) emotions.push('恐惧');
    // 沮丧：中等痛苦+低攻击+低唤醒+高真诚
    if (pleasure < -0.4 && aggression < 0.2 && arousal < 0.4 && sincerity > 0.3) emotions.push('沮丧');
    // 愧疚：痛苦+低攻击+高真诚+时间偏过去
    if (pleasure < -0.2 && aggression < 0.1 && sincerity > 0.6 && temporal_focus < -0.2) emotions.push('愧疚');
    // 无奈：痛苦+低唤醒+低支配
    if (pleasure < -0.2 && arousal < 0.3 && dominance < -0.2) emotions.push('无奈');
    // 麻木：低唤醒+低愉悦+低攻击（什么都没感觉）
    if (pleasure < -0.1 && arousal < 0.2 && aggression < 0.05) emotions.push('麻木');

    // ── 思念/怀旧类 ──
    // 思念：痛苦+时间偏过去+高亲密
    if (pleasure < -0.3 && temporal_focus < -0.2 && intimacy > 0.3) emotions.push('思念');
    // 怀念：正面+时间偏过去
    if (pleasure > 0.1 && temporal_focus < -0.3 && intimacy > 0.2) emotions.push('怀念');
    // 空虚：低愉悦+低唤醒+低亲密度+低安全
    if (pleasure < -0.1 && arousal < 0.2 && intimacy < 0.3 && safety < 0.4) emotions.push('空虚');

    // ── 强烈正面情绪 ──
    // 快乐：高愉悦+高唤醒
    if (pleasure > 0.5 && arousal > 0.4) emotions.push('快乐');
    // 爱意：愉悦+高亲密
    if (pleasure > 0.3 && intimacy > 0.5) emotions.push('爱意');
    // 满足：愉悦+高潮/满足感
    if (pleasure > 0.3 && ecstasy > 0.3) emotions.push('满足');
    // 幸福：高愉悦+高亲密+高安全
    if (pleasure > 0.5 && intimacy > 0.6 && safety > 0.6) emotions.push('幸福');
    // 惊喜：愉悦+高唤醒+低亲密
    if (pleasure > 0.4 && arousal > 0.5 && intimacy < 0.2) emotions.push('惊喜');
    // 感动：愉悦+高真诚+高亲密
    if (pleasure > 0.3 && sincerity > 0.6 && intimacy > 0.4) emotions.push('感动');
    // 温馨：愉悦+低唤醒+高亲密
    if (pleasure > 0.2 && arousal < 0.3 && intimacy > 0.4) emotions.push('温馨');

    // ── 亲密/欲望类 ──
    // 欲望：高性吸引+高潮感
    if (sexual_attraction > 0.5 && ecstasy > 0.3) emotions.push('欲望');
    // 渴望：感官渴望+高亲密+低满足
    if (sensory_craving > 0.4 && intimacy > 0.5 && ecstasy < 0.2) emotions.push('渴望');
    // 占有：强占有欲+高亲密
    if (possessiveness > 0.5 && intimacy > 0.4 && pleasure > 0.1) emotions.push('占有');
    // 依赖：高依赖度+高亲密
    if (dependency > 0.5 && intimacy > 0.4) emotions.push('依赖');

    // ── 安静/中性情绪 ──
    // 平静：低唤醒+中性愉悦+安全
    if (arousal < 0.2 && Math.abs(pleasure) < 0.3 && safety >= 0.5) emotions.push('平静');
    // 中性：所有维度都接近中性，无显著情绪信号
    if (emotions.length === 0 && arousal < 0.3 && Math.abs(pleasure) < 0.2 && aggression < 0.1) emotions.push('中性');
    // 期待：轻微愉悦+高唤醒+时间偏未来
    if (pleasure > 0.1 && arousal > 0.3 && temporal_focus > 0.3) emotions.push('期待');
    // 慵懒：低唤醒+低攻击+低支配
    if (arousal < 0.2 && aggression < 0.05 && dominance < 0) emotions.push('慵懒');

    // ── 复杂/混合情绪 ──
    // 倾诉：负面情绪+高真诚
    if (pleasure < -0.3 && sincerity > 0.5) emotions.push('倾诉');
    // 失落：负面+低唤醒+高能量融合（曾拥有过）
    if (pleasure < -0.2 && arousal < 0.3 && energy_merge > 0.3) emotions.push('失落');
    // 矛盾：正负维度同时高
    if (Math.abs(pleasure) < 0.2 && arousal > 0.4 && intimacy > 0.3 && safety < 0.4) emotions.push('矛盾');
    // 释然：正面+高真诚+高安全
    if (pleasure > 0.1 && sincerity > 0.5 && safety > 0.6 && temporal_focus > 0.1) emotions.push('释然');
    // 警惕：低安全+低愉悦+高自我参照
    if (safety < 0.3 && pleasure < -0.1 && self_ref > 0.4) emotions.push('警惕');
    // 共鸣：能量融合+高亲密+高真诚
    if (energy_merge > 0.4 && intimacy > 0.4 && sincerity > 0.5) emotions.push('共鸣');

    // ── 社交类 ──
    // 嫉妒：低愉悦+低安全+高占有
    if (pleasure < -0.2 && safety < 0.35 && possessiveness > 0.3 && arousal > 0.3) emotions.push('嫉妒');
    // 疏离：低亲密+低归属+高自我参照
    if (intimacy < 0.2 && (p as any).belonging < 0.3 && self_ref > 0.5) emotions.push('疏离');
    // 包容：高真诚+高礼仪+低攻击
    if (sincerity > 0.4 && (p as any).etiquette > 0.4 && aggression < 0.1) emotions.push('包容');

    // 去重，只保留最多 4 个
    const unique = [...new Set(emotions)];
    return {
      primary: unique.length > 0 ? unique[0] : undefined,
      secondary: unique.length > 1 ? unique.slice(1, 4) : undefined,
    };
  }

  /**
   * P2: 估算情绪识别置信度（高精度版）。
   * 基于：情绪标签数量、情感词密度、钙质强度的综合评分。
   */
  static estimateConfidence(emotions: string[], textLength: number, rawHits: number, calciumScore?: number): number {
    if (!textLength) return 0.3;

    const hasEmotion = emotions.length > 0 ? 1 : 0;
    const density = Math.min(rawHits / Math.max(textLength, 1) * 10, 1);
    // 有明确情绪标签 + 高密度 + 钙质加分（钙质越高说明情绪越明显）
    const calciumFactor = calciumScore !== undefined ? Math.min(calciumScore * 0.3, 0.15) : 0;
    const base = hasEmotion * 0.35 + density * 0.3 + 0.2 + calciumFactor;
    return Math.round(Math.min(base, 1) * 100) / 100;
  }

  /** 根据感知向量重新计算钙质强度（在 injectContext 后调用） */
  static recalculateCalcium(perception: Perception24D, config?: CalciumConfig): CalciumResult {
    return calculateCalcium(perception, config);
  }
}
