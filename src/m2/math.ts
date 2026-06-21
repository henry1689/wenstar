/**
 * FusionMath — 融合记忆系统的核心算法库
 *
 * 纯函数，零外部依赖。所有记忆动力学基于 24 维情感向量运算。
 */
import type { Perception24D } from '../m3/types/perception.js';
import type { SimilarityMode, EmotionalMemoryRecord } from './types/index.js';

// ──────────────────────────────────────────────
// 1. 向量归一化
// ──────────────────────────────────────────────

/** 哪些维度是双极性的 (-1..1)，需要映射到 [0,1] */
const BIPOLAR_FIELDS: Array<keyof Perception24D> = [
  'pleasure', 'dominance', 'aggression',
  'temporal_focus', 'power_diff', 'moral_judgment',
];

function normalizeValue(value: number, bipolar: boolean): number {
  return bipolar ? (value + 1) / 2 : value;  // -1→0, 0→0.5, 1→1
}

/** 将 Perception24D 转为 24 维 [0,1]²⁴ 归一化向量 */
export function toNormalizedVector(p: Perception24D): Float64Array {
  const v = new Float64Array(24);
  const keys = Object.keys(p) as Array<keyof Perception24D>;
  for (let d = 0; d < 24; d++) {
    v[d] = normalizeValue(p[keys[d]], BIPOLAR_FIELDS.includes(keys[d]));
  }
  return v;
}

// ──────────────────────────────────────────────
// 2. 钙化 = L2 范数
// ──────────────────────────────────────────────

/**
 * calcium = ||v|| / sqrt(24)
 *
 * 平坦中性（所有 ~0.5）→ ~0.35
 * 极端强烈（所有 ~1.0）→ 1.0
 */
export function computeCalcium(p: Perception24D): { score: number; level: 0 | 1 | 2 | 3 } {
  const v = toNormalizedVector(p);
  let sumSq = 0;
  for (let d = 0; d < 24; d++) sumSq += v[d] * v[d];
  const score = Math.sqrt(sumSq) / Math.sqrt(24);

  let level: 0 | 1 | 2 | 3;
  if (score < 0.3) level = 0;
  else if (score < 0.6) level = 1;
  else if (score < 0.8) level = 2;
  else level = 3;

  return { score: Math.round(score * 1000) / 1000, level };
}

// ──────────────────────────────────────────────
// 3. 情感相似度 = 象限加权余弦
// ──────────────────────────────────────────────

/** 象限权重分配 */
function allocateQuadrantWeights(mode: SimilarityMode): [number, number, number, number] {
  switch (mode) {
    case 'mood_congruent': return [0.55, 0.10, 0.20, 0.15];
    case 'intimacy_search': return [0.10, 0.05, 0.15, 0.70];
    case 'cognitive_match': return [0.10, 0.60, 0.15, 0.15];
    case 'social_resonance': return [0.10, 0.10, 0.65, 0.15];
    case 'by_calcium': return [0.25, 0.25, 0.25, 0.25]; // override later
    case 'balanced':
    default: return [0.25, 0.25, 0.25, 0.25];
  }
}

/**
 * 计算两个感知向量之间的加权余弦相似度。
 * 相似度 ∈ [0, 1]，1 = 完全相同。
 */
