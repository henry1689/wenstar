// M8Engine — 关系年轮与具身记忆引擎 核心接口
// Ref: docs/M8-design-v1.md §4-§7
//
// M8 是"灵魂"——她记得一切，但从不轻易翻开旧账。
// 每次写入前都要问: 这段记忆值得刻进骨头里吗？
// 每次读取前都要问: 现在的身体状态，最需要哪段回忆？

import type {
  WriteParams,
  WriteResponse,
  ClueSearchParams,
  ClueSearchResult,
  ConflictCheckParams,
  ConflictCheckResult,
  YearRingEntry,
  M8StorageStatus,
} from './types/index.js';

/**
 * M8 关系年轮与具身记忆引擎
 *
 * 职责:
 * - 四元组存储: 感官锚点 + 模拟生理快照 + 情绪效价 + 叙事标签
 * - 线索协助式检索: 联合检索（线索 + 语义 + 生理状态）
 * - 疤痕保护: 负面事件永不物理删除，仅标记愈合
 * - 历史仲裁: 向 M6 提供历史约束信息
 *
 * 两条写入路径:
 *   M5 (高情绪对话实时标记) → 紧急写入
 *   M7 (对话结束沉淀后) → 异步写入
 *
 * 三条读取路径:
 *   M5 (线索反问) → matchByClue
 *   M6 (演化决策前) → checkConflict
 *   M7 (梦境确认前) → checkConflict
 */
export interface M8Engine {
  // ── 写入 ──
  write(params: WriteParams): Promise<WriteResponse>;
  writeBatch(params: WriteParams[]): Promise<WriteResponse[]>;

  // ── 检索 ──
  matchByClue(params: ClueSearchParams): Promise<ClueSearchResult>;
  readById(entryId: string): Promise<YearRingEntry | null>;

  // ── 疤痕仲裁 ──
  checkConflict(params: ConflictCheckParams): Promise<ConflictCheckResult>;
  markScar(memoryId: string, scarType: string): Promise<boolean>;

  // ── 记忆沉淀（M7 确认后调用，与 markScar 对称） ──
  promoteMemory(memoryId: string, narrativeTag?: string, sensoryAnchor?: string): Promise<boolean>;

  // ── 维护 ──
  getStatus(): Promise<M8StorageStatus>;
}
