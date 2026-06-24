/**
 * retrieval-constants.ts — 记忆检索共享阈值与常量
 * P1-1: chat.ts 和 MemoryRetriever 统一引用此文件
 */

export const RETRIEVAL_THRESHOLDS = {
  withPerson: { emotional: 0.3, composite: 0.2 },
  withoutPerson: { emotional: 0.65, composite: 0.35 },
  defaultMinStrength: 0.05,
  defaultMinCalcium: 0,
  maxResults: 5,
};

export const BATCH_SIZES = [30, 60, 120, 200];

export const MIN_MATCHED_FOR_BREAK = 3;


export function selectSimilarityMode(pleasure: number, intimacy: number, arousal: number): string {
  if (pleasure < -0.2) return 'mood_congruent';
  if (intimacy > 0.4) return 'intimacy_search';
  if (arousal > 0.6) return 'by_calcium';
  return 'balanced';
}
