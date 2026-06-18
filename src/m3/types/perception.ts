// 24维语义感知坐标系 + 钙质强度协议 — M3 输入契约
// Ref: 24维语义感知与钙质强度定义规范
//
// ╔═══════════════════════════════════════════════════════╗
// ║  perception.ts  v1.0                                  ║
// ║  归属: M3 (逻辑决策层) — 不是M1的一部分               ║
// ║  变更: 从 M1 迁移至 M3 (架构纠偏)                    ║
// ║  原因: M1是编码层，24维感知是M3逻辑层的眼睛           ║
// ║  日期: 2026-06-02                                    ║
// ╚═══════════════════════════════════════════════════════╝

import type { DNA, EntityGene } from '../../m1/types/dna.js';

// ────────────────────────────────────────────────────────
// 第一部分：24维语义感知坐标系
// ────────────────────────────────────────────────────────

/**
 * 24维感知坐标系
 *
 * 4 大象限 × 6 维度，共同构成一个"最小语义单元（DNA）"的完整心理画像。
 * 所有维度为规则驱动计算（关键词匹配 + 逻辑判断），不使用机器学习模型。
 *
 * Ref: 24维语义感知与钙质强度定义规范 §第一部分
 */
export interface Perception24D {
  // ── 象限1: 情绪效价与能量 (Emotion/Energy) ──
  /** E1 愉悦度: -1.0(痛苦) ~ 1.0(快乐)，中性事实为 0.0 */
  pleasure: number;
  /** E2 唤醒度: 0.0(平静) ~ 1.0(极度激动) */
  arousal: number;
  /** E3 支配感: -1.0(被控制/无助) ~ 1.0(控制局面) */
  dominance: number;
  /** E4 攻击性: 0.0(无) ~ 1.0(有指向性敌意)，单纯发泄不算 */
  aggression: number;
  /** E5 真诚度: 0.0(虚伪/敷衍) ~ 1.0(真实想法) */
  sincerity: number;
  /** E6 幽默感: 0.0(字面意义) ~ 1.0(玩笑/讽刺/双关) */
  humor: number;

  // ── 象限2: 认知逻辑与结构 (Cognition) ──
  /** C1 事实性: 0.0(纯主观) ~ 1.0(新闻报道级客观) */
  factual: number;
  /** C2 逻辑性: 0.0(跳跃思维) ~ 1.0(严谨推理) */
  logical: number;
  /** C3 确定性: 0.0(充满猜测) ~ 1.0(绝对肯定) */
  certainty: number;
  /** C4 抽象度: 0.0(具体的人事) ~ 1.0(哲学道理) */
  abstract: number;
  /** C5 时间焦点: -1.0(过去/怀旧) ~ 0.0(现在) ~ 1.0(未来/憧憬) */
  temporal_focus: number;
  /** C6 自我参照: 0.0(不涉及自我) ~ 1.0(大量涉及自身) */
  self_ref: number;

  // ── 象限3: 社会交互与关系 (Social) ──
  /** S1 亲密度: 0.0(陌生/公事) ~ 1.0(私密分享) */
  intimacy: number;
  /** S2 权力差: -1.0(请求/卑微) ~ 0.0(平等) ~ 1.0(命令/居高临下) */
  power_diff: number;
  /** S3 依赖度: 0.0(独立) ~ 1.0(强烈需求对方) */
  dependency: number;
  /** S4 道德审判: -1.0(谴责/邪恶) ~ 1.0(赞扬/正义) */
  moral_judgment: number;
  /** S5 社交礼仪: 0.0(随意/冒犯) ~ 1.0(无可挑剔但可能虚假) */
  etiquette: number;
  /** S6 群体归属: 0.0("我" 中心) ~ 1.0("我们" 强调) */
  belonging: number;

  // ── 象限4: 亲密与欲望 (Intimacy & Desire, 伴侣核心) ──
  /** I1 性吸引力: 0.0(无) ~ 1.0(强烈生理冲动) */
  sexual_attraction: number;
  /** I2 感官渴望: 0.0(无) ~ 1.0(强烈肢体接触渴望) */
  sensory_craving: number;
  /** I3 能量交融: 0.0(无感) ~ 1.0(灵魂共鸣/心意相通) */
  energy_merge: number;
  /** I4 占有/排他: 0.0(无) ~ 1.0(强烈独占欲/吃醋) */
  possessiveness: number;
  /** I5 愉悦/高潮: 0.0(无感) ~ 1.0(极致快乐/满足) */
  ecstasy: number;
  /** I6 安全感: 0.0(极度不安) ~ 1.0(绝对信任) */
  safety: number;
}

// ────────────────────────────────────────────────────────
// 第二部分：钙质强度协议
// ────────────────────────────────────────────────────────

