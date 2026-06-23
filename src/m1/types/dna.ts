// Ref: ARCH.md §3.1 DNA四层导航结构
// Ref: ARCH.md §3.2 编码与还原规则
// Ref: ADR-006 本体-标签分离原则
//
// ╔═══════════════════════════════════════════════════════╗
// ║  DNA.ts  v1.1                                        ║
// ║  变更: 新增 emotion_color 可选字段（色号格式 #RRGGBB）║
// ║  原因: 架构纠偏 — 本体-标签分离原则                    ║
// ║  日期: 2026-06-02                                    ║
// ╚═══════════════════════════════════════════════════════╝

/**
 * L0-L3 DNA 四层导航结构
 * 编码即路径，读取即解析
 */
export interface DNA {
  /** L0: 基因组锚点 —— 如 "user.family.conflict" */
  locus_path: string;
  /** 生成该 locus_path 的分类树版本号 */
  taxonomy_version: string;
  /** L1: 分支路由码 —— 如 "evt_20260602_001" */
  branch_id: string;
  /** L1: 会话内临时递增序列位置 */
  seq_pos: number;
  /** L2: 叶节点指针 —— 目标语义区标识 */
  leaf_zone: LeafZone;
  /** L2: 叶节点引用 —— 占位物理地址或临时ID */
  ref: string;
  /** L3: 实体基因槽 */
  entity_genes: EntityGene[];
  /** 原始输入文本 */
  raw_input: string;
  /** 创建时间 ISO8601 */
  created_at: string;
  /**
   * 情绪标签（色号格式，如 "#E74C3C"）。
   *
   * ⚠️ 本体-标签分离原则：此字段是叠加在DNA本体之上的认知标签，
   * 不是DNA核心标识的一部分。删除此字段后，DNA仍可正常解析、排序、去重、引用。
   * DNA的唯一性约束、版本控制和排序逻辑不依赖于此字段。
   *
   * 色号标准：7位Hex格式 #RRGGBB，未来可扩展为 #RRGGBBAA。
   * 无情绪属性时：undefined 或 "#FFFFFF"（白色）。
   *
   * Ref: 架构纠偏指令 — 本体-标签分离原则
   */
  emotion_color?: string;

  /** M3 钙化强度（由 M2 存储提供，M1 本身不产生此值） */
  calcium_score?: number;
  /** M3 钙化等级 0~3 */
  calcium_level?: number;

  /**
   * 场景语义标签（由 DNAEncoder 在编码时派生）。
   * 纯规则产生，从 locus_path + entity_genes 推导，
   * 不涉及 LLM 或外部查询。
   * 下游无需二次解析即可获知"这段在说什么"。
   */
  scene_tags?: string[];

  /**
   * L0 路由模糊度（0=明确，越接近1越模糊）。
   * 当多条关键词规则匹配且优先级接近时设为此值。
   * 下游可用此值决定是否进入 AQC 模糊校验。
   */
  ambiguity_score?: number;

  /** M1 Phase1: 编码阶段告警/降级记录（如 ['L1_failed', 'L3_failed']） */
  warnings?: string[];

  /**
   * SP2-1: DNA 物料根码 — 格式 DNA-{YYYYMMDD}-{HHmm}-{4位流水号}
   * 一个对话一个根码，全链路数据绑定此码
   */
  dna_root_id?: string;
}

/**
 * 5大语义区标识
 * Ref: ARCH.md §2.2 五大语义功能区规范
 */
export type LeafZone =
  | 'language_semantic_zone'
  | 'emotion_valence_zone'
  | 'embodied_perception_zone'
  | 'spatiotemporal_episode_zone'
  | 'social_schema_zone';

/**
 * L3 实体基因槽：每个实体对应一条基因
 * Ref: ARCH.md §3.1 L3实体基因槽
 */
export interface EntityGene {
  /** 实体名称（标准化后的主名） */
  name: string;
  /** 实体类型 */
  type: EntityType;
  /** 该实体出现的具体文本片段 */
  allele: string;
  /** 对自我模型的影响标注（enhance / conflict / neutral） */
  phenotype: PhenotypeLabel;
  /** 知识源类型 */
  knowledge_type: 'private' | 'family' | 'world';
}

export type EntityType = 'person' | 'place' | 'event' | 'emotion' | 'object' | 'self';

export type PhenotypeLabel = 'enhance' | 'conflict' | 'neutral';

/**
 * DNA 编码器的输入
 */
export interface EncoderInput {
  /** 用户说的原始文本 */
  utterance: string;
  /** 最近对话上下文（可选，最多3轮） */
  recent_context?: string[];
  /** 当前自我模型快照 */
  self_model: SelfModelV1;
}

/**
 * 出厂默认自我模型
 * Ref: 设计意图宣言 §4 AI自我模型四大支柱
 */
export interface SelfModelV1 {
  identity: {
    name: string;
    persona: string;
    birth_date: string;
  };
  /** 大五人格简化版，0-1浮点数 */
  traits: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  boundaries: string[];
  preferences: {
    likes: string[];
    dislikes: string[];
  };
  /** 自我叙事身份 —— L3 self实体的核心锚点 */
  narrative_identity: string;
}

/**
 * 认知分类树结构
 * Ref: 架构决策备忘录 v1.2
 */
export interface TaxonomyTree {
  version: string;
  description?: string;
  tree: Record<string, Record<string, string[]>>;
}

/**
 * L0 路由结果
 */
export interface L0RouteResult {
  locus_path: string;
  taxonomy_version: string;
  /** 命中的规则ID，用于审计追溯 */
  rule_id: string;
  /** 是否命中兜底分类 */
  is_fallback: boolean;
  /** 路由模糊度（0=明确，越接近1越模糊，仅在多条规则冲突时 > 0） */
  ambiguity_score?: number;
}

/**
 * L1 序列结果
 */
export interface L1SequenceResult {
  branch_id: string;
  seq_pos: number;
}

/**
 * L2 内容提取结果
 */
export interface L2ContentResult {
  leaf_zone: LeafZone;
  ref: string;
}

/**
 * L3 实体标注结果
 */
export interface L3AnnotationResult {
  entity_genes: EntityGene[];
}

/**
 * 编码器阶段标识
 */
export type EncoderStage = 'L0' | 'L1' | 'L2' | 'L3' | 'COMPLETE';

/**
 * 编码器错误类型
 */
export class DNAEncoderError extends Error {
  constructor(
    message: string,
    public readonly stage: EncoderStage,
    public readonly code: string
  ) {
    super(message);
    this.name = 'DNAEncoderError';
  }
}
