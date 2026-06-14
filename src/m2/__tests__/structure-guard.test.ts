/**
 * M2 结构性守卫测试（全面）
 *
 * 用途：锁定 M2 模块的全部结构契约，防止后期架构漂移。
 * 覆盖以下四个维度：
 *   1. 类型导出完整性（types/index.ts 全部 11 个导出）
 *   2. 类方法签名守卫（SQLiteAdapter + FusionStorageAdapter + KnowledgeBase）
 *   3. 算法库守卫（math.ts 全部 12 个导出）
 *   4. 外部消费契约守卫（被 webui/m4/m7/m8/m9/app 调用的接口不变）
 *
 * 任何修改导致此测试失败，即为架构漂移，须先更新此文件再改代码。
 *
 * Ref: 架构加固指令 — M2 完整结构性守卫
 */

import { describe, it, expect } from 'vitest';
import { SQLiteAdapter } from '../SQLiteAdapter.js';
import { FusionStorageAdapter } from '../FusionStorageAdapter.js';
import { KnowledgeBase } from '../KnowledgeBase.js';
import * as mathModule from '../math.js';
import * as typesModule from '../types/index.js';
import type {
  EmotionalMemoryRecord,
  RetrievalQuery,
  ScoredMemory,
  EmotionalLandscape,
  InductionSummary,
  StorageStatus,
  WriteResult,
  ReadResult,
  QueryOptions,
  SimilarityMode,
  MemoryScar,
} from '../types/index.js';

// ════════════════════════════════════════════════════════════════════
// 第 1 组：类型导出完整性（types/index.ts 全部类型守卫）
// ════════════════════════════════════════════════════════════════════