/**
 * 钙质强度等级
 *
 * - 粉末 (0): 忽略/合并 — 噪音废话，不浪费算力
 * - 液体 (1): 流动/理解 — 正常交流，按部就班处理
 * - 固体 (2): 记忆/回应 — 有效信息或轻微情绪，需记录
 * - 晶体 (3): 刻录/行动 — 誓言/创伤/重大决定/极致亲密
 */
export type CalciumLevel = 0 | 1 | 2 | 3;

/**
 * 钙质强度计算结果
 *
 * Ref: 24维语义感知与钙质强度定义规范 §第二部分
 *
 * 公式: CS = Base_Core + Emotional_Boost + Threat_Bonus
 * - Base_Core = avg(E1~E6) * 0.3 + avg(C1~C6) * 0.3
 * - Emotional_Boost = max(|E1|, E2, |E3|, E4) * 0.4
 * - Threat_Bonus = if (E4 > 0.7 || I6 < 0.2 || I1 > 0.8) then 0.3 else 0.0
 */
export interface CalciumResult {
  /** 钙质强度分数 0.0 ~ 1.0 */
  score: number;
  /** 强度等级 */
  level: CalciumLevel;
  /** 分项明细（用于调试/审计） */
  breakdown: {
    base_core: number;
    emotional_boost: number;
    threat_bonus: number;
  };
}

// ────────────────────────────────────────────────────────
// 第三部分：增强型 DNA（M3 逻辑决策层的处理单元）
// ────────────────────────────────────────────────────────

/**
 * 增强型 DNA — M3 逻辑决策层的处理单元
 *
 * 由 PerceptionAnalyzer 对 M1 原始 DNA 进行感知分析后产出。
 * 包含 24 维感知画像和钙质强度，供 M3 做决策使用。
 *
 * Ref: 24维语义感知与钙质强度定义规范 §第三部分
 */
export interface EnhancedDNA {
  /** 原始 DNA 基础字段 */
  branch_id: string;
  locus_path: string;
  raw_input: string;
  entity_genes: EntityGene[];

  /** 注入的 24 维感知层 */
  perception: Perception24D;

  /** 钙质强度分数 (0.0 ~ 1.0) */
  calcium_score: number;

  /** 预计算的强度等级 */
  calcium_level: CalciumLevel;

  /** P1: 钙质计算配置（场景/个性化偏移，由 analyze() 填充） */
  calcium_config?: { thresholdOffset?: number; scoreBonus?: number };
}

// ────────────────────────────────────────────────────────
// 第四部分：M3 逻辑决策层类型
// ────────────────────────────────────────────────────────

/**
 * M3 决策动作类型
 *
 * ignore    — 忽略（粉末级 0.0~0.3）：噪音废话，不浪费算力
 * memorize  — 记忆（液体级 0.3~0.6）：正常交流，只需记录
 * ask       — 追问（固体级 0.6~0.8）：话题值得深入，主动询问细节
 * comfort   — 安慰（固体级 0.6~0.8）：检测到负面情绪，需要情感支持
 * act       — 行动（晶体级 0.8~1.0）：重大事件或极致情感，触发核心响应
 *
 * Ref: M3-design-v1.md §2.3
 */
export type M3Action = 'ignore' | 'memorize' | 'ask' | 'comfort' | 'act';

/**
 * M3 决策上下文
 *
 * 包含当前时间、地点、历史决策等信息，影响感知分析和决策路由。
 *
 * Ref: M3-design-v1.md §2.4
 */
export interface M3Context {
  /** 当前时间 ISO8601（默认从系统获取） */
  current_time?: string;
  /** 当前地点（从 L3 实体提取或外部传入） */
  current_location?: string;
  /** 最近的 M3 决策历史（用于连续性判断） */
  recent_decisions?: M3Decision[];
  /** 用户情感基线（用于异常检测） */
  emotion_baseline?: {
    avg_pleasure: number;
    avg_arousal: number;
  };
}

/**
 * M3 决策结果
 *
 * M3LogicOrchestrator.decide() 的输出。
 * 包含增强型 DNA、决策动作列表、决策理由。
 *
 * Ref: M3-design-v1.md §2.5
 */
export interface M3Decision {
  /** 增强型 DNA（含 24维感知 + 钙质） */
  enhanced: EnhancedDNA;
  /** 决策动作列表（可多个，按优先级排序） */
  actions: M3Action[];
  /** 决策理由 */
  reason: string;
  /** 当前时间上下文 */
  timestamp: string;

  /** P2: 主情绪标签（由 PerceptionAnalyzer 从24D向量推导） */
  primary_emotion?: string;
  /** P2: 次要情绪标签（复合情绪） */
  secondary_emotions?: string[];
  /** P2: 情绪识别置信度 (0-1) */
  confidence?: number;
}