export function emotionalSimilarity(
  a: Perception24D,
  b: Perception24D,
  mode: SimilarityMode = 'balanced',
  currentPerception?: Perception24D,
): number {
  const va = toNormalizedVector(a);
  const vb = toNormalizedVector(b);

  const quadWeights = allocateQuadrantWeights(mode);
  // P1-1: 当前感知动态权重修正
  const dynamicWeights = [...quadWeights];
  if (currentPerception) {
    if (currentPerception.intimacy > 0.4) {
      dynamicWeights[2] = Math.min(0.7, dynamicWeights[2] + 0.2);
      for (let q = 0; q < 4; q++) { if (q !== 2) dynamicWeights[q] = Math.max(0.05, dynamicWeights[q] - 0.07); }
    }
    if (currentPerception.pleasure > 0.5) {
      dynamicWeights[0] = Math.min(0.7, dynamicWeights[0] + 0.15);
      for (let q = 1; q < 4; q++) { dynamicWeights[q] = Math.max(0.05, dynamicWeights[q] - 0.05); }
    }
    if (currentPerception.sexual_attraction > 0.4) {
      dynamicWeights[3] = Math.min(0.7, dynamicWeights[3] + 0.2);
      for (let q = 0; q < 3; q++) { dynamicWeights[q] = Math.max(0.05, dynamicWeights[q] - 0.07); }
    }
    const total = dynamicWeights.reduce((s, w) => s + w, 0);
    if (total > 0) for (let q = 0; q < 4; q++) dynamicWeights[q] /= total;
  }

  // 逐维度权重
  const dimWeights = new Float64Array(24);
  if (mode === 'by_calcium') {
    // 极端维度主导：权重 ∝ |v - 0.5|
    let sumExtremity = 0;
    for (let d = 0; d < 24; d++) {
      const extremity = Math.abs(va[d] * 2 - 1);  // 0..1
      dimWeights[d] = extremity;
      sumExtremity += extremity;
    }
    if (sumExtremity > 0) {
      for (let d = 0; d < 24; d++) dimWeights[d] /= sumExtremity;
    } else {
      for (let d = 0; d < 24; d++) dimWeights[d] = 1 / 24;
    }
  } else {
    for (let q = 0; q < 4; q++) {
      const w = dynamicWeights[q] / 6;
      for (let d = q * 6; d < (q + 1) * 6; d++) dimWeights[d] = w;
    }
  }

  // 加权余弦
  let dot = 0, normA = 0, normB = 0;
  for (let d = 0; d < 24; d++) {
    const wd = dimWeights[d];
    dot += wd * va[d] * vb[d];
    normA += wd * va[d] * va[d];
    normB += wd * vb[d] * vb[d];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ──────────────────────────────────────────────
// 4. 记忆动力学
// ──────────────────────────────────────────────

/** 初始强度：S 曲线，calcium→编码强度 */
export function initialStrength(calciumScore: number): number {
  // S-curve: calcium 0.0→0.1, 0.5→0.3, 0.8→0.7, 1.0→1.0
  return 0.1 + 0.9 / (1 + Math.exp(-6 * (calciumScore - 0.5)));
}

/** 衰减率：钙化越高衰减越慢 */
export function decayRate(calciumScore: number): number {
  return 0.05 / (1 + calciumScore * 8);
}

/** 应用衰减 */
export function applyDecay(
  currentStrength: number,
  calciumScore: number,
  daysSinceLastUpdate: number,
  recallCount: number,
): number {
  const rate = decayRate(calciumScore);
  const recallResistance = 1 + recallCount * 0.05;
  const effectiveDecay = rate * daysSinceLastUpdate / recallResistance;
  return Math.max(0.01, currentStrength * (1 - effectiveDecay));
}

/** 召回增强：越弱的记忆增强越大 */
export function recallBoost(currentStrength: number): number {
  return 0.05 * (1 - currentStrength);
}

/** 情感相似事件增强 */
export function reinforcementBoost(
  existingCalcium: number,
  newCalcium: number,
  similarity: number,
): number {
  return newCalcium * similarity * existingCalcium * 0.3;
}

/** 晋升检查：是否应该成为年轮地标 */
export function shouldPromote(
  calciumScore: number,
  reinforcementAccumulator: number,
  recallCount: number,
  effectiveStrength: number,
): boolean {
  if (calciumScore >= 0.65) return true;
  if (reinforcementAccumulator >= 1.5) return true;
  if (recallCount >= 3 && effectiveStrength > 0.5) return true;
  return false;
}

/** 完整更新一条记忆的动力学 */
export function updateDynamics(
  record: EmotionalMemoryRecord,
  now: Date = new Date(),
): EmotionalMemoryRecord {
  const lastUpdate = record.strength_updated_at ? new Date(record.strength_updated_at) : now;
  const daysElapsed = (now.getTime() - lastUpdate.getTime()) / 86_400_000;

  record.effective_strength = applyDecay(
    record.effective_strength,
    record.calcium_score,
    daysElapsed,
    record.recall_count,
  );
  record.strength_updated_at = now.toISOString();

  // 自动晋升
  if (!record.is_landmark && shouldPromote(
    record.calcium_score,
    record.reinforcement_accumulator,
    record.recall_count,
    record.effective_strength,
  )) {
    record.is_landmark = true;
    record.landmarked_at = now.toISOString();
  }

  return record;
}

// ──────────────────────────────────────────────
// 5. 检索权重分配
// ──────────────────────────────────────────────

export interface RetrievalWeights {
  emotional: number;
  topic: number;
  entity: number;
  calcium: number;
}

export function allocateRetrievalWeights(
  entityCount: number,
  arousal: number,
  mode: SimilarityMode,
): RetrievalWeights {
  let wE = 0.40, wT = 0.25, wEnt = 0.20, wCa = 0.15;

  if (entityCount >= 2) {
    wEnt = 0.45; wE = 0.20; wT = 0.20; wCa = 0.15;
  }
  if (arousal > 0.7) {
    wE = 0.60; wT = 0.10; wEnt = 0.10; wCa = 0.20;
  }
  if (mode === 'by_calcium') {
    wCa = 0.45; wE = 0.35; wT = 0.10; wEnt = 0.10;
  }

  const sum = wE + wT + wEnt + wCa;
  return { emotional: wE / sum, topic: wT / sum, entity: wEnt / sum, calcium: wCa / sum };
}