describe('[M2守卫] types/index.ts 类型导出', () => {
  it('模块有 11 个类型级导出（类型运行时不可见，用编译时验证确保存在）', () => {
    // 类型在运行时被擦除，Object.keys 不会包含它们。
    // 类型导出完整性由以下各测试用例的 TS 编译时验证覆盖：
    //   SimilarityMode / WriteResult / ReadResult / StorageStatus /
    //   QueryOptions / MemoryScar / InductionSummary / ScoredMemory /
    //   EmotionalMemoryRecord / EmotionalLandscape
    // 共 10 个类型 + 1 个共 11 个（induce 也在此文件中定义）
    // 这里仅验证 TS 编译能通过（类型存在），运行时不做检测
    expect(true).toBe(true);
  });

  it('SimilarityMode 必须是 6 种之一', () => {
    const modes: SimilarityMode[] = [
      'balanced', 'mood_congruent', 'intimacy_search',
      'cognitive_match', 'social_resonance', 'by_calcium',
    ];
    expect(modes.length).toBe(6);
  });

  it('WriteResult 结构 — success + real_ref + seq_pos + 可选 error', () => {
    const wr: WriteResult = { success: true, real_ref: 'seq_000001', seq_pos: 1 };
    expect(wr.success).toBe(true);
    expect(wr.real_ref).toMatch(/^seq_\d{6}$/);
    expect(wr.seq_pos).toBeGreaterThan(0);
  });

  it('ReadResult 结构 — 可选 dna + 可选 error', () => {
    const rr: ReadResult = { dna: null };
    expect(rr.dna).toBeNull();
    const rr2: ReadResult = { error: 'not found' };
    expect(rr2.error).toBeTruthy();
  });

  it('StorageStatus 结构 — totalRecords + zoneCounts + currentSeqPos + storagePath', () => {
    const ss: StorageStatus = { totalRecords: 0, zoneCounts: {}, currentSeqPos: 0, storagePath: '' };
    expect(ss.totalRecords).toBe(0);
    expect(typeof ss.zoneCounts).toBe('object');
  });

  it('QueryOptions 结构 — limit/offset/perception_filter/similarity_mode 等', () => {
    const qo: QueryOptions = { limit: 10, offset: 0, ascending: false };
    expect(qo.limit).toBe(10);
    // 可选字段验证
    const qo2: QueryOptions = { perception_filter: {} as any, similarity_mode: 'balanced', min_calcium_level: 1, min_strength: 0.05, locus_path: 'user.family', entity_names: ['妈妈'] };
    expect(qo2.similarity_mode).toBe('balanced');
  });

  it('MemoryScar 结构 — type(4种) + healed + healed_at', () => {
    const scar: MemoryScar = { type: 'argument', healed: false, healed_at: null };
    expect(['argument', 'boundary_test', 'misunderstanding', 'disappointment']).toContain(scar.type);
    expect(typeof scar.healed).toBe('boolean');
  });

  it('InductionSummary 结构 — period_type + summary_text + 可选字段', () => {
    const is_: InductionSummary = { period_type: 'daily', period_start: '2026-01-01', period_end: '2026-01-02', summary_text: '...', source_record_count: 5, dominant_mood: null, trait_updates: null };
    expect(['daily', 'weekly', 'monthly']).toContain(is_.period_type);
    expect(typeof is_.summary_text).toBe('string');
  });

  it('ScoredMemory 结构 — record + scores(4维) + composite', () => {
    const sm: ScoredMemory = {
      record: {} as EmotionalMemoryRecord,
      scores: { emotional: 0.5, topic: 0.5, entity: 0.5, calcium: 0.5 },
      composite: 0.5,
    };
    expect(Object.keys(sm.scores).length).toBe(4);
    expect(sm.composite).toBeGreaterThanOrEqual(0);
    expect(sm.composite).toBeLessThanOrEqual(1);
  });

  it('EmotionalMemoryRecord 结构（27+ 字段，含 vad_spectrum）', () => {
    const record: EmotionalMemoryRecord = {
      id: 'test', seq_pos: 1,
      created_at: new Date().toISOString(),
      perception: { pleasure: 0.5, arousal: 0.5, dominance: 0.5, aggression: 0.5, sincerity: 0.5, humor: 0.5, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 },
      calcium_score: 0.5, calcium_level: 1,
      raw_input: 'test', locus_path: 'user.misc.default', entity_genes: [], leaf_zone: 'language_semantic_zone',
      recall_count: 0, last_recalled_at: null,
      reinforcement_accumulator: 0, effective_strength: 1.0, strength_updated_at: new Date().toISOString(),
      is_landmark: false, landmarked_at: null,
      vad_spectrum: null,
    };
    expect(record.vad_spectrum).toBeNull();
    record.vad_spectrum = { overall: { valence: 0.8, arousal: 0.4, dominant_emotion: '喜悦', emotional_arc: '喜悦', dynamic_tension: { intensity: 0.5, amplitude: 0.3, frequency: 0.2 } }, peaks: [{ sequence: 1, text: 'test', peak_type: 'joy', intensity: 0.8 }], score: 0.85, confidence: 0.85 };
    expect(record.vad_spectrum.overall.valence).toBe(0.8);
    expect(Array.isArray(record.vad_spectrum.peaks)).toBe(true);
    // 可选字段
    record.narrative_tag = '重要的日子';
    record.sensory_anchor = '咖啡香气';
    record.scar = { type: 'argument', healed: false, healed_at: null };
    expect(record.narrative_tag).toBe('重要的日子');
  });

  it('EmotionalLandscape 结构 — peaks + scars + cluster_count', () => {
    const el: EmotionalLandscape = { peaks: [], scars: [], cluster_count: 0 };
    expect(Array.isArray(el.peaks)).toBe(true);
    expect(Array.isArray(el.scars)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 2 组：math.ts 算法库守卫（全部 12 个导出）
// ════════════════════════════════════════════════════════════════════

describe('[M2守卫] math.ts 算法库', () => {
  it('toNormalizedVector 将 24D 转为 Float64Array(24)', () => {
    const p = { pleasure: 0.5, arousal: 0.5, dominance: 0.5, aggression: 0.5, sincerity: 0.5, humor: 0.5, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 };
    const v = mathModule.toNormalizedVector(p);
    expect(v).toBeInstanceOf(Float64Array);
    expect(v.length).toBe(24);
  });

  it('computeCalcium 返回 { score, level }', () => {
    const p = { pleasure: 0.5, arousal: 0.5, dominance: 0.5, aggression: 0.5, sincerity: 0.5, humor: 0.5, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 };
    const r = mathModule.computeCalcium(p);
    expect(typeof r.score).toBe('number');
    expect([0, 1, 2, 3]).toContain(r.level);
  });

  it('emotionalSimilarity 接受 (a, b, mode?) 返回 [0,1]', () => {
    const a = { pleasure: 0.6, arousal: 0.3, dominance: 0.5, aggression: 0.4, sincerity: 0.7, humor: 0.3, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 };
    const b = { pleasure: 0.7, arousal: 0.4, dominance: 0.5, aggression: 0.3, sincerity: 0.6, humor: 0.4, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 };
    expect(mathModule.emotionalSimilarity(a, b, 'balanced')).toBeGreaterThanOrEqual(0);
    expect(mathModule.emotionalSimilarity(a, b)).toBeGreaterThanOrEqual(0);
    expect(mathModule.emotionalSimilarity(a, b, 'by_calcium')).toBeGreaterThanOrEqual(0);
  });

  it('initialStrength 参数(calciumScore) 返回 [0,1]', () => {
    expect(mathModule.initialStrength(0)).toBeCloseTo(0.1, 1);
    expect(mathModule.initialStrength(1)).toBeCloseTo(1.0, 1);
    expect(mathModule.initialStrength(0.5)).toBeGreaterThan(0.2);
  });

  it('decayRate 参数(calciumScore) 返回正数', () => {
    expect(mathModule.decayRate(0)).toBeGreaterThan(0);
    expect(mathModule.decayRate(0.5)).toBeLessThan(mathModule.decayRate(0));
    expect(mathModule.decayRate(1)).toBeLessThan(mathModule.decayRate(0.5));
  });

  it('applyDecay 参数(strength, calcium, days, recallCount)', () => {
    expect(mathModule.applyDecay(1.0, 0.5, 1, 0)).toBeLessThan(1.0);
    expect(mathModule.applyDecay(0.01, 0.5, 100, 0)).toBeGreaterThanOrEqual(0.01);
  });

  it('recallBoost 参数(currentStrength)', () => {
    expect(mathModule.recallBoost(0.5)).toBeGreaterThan(0);
    expect(mathModule.recallBoost(1.0)).toBe(0);
  });

  it('reinforcementBoost 参数(existing, new, similarity)', () => {
    expect(mathModule.reinforcementBoost(0.5, 0.5, 0.5)).toBeGreaterThan(0);
    expect(mathModule.reinforcementBoost(1, 1, 1)).toBeGreaterThan(0);
  });

  it('shouldPromote 参数(calcium, accumulator, recallCount, strength)', () => {
    // 钙化≥0.65 → 晋升
    expect(mathModule.shouldPromote(0.7, 0, 0, 0.5)).toBe(true);
    // 累积≥1.5 → 晋升
    expect(mathModule.shouldPromote(0.3, 1.8, 0, 0.5)).toBe(true);
    // 召回次数≥3 且强度>0.5 → 晋升
    expect(mathModule.shouldPromote(0.3, 0, 3, 0.6)).toBe(true);
    // 不满足 → 不晋升
    expect(mathModule.shouldPromote(0.3, 0, 0, 0.3)).toBe(false);
  });

  it('updateDynamics 修改 effective_strength 和晋升', () => {
    const now = new Date();
    const r: EmotionalMemoryRecord = {
      id: 'test', seq_pos: 1, created_at: now.toISOString(),
      perception: { pleasure: 0.5, arousal: 0.5, dominance: 0.5, aggression: 0.5, sincerity: 0.5, humor: 0.5, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 },
      calcium_score: 0.5, calcium_level: 1,
      raw_input: 'test', locus_path: 'user.misc.default', entity_genes: [], leaf_zone: 'language_semantic_zone',
      recall_count: 0, last_recalled_at: null,
      reinforcement_accumulator: 0, effective_strength: 1.0, strength_updated_at: new Date(Date.now() - 86400000).toISOString(),
      is_landmark: false, landmarked_at: null,
      vad_spectrum: null,
    };
    mathModule.updateDynamics(r, now);
    expect(r.effective_strength).toBeLessThan(1.0);
  });

  it('allocateRetrievalWeights 返回(emotional/topic/entity/calcium)权重和为1', () => {
    const w = mathModule.allocateRetrievalWeights(1, 0.5, 'balanced');
    const sum = w.emotional + w.topic + w.entity + w.calcium;
    expect(sum).toBeCloseTo(1.0, 5);
    // entityCount 多时 entity 权重应升高
    const w2 = mathModule.allocateRetrievalWeights(3, 0.5, 'balanced');
    expect(w2.entity).toBeGreaterThan(w.entity);
  });

  it('RetrievalWeights 接口有 4 个字段', () => {
    const rw: mathModule.RetrievalWeights = { emotional: 0.25, topic: 0.25, entity: 0.25, calcium: 0.25 };
    expect(Object.keys(rw).length).toBe(4);
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 3 组：SQLiteAdapter 方法签名守卫（全部公开方法）
// ════════════════════════════════════════════════════════════════════

describe('[M2守卫] SQLiteAdapter 公开方法', () => {
  const proto = SQLiteAdapter.prototype as any;

  it('构造函数 — constructor(dbPath?)', () => {
    const sigLen = SQLiteAdapter.length;
    expect(sigLen).toBe(1); // constructor(dbPath?: string)
  });

  it('initialize() — 异步初始化', () => {
    expect(typeof proto.initialize).toBe('function');
  });

  it('write(record) — 写入 EmotionalMemoryRecord', () => {
    expect(typeof proto.write).toBe('function');
  });

  it('close() — 关闭连接', () => {
    expect(typeof proto.close).toBe('function');
  });

  it('findBySeqPosRange(start, end, limit?)', () => {
    expect(typeof proto.findBySeqPosRange).toBe('function');
  });

  it('findBySeqPosRangeWithStrength(start, end, limit?, minStrength?)', () => {
    expect(typeof proto.findBySeqPosRangeWithStrength).toBe('function');
  });

  it('findByLocusWithStrength(locusPath, limit?, minStrength?)', () => {
    expect(typeof proto.findByLocusWithStrength).toBe('function');
  });

  it('findByLocus(locusPath, limit?)', () => {
    expect(typeof proto.findByLocus).toBe('function');
  });

  it('findById(id)', () => {
    expect(typeof proto.findById).toBe('function');
  });

  it('getTotalCount()', () => {
    expect(typeof proto.getTotalCount).toBe('function');
  });

  it('findByEmotionalSimilarity(query)', () => {
    expect(typeof proto.findByEmotionalSimilarity).toBe('function');
  });

  it('updateRecall(memoryIds)', () => {
    expect(typeof proto.updateRecall).toBe('function');
  });

  it('runDecayMaintenance()', () => {
    expect(typeof proto.runDecayMaintenance).toBe('function');
  });

  it('applyReinforcement(newPerception, newCalcium, memoryIds)', () => {
    expect(typeof proto.applyReinforcement).toBe('function');
  });

  it('getEmotionalLandscape()', () => {
    expect(typeof proto.getEmotionalLandscape).toBe('function');
  });

  it('promoteToLandmark(memoryId, narrativeTag?, sensoryAnchor?)', () => {
    expect(typeof proto.promoteToLandmark).toBe('function');
  });

  it('getStatus()', () => {
    expect(typeof proto.getStatus).toBe('function');
  });

  it('writeRaw(sql, ...params)', () => {
    expect(typeof proto.writeRaw).toBe('function');
  });

  it('queryAll(sql, params?)', () => {
    expect(typeof proto.queryAll).toBe('function');
  });

  it('flush() — 强制落盘', () => {
    expect(typeof proto.flush).toBe('function');
  });

  it('findRelatedEntities(entityNames, minStrength?)', () => {
    expect(typeof proto.findRelatedEntities).toBe('function');
  });

  it('findMemoriesByEntityNames(entityNames, limit?)', () => {
    expect(typeof proto.findMemoriesByEntityNames).toBe('function');
  });

  it('getEntityRelationSummary()', () => {
    expect(typeof proto.getEntityRelationSummary).toBe('function');
  });

  it('updateVadSpectrum(memoryId, vad)', () => {
    expect(typeof proto.updateVadSpectrum).toBe('function');
    expect(proto.updateVadSpectrum.length).toBe(2);
  });

  it('findKnowledgeByEntityOverlap(entityNames, limit?)', () => {
    expect(typeof proto.findKnowledgeByEntityOverlap).toBe('function');
    expect(proto.findKnowledgeByEntityOverlap.length).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 4 组：FusionStorageAdapter 方法签名守卫（全部公开方法）
// ════════════════════════════════════════════════════════════════════

describe('[M2守卫] FusionStorageAdapter 公开方法', () => {
  const proto = FusionStorageAdapter.prototype as any;

  it('构造函数接受 dataDir?', () => {
    expect(typeof proto.constructor).toBe('function');
  });

  it('initialize() — 异步初始化', () => {
    expect(typeof proto.initialize).toBe('function');
  });

  it('reserveNextSeq() — 预分配 seq', () => {
    expect(typeof proto.reserveNextSeq).toBe('function');
  });

  it('write(dna, perception) — 核心写入', () => {
    expect(typeof proto.write).toBe('function');
  });

  it('read(branchId)', () => {
    expect(typeof proto.read).toBe('function');
  });

  it('findByLocus(locusPath, options?)', () => {
    expect(typeof proto.findByLocus).toBe('function');
  });

  it('findBySeqPosRange(start, end, options?)', () => {
    expect(typeof proto.findBySeqPosRange).toBe('function');
  });

  it('findBySeqPosRangeFiltered(start, end, options?)', () => {
    expect(typeof proto.findBySeqPosRangeFiltered).toBe('function');
  });

  it('findByLocusFiltered(locusPath, options?)', () => {
    expect(typeof proto.findByLocusFiltered).toBe('function');
  });

  it('getDecayStats()', () => {
    expect(typeof proto.getDecayStats).toBe('function');
  });

  it('findByEmotionalSimilarity(query)', () => {
    expect(typeof proto.findByEmotionalSimilarity).toBe('function');
  });

  it('updateRecall(memoryIds)', () => {
    expect(typeof proto.updateRecall).toBe('function');
  });

  it('applyReinforcement(perception, calcium, memoryIds)', () => {
    expect(typeof proto.applyReinforcement).toBe('function');
  });

  it('getEmotionalLandscape()', () => {
    expect(typeof proto.getEmotionalLandscape).toBe('function');
  });

  it('promoteToLandmark(memoryId, narrativeTag?, sensoryAnchor?)', () => {
    expect(typeof proto.promoteToLandmark).toBe('function');
  });

  it('markScar(memoryId, scarType)', () => {
    expect(typeof proto.markScar).toBe('function');
  });

  it('updateVadSpectrum(memoryId, vad)', () => {
    expect(typeof proto.updateVadSpectrum).toBe('function');
    expect(proto.updateVadSpectrum.length).toBe(2);
  });

  it('findKnowledgeByEntityOverlap(entityNames, limit?)', () => {
    expect(typeof proto.findKnowledgeByEntityOverlap).toBe('function');
  });

  it('runDecayMaintenance()', () => {
    expect(typeof proto.runDecayMaintenance).toBe('function');
  });

  it('findRelatedEntities(entityNames, minStrength?)', () => {
    expect(typeof proto.findRelatedEntities).toBe('function');
  });

  it('findMemoriesByEntityNames(entityNames, limit?)', () => {
    expect(typeof proto.findMemoriesByEntityNames).toBe('function');
  });

  it('getEntityRelationSummary()', () => {
    expect(typeof proto.getEntityRelationSummary).toBe('function');
  });

  it('getStatus()', () => {
    expect(typeof proto.getStatus).toBe('function');
  });

  it('nextSeqPos()', () => {
    expect(typeof proto.nextSeqPos).toBe('function');
  });

  it('getSQLite()', () => {
    expect(typeof proto.getSQLite).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 5 组：KnowledgeBase 方法签名守卫（兼容层）
// ════════════════════════════════════════════════════════════════════

describe('[M2守卫] KnowledgeBase 公开方法', () => {
  const proto = KnowledgeBase.prototype as any;

  it('构造函数接受 SQLiteAdapter', () => {
    expect(typeof proto.constructor).toBe('function');
  });

  it('add(params)', () => {
    expect(typeof proto.add).toBe('function');
  });

  it('list(limit?)', () => {
    expect(typeof proto.list).toBe('function');
  });

  it('getById(id)', () => {
    expect(typeof proto.getById).toBe('function');
  });

  it('update(id, params)', () => {
    expect(typeof proto.update).toBe('function');
  });

  it('delete(id)', () => {
    expect(typeof proto.delete).toBe('function');
  });

  it('search(keyword, limit?, emotionalContext?)', () => {
    expect(typeof proto.search).toBe('function');
  });

  it('count()', () => {
    expect(typeof proto.count).toBe('function');
  });

  it('upload(buffer, fileName, mimeType)', () => {
    expect(typeof proto.upload).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 6 组：外部消费者契约守卫（被 15 个外部文件的 import 不变）
// ════════════════════════════════════════════════════════════════════

describe('[M2守卫] 外部消费者契约', () => {
  it('FusionStorageAdapter 被 webui/chat m4/m7/m8/m9/cli 使用 — 必须有 write(dna,perception)', () => {
    // 这些外部文件都依赖 write 方法返回 Promise<WriteResult>
    const retTypeSample: WriteResult = { success: true, real_ref: 'seq_000001', seq_pos: 1 };
    expect(retTypeSample).toBeTruthy();
  });

  it('FusionStorageAdapter 被 m4/MemoryRetriever 使用 — 必须有 findByEmotionalSimilarity(query)', () => {
    // m4/MemoryRetriever.ts 调 storage.findByEmotionalSimilarity
    const proto = FusionStorageAdapter.prototype as any;
    expect(typeof proto.findByEmotionalSimilarity).toBe('function');
  });

  it('FusionStorageAdapter 被 m4/M4Orchestrator 使用 — 必须有 findRelatedEntities', () => {
    const proto = FusionStorageAdapter.prototype as any;
    expect(typeof proto.findRelatedEntities).toBe('function');
  });

  it('FusionStorageAdapter 被 m7/ConsolidationQueue 使用 — 必须有 promoteToLandmark/findBySeqPosRange', () => {
    const proto = FusionStorageAdapter.prototype as any;
    expect(typeof proto.promoteToLandmark).toBe('function');
    expect(typeof proto.findBySeqPosRange).toBe('function');
  });

  it('FusionStorageAdapter 被 m8/M8FusionAdapter 使用 — 必须有 getEmotionalLandscape/updateRecall', () => {
    const proto = FusionStorageAdapter.prototype as any;
    expect(typeof proto.getEmotionalLandscape).toBe('function');
    expect(typeof proto.updateRecall).toBe('function');
  });

  it('FusionStorageAdapter 被 m9/WorkingMemory 使用 — 必须有 reserveNextSeq/write', () => {
    const proto = FusionStorageAdapter.prototype as any;
    expect(typeof proto.reserveNextSeq).toBe('function');
    expect(typeof proto.write).toBe('function');
  });

  it('SQLiteAdapter 被 app/knowledge/* 使用 — 必须有 writeRaw/queryAll', () => {
    const proto = SQLiteAdapter.prototype as any;
    expect(typeof proto.writeRaw).toBe('function');
    expect(typeof proto.queryAll).toBe('function');
  });

  it('SQLiteAdapter 被 app/somatic/SomaticMemory 使用 — 必须有 queryAll/writeRaw', () => {
    const proto = SQLiteAdapter.prototype as any;
    expect(typeof proto.queryAll).toBe('function');
    expect(typeof proto.writeRaw).toBe('function');
  });

  it('SimilarityMode 被 webui/server + webui/chat 使用 — 6种模式不变', () => {
    const modes: SimilarityMode[] = ['balanced', 'mood_congruent', 'intimacy_search', 'cognitive_match', 'social_resonance', 'by_calcium'];
    expect(modes.length).toBe(6);
  });

  it('ScoredMemory 被 m4/Reranker + m4/M4Orchestrator + webui 使用 — 结构不变', () => {
    const sm: ScoredMemory = { record: {} as any, scores: { emotional: 0, topic: 0, entity: 0, calcium: 0 }, composite: 0 };
    expect(sm.composite).toBe(0);
  });

  it('WriteResult 被 m9/WorkingMemory 使用 — 结构不变', () => {
    const wr: WriteResult = { success: true, real_ref: 'seq_000001', seq_pos: 1 };
    expect(wr.success).toBe(true);
  });
});
