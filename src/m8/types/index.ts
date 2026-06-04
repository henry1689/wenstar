// M8 关系年轮与具身记忆引擎 · 类型定义
// Ref: docs/M8-design-v1.md §2-§4

import type { Perception24D } from '../../m3/types/perception.js';

// ════════════════════════════════════════════════════════
// 2.1 核心四元组存储
// ════════════════════════════════════════════════════════

/** 模拟生理快照 — 由 M3 24 维感知推导 */
export interface SimulatedPhysiologicalSnapshot {
  /** 推定心率 (bpm) — 由 E2_arousal 推导，范围 50~180 */
  estimated_hr: number;
  /** 推定体温偏移 (°C) — 由 E1_pleasure 和 I2_sensory 推导，范围 36.5~38.5 */
  estimated_temp_offset: number;
  /** 推定唤醒水平 (0-1) — 直接映射 M3 E2_arousal */
  estimated_arousal: number;
  /** 推定皮肤电导反应 (0-1) — 由 I1_sexual_attraction + E2 复合推导 */
  estimated_gsr: number;
  /** 数据来源版本 */
  derivation_version: string;
}

/** M3 感知维度快照（关联检索用） */
export interface PerceptionSnapshot {
  pleasure: number;           // E1
  arousal: number;            // E2
  intimacy: number;           // S1
  sexual_attraction: number;  // I1
  sensory_craving: number;    // I2
  energy_merge: number;       // I3
  ecstasy: number;            // I5
  safety: number;             // I6
}

/** 疤痕标签 */
export interface ScarTag {
  /** 关联的年轮条目 ID */
  entry_id: string;
  /** 疤痕类型 */
  type: 'argument' | 'boundary_test' | 'misunderstanding' | 'disappointment';
  /** 是否愈合 */
  healed: boolean;
  /** 愈合时间（null = 未愈合） */
  healed_at: string | null;
  /** 愈合判定依据 */
  healed_by: 'user_explicit' | 'time_decay' | 'positive_interaction' | null;
  /** 关联的愈合事件条目ID（如有） */
  healing_event_id?: string;
}

/** 关系年轮条目 — 一条不可被物理删除的记忆 */
export interface YearRingEntry {
  /** 唯一标识 */
  id: string;
  /** 创建时间 ISO8601 */
  created_at: string;
  /** 最后更新时间 ISO8601 */
  updated_at: string;

  // ── 四元组 ──

  /** 感官锚点：触发回忆的感官线索 */
  sensory_anchor: string;
  /** 生理快照（模拟 — 由 M3 24 维感知推导） */
  simulated_physiological_snapshot: SimulatedPhysiologicalSnapshot;
  /** 情绪效价：自然语言描述的情绪色彩 */
  emotional_valence: string;
  /** 叙事标签：按亲密阶段分类 */
  narrative_tag: string;

  // ── 增强字段 ──

  /** 高区分度线索（3-5个，用于线索协助式检索） */
  retrieval_clues: string[];
  /** 回忆命中次数 */
  recall_count: number;
  /** 最后被回忆的时间 */
  last_recalled_at: string | null;
  /** 关联事件钙质强度 */
  calcium_at_event: number;
  /** 关联的 M3 感知维度快照 */
  perception_snapshot: PerceptionSnapshot;
}

// ════════════════════════════════════════════════════════
// 3.2 写入接口类型
// ════════════════════════════════════════════════════════

export interface WriteResult {
  success: boolean;
  entry_id: string;
  error?: string;
}

export interface WriteResponse {
  result: WriteResult;
  /** 记忆锚定话术（M5 需要在回复中含入的话） */
  ritual_phrase?: string;
}

export type WriteSource = 'emergency' | 'async';

export interface WriteParams {
  sensory_anchor: string;
  perception: Perception24D;
  emotional_valence: string;
  narrative_tag: string;
  raw_input: string;
  calcium_at_event: number;
  write_source: WriteSource;
}

// ════════════════════════════════════════════════════════
// 4.1 检索接口类型
// ════════════════════════════════════════════════════════

export interface ClueSearchParams {
  /** 用户原始模糊查询 */
  original_query: string;
  /** 用户在线索反问后提供的线索词 */
  user_clue?: string;
  /** 当前生理状态（用于按身体状态匹配） */
  current_physiological_state?: SimulatedPhysiologicalSnapshot;
  /** 可选时间范围 */
  time_range?: { start?: string; end?: string };
  /** 可选话题标签筛选 */
  narrative_filter?: string[];
  /** 单次最大返回条数，默认 5 */
  limit: number;
}

export interface ClueSearchResultEntry {
  entry: YearRingEntry;
  /** 线索匹配分数 (0-1)，线索词重叠率 */
  clue_match_score: number;
  /** 语义匹配分数 (0-1) */
  semantic_score: number;
  /** 生理匹配分数 (0-1) */
  physiological_score: number;
  /** 综合分数: clue*0.4 + semantic*0.35 + physiological*0.25 */
  composite_score: number;
}

export interface ClueSearchResult {
  entries: ClueSearchResultEntry[];
  /** 检索耗时 ms */
  latency_ms: number;
}

// ════════════════════════════════════════════════════════
// 5.1 疤痕/冲突检查类型
// ════════════════════════════════════════════════════════

export interface ConflictCheckParams {
  target: string;
  direction: 'increase' | 'decrease';
  delta: number;
}

export interface ConflictCheckResult {
  hasConflict: boolean;
  relatedScars: ScarTag[];
  description: string;
  suggestion: 'block' | 'soften' | 'proceed';
}

// ════════════════════════════════════════════════════════
// 存储状态
// ════════════════════════════════════════════════════════

export interface M8StorageStatus {
  totalEntries: number;
  scarCount: number;
  healedCount: number;
  unhealedCount: number;
}
