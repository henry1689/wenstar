/**
 * Fusion Memory Types — 融合记忆系统的核心类型定义
 *
 * 24 维情感向量作为记忆的主索引，文本/实体/话题作为次级索引。
 */
import type { Perception24D } from '../../m3/types/perception.js';
import type { EntityGene } from '../../m1/types/dna.js';

/** 相似度检索模式 */
export type SimilarityMode =
  | 'balanced'          // 默认：四象限均匀
  | 'mood_congruent'    // 情绪主导（高arousal时）
  | 'intimacy_search'   // 亲密维度主导
  | 'cognitive_match'   // 认知维度主导
  | 'social_resonance'  // 社会维度主导
  | 'by_calcium';       // 极端维度主导

/** 记忆地标/年轮状态 */
export interface MemoryScar {
  type: 'argument' | 'boundary_test' | 'misunderstanding' | 'disappointment';
  healed: boolean;
  healed_at: string | null;
}

/**
 * 融合记忆记录 — 统一存储单元
 *
 * 取代旧的 ZoneRecord。核心变化：
 * - perception 作为主索引（不再是可选的 metadata）
 * - 记忆动力学字段（强度/衰减/增强）作为一等公民
 * - 年轮/地标字段嵌入（M8 不再是独立存储）
 */
export interface EmotionalMemoryRecord {
  /** 唯一标识（原 branch_id） */
  id: string;
  /** 全局原子序号 */
  seq_pos: number;
  /** 创建时间 ISO8601 */
  created_at: string;
  /** DNA 根码（三段关联主键） */
  dna_root_id?: string;

  /** ── 主索引：完整 24 维情感向量 ── */
  perception: Perception24D;
  calcium_score: number;
  calcium_level: 0 | 1 | 2 | 3;

  /** ── 内容次级索引 ── */
  raw_input: string;
  locus_path: string;
  entity_genes: EntityGene[];
  leaf_zone: string;

  /** ── VAD 谱曲（情感谱曲引擎产出，歌单完整性的曲谱部分）── */
  /** ── M3 情绪标签（预计算，加速检索）── */
  primary_emotion?: string;
  secondary_emotions?: string[];

  /** ── VAD 谱曲（情感谱曲引擎产出，歌单完整性的曲谱部分）── */
  vad_spectrum?: any | null;

  /** ── 记忆动力学 ── */
  recall_count: number;
  last_recalled_at: string | null;
  reinforcement_accumulator: number;
  effective_strength: number;
  strength_updated_at: string;

  /** ── 年轮/地标 ── */
  is_landmark: boolean;
  landmarked_at: string | null;
  narrative_tag?: string;
  sensory_anchor?: string;
  promoted_to_diamond?: boolean;
  scar?: MemoryScar;
}

/** 检索查询 */
export interface RetrievalQuery {
  current_perception: Perception24D;
  locus_path?: string;
  entities?: string[];
  similarity_mode: SimilarityMode;
  limit: number;
  /** P1: 对话组检索模式 — 'all'（默认，同组全返回）｜'first-per-group'（同组只返回锚点） */
  dialogGroupMode?: 'all' | 'first-per-group';
}

/** 评分后的记忆 */
export interface ScoredMemory {
  record: EmotionalMemoryRecord;
  scores: {
    emotional: number;    // 0..1
    topic: number;        // 0..1
    entity: number;       // 0..1
    calcium: number;      // 0..1
  };
  composite: number;
}

/** 情感地形图（取代旧 M8 的独立视图） */
export interface EmotionalLandscape {
  peaks: Array<{
    id: string;
    created_at: string;
    calcium: number;
    pleasure: number;
    intimacy: number;
    snippet: string;
    narrative_tag?: string;
  }>;
  scars: Array<{
    id: string;
    created_at: string;
    calcium: number;
    pleasure: number;
    type: string;
    snippet: string;
  }>;
  cluster_count: number;
}

/** 高阶归纳摘要 */
export interface InductionSummary {
  period_type: 'daily' | 'weekly' | 'monthly';
  period_start: string;
  period_end: string;
  summary_text: string;
  source_record_count: number;
  dominant_mood: Perception24D | null;
  trait_updates: Record<string, number> | null;
}

// ════════════════════════════════════════════════════════════
// 24D 存储契约 —— 取代旧 M2 StorageAdapter/WriteResult/QueryOptions
// 从此存储接口不再是"文本归档接口"，而是"24D 生命状态写入接口"
// ════════════════════════════════════════════════════════════

/** 写入结果 */
export interface WriteResult {
  success: boolean;
  real_ref: string;
  seq_pos: number;
  error?: string;
}

/** 读取结果 */
export interface ReadResult {
  dna?: any;
  error?: string;
}

/**
 * 查询选项（24D 增强版）
 * 支持按情感相似度、特定维度阈值、钙化等级进行检索
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  ascending?: boolean;

  /** 24D: 感知向量过滤 —— 按情感相似度检索 */
  perception_filter?: Perception24D;
  /** 24D: 相似度检索模式 */
  similarity_mode?: SimilarityMode;
  /** 24D: 情感相似度阈值 (0-1) */
  similarity_threshold?: number;

  /** 24D: 按钙化等级过滤 */
  min_calcium_level?: 0 | 1 | 2 | 3;
  /** 24D: 按记忆强度过滤 */
  min_strength?: number;

  /** 话题前缀过滤 */
  locus_path?: string;
  /** 实体名称列表（用于多跳检索） */
  entity_names?: string[];
}

/** 存储状态 */
export interface StorageStatus {
  totalRecords: number;
  zoneCounts: Record<string, number>;
  currentSeqPos: number;
  storagePath: string;
}
