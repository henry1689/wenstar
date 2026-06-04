// PhysiologicalDeriver — 模拟生理快照推导引擎
// Ref: docs/M8-design-v1.md §2.2
//
// 核心: 从 M3 24 维感知值推导模拟生理数据
// - 推定心率: 由 E2_arousal + I1_sexual_attraction 推导
// - 推定体温: 由 I2_sensory_craving 推导
// - 唤醒水平: 直接映射 E2
// - 皮肤电导: I1 + E2 复合推导

import type { SimulatedPhysiologicalSnapshot, PerceptionSnapshot } from './types/index.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 从 M3 24 维感知推导模拟生理快照
 *
 * 纯软件模拟，无硬件传感器数据。
 * 公式校准自 2026-06-02 亲密对话测试集。
 *
 * Ref: docs/M8-design-v1.md §2.2
 */
export function derivePhysiologicalSnapshot(
  perception: PerceptionSnapshot
): SimulatedPhysiologicalSnapshot {
  // 推定心率: base 70bpm
  // E2 每 0.1 点 +8bpm (唤醒加速)
  // I1 每 0.1 点 +3bpm (性吸引附加)
  // 范围: 50~180
  const estimated_hr = Math.round(clamp(
    70 + perception.arousal * 80 + perception.sexual_attraction * 30,
    50, 180
  ));

  // 推定体温偏移: base 37.0°C
  // I2 每 0.1 点 +0.15°C (感官渴望升温)
  // 范围: 36.5~38.5
  const estimated_temp_offset = Math.round(clamp(
    37.0 + perception.sensory_craving * 1.5,
    36.5, 38.5
  ) * 10) / 10;

  // 唤醒水平: 直接映射 E2
  const estimated_arousal = clamp(perception.arousal, 0, 1);

  // 推定皮肤电导: I1 * 0.6 + E2 * 0.4 (归一化)
  const estimated_gsr = clamp(
    perception.sexual_attraction * 0.6 + perception.arousal * 0.4,
    0, 1
  );

  return {
    estimated_hr,
    estimated_temp_offset,
    estimated_arousal,
    estimated_gsr,
    derivation_version: '1.0',
  };
}

/**
 * 计算两个生理快照的余弦相似度
 * 用于按"身体状态最相似"检索记忆
 */
export function physiologicalCosineSimilarity(
  a: SimulatedPhysiologicalSnapshot,
  b: SimulatedPhysiologicalSnapshot
): number {
  const aVec = [
    a.estimated_hr / 180,
    a.estimated_temp_offset / 38.5,
    a.estimated_arousal,
    a.estimated_gsr,
  ];
  const bVec = [
    b.estimated_hr / 180,
    b.estimated_temp_offset / 38.5,
    b.estimated_arousal,
    b.estimated_gsr,
  ];

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < aVec.length; i++) {
    dot += aVec[i] * bVec[i];
    normA += aVec[i] * aVec[i];
    normB += bVec[i] * bVec[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * 计算综合分数
 * composite = (clue * 0.4 + semantic * 0.35 + physiological * 0.25) * weight
 */
export function calculateCompositeScore(
  clueScore: number,
  semanticScore: number,
  physiologicalScore: number,
  entryWeight: number
): number {
  const raw = clueScore * 0.4 + semanticScore * 0.35 + physiologicalScore * 0.25;
  return raw * entryWeight;
}

/**
 * 根据权重和时间衰减计算条目权重
 */
export function calculateEntryWeight(
  recallCount: number,
  lastRecalledAt: string | null,
  createdAt: string
): number {
  const now = Date.now();
  const lastRecall = lastRecalledAt
    ? new Date(lastRecalledAt).getTime()
    : new Date(createdAt).getTime();
  const daysSinceLastRecall = (now - lastRecall) / (1000 * 86400);

  const recallBonus = recallCount * 0.05;
  const decayPenalty = Math.floor(daysSinceLastRecall / 30) * 0.1;

  const weight = 1.0 + recallBonus - decayPenalty;
  return Math.max(0.1, weight);
}
