/**
 * M8 结构性守卫测试
 *
 * 覆盖类型接口 + 类方法签名 + 核心函数 + 外部契约
 */
import { describe, it, expect } from 'vitest';
import { M8FusionAdapter } from '../M8FusionAdapter.js';
import { derivePhysiologicalSnapshot, physiologicalCosineSimilarity, calculateCompositeScore, calculateEntryWeight } from '../PhysiologicalDeriver.js';
import type {
  YearRingEntry, SimulatedPhysiologicalSnapshot, PerceptionSnapshot,
  ScarTag, WriteParams, WriteResponse, ClueSearchParams, ClueSearchResult,
  ConflictCheckParams, ConflictCheckResult, M8StorageStatus,
} from '../types/index.js';

describe('[M8守卫] PhysiologicalDeriver 纯函数', () => {
  it('derivePhysiologicalSnapshot 输入感知输出生理快照（4字段+版本号）', () => {
    const snap: PerceptionSnapshot = { pleasure: 0.6, arousal: 0.4, intimacy: 0.5, sexual_attraction: 0.3, sensory_craving: 0.4, energy_merge: 0.2, ecstasy: 0.1, safety: 0.7 };
    const result = derivePhysiologicalSnapshot(snap);
    expect(result.estimated_hr).toBeGreaterThanOrEqual(50);
    expect(result.estimated_hr).toBeLessThanOrEqual(180);
    expect(result.estimated_temp_offset).toBeGreaterThanOrEqual(36.5);
    expect(result.estimated_temp_offset).toBeLessThanOrEqual(38.5);
    expect(result.estimated_arousal).toBeGreaterThanOrEqual(0);
    expect(result.estimated_arousal).toBeLessThanOrEqual(1);
    expect(result.derivation_version).toBe('1.0');
  });

  it('physiologicalCosineSimilarity 返回值在 [0,1] 范围', () => {
    const a: SimulatedPhysiologicalSnapshot = { estimated_hr: 70, estimated_temp_offset: 37.0, estimated_arousal: 0.3, estimated_gsr: 0.5, derivation_version: '1.0' };
    const b: SimulatedPhysiologicalSnapshot = { estimated_hr: 90, estimated_temp_offset: 37.5, estimated_arousal: 0.6, estimated_gsr: 0.7, derivation_version: '1.0' };
    const sim = physiologicalCosineSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
    // 自己与自己的相似度应为 1
    expect(physiologicalCosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('calculateCompositeScore 权重分配 (clue*0.4 + semantic*0.35 + phys*0.25) * weight', () => {
    const result = calculateCompositeScore(1.0, 1.0, 1.0, 1.0);
    expect(result).toBeCloseTo(1.0, 5);
    const half = calculateCompositeScore(1.0, 0, 0, 1.0);
    expect(half).toBeCloseTo(0.4, 5);
  });

  it('calculateEntryWeight 基础=1.0, recallBonus=0.05/次, decay=-0.1/30天', () => {
    const w = calculateEntryWeight(0, null, new Date().toISOString());
    expect(w).toBeCloseTo(1.0, 5);
    const w2 = calculateEntryWeight(5, null, new Date().toISOString());
    expect(w2).toBeCloseTo(1.25, 5);
  });
});

describe('[M8守卫] M8FusionAdapter 方法签名', () => {
  const proto = M8FusionAdapter.prototype;
  it('write(params) — 写入锚点', () => { expect(typeof proto.write).toBe('function'); });
  it('writeBatch(params[]) — 批量写入', () => { expect(typeof proto.writeBatch).toBe('function'); });
  it('matchByClue(params) — 线索检索', () => { expect(typeof proto.matchByClue).toBe('function'); });
  it('readById(entryId) — 读取年轮', () => { expect(typeof proto.readById).toBe('function'); });
  it('markScar(memoryId, scarType) — 标记疤痕', () => { expect(typeof proto.markScar).toBe('function'); });
  it('promoteMemory(memoryId) — 记忆沉淀', () => { expect(typeof proto.promoteMemory).toBe('function'); });
  it('checkConflict(params) — 冲突检测+愈合判定', () => { expect(typeof proto.checkConflict).toBe('function'); });
  it('getStatus() — 存储状态', () => { expect(typeof proto.getStatus).toBe('function'); });
});

describe('[M8守卫] 类型接口', () => {
  it('WriteParams 结构', () => {
    const wp: WriteParams = { sensory_anchor: '猫', perception: {} as any, emotional_valence: '温馨', narrative_tag: '日常', raw_input: 'text', calcium_at_event: 2, write_source: 'emergency' };
    expect(['emergency', 'async']).toContain(wp.write_source);
  });
  it('WriteResponse 含 result + 可选 ritual_phrase', () => {
    const wr: WriteResponse = { result: { success: true, entry_id: 'test' }, ritual_phrase: '刻进骨头里' };
    expect(wr.ritual_phrase).toBeTruthy();
    const wr2: WriteResponse = { result: { success: false, entry_id: '', error: '' } };
    expect(wr2.ritual_phrase).toBeUndefined();
  });
  it('ConflictCheckResult 含 suggestion(block/soften/proceed)', () => {
    const cr: ConflictCheckResult = { hasConflict: true, relatedScars: [], description: 'test', suggestion: 'block' };
    expect(['block', 'soften', 'proceed']).toContain(cr.suggestion);
  });
  it('YearRingEntry 含四元组', () => {
    const yr: YearRingEntry = { id: 'test', created_at: '', updated_at: '', sensory_anchor: '猫', simulated_physiological_snapshot: {} as any, emotional_valence: '温馨', narrative_tag: '日常', retrieval_clues: ['猫'], recall_count: 0, last_recalled_at: null, calcium_at_event: 2, perception_snapshot: {} as any };
    expect(yr.sensory_anchor).toBeTruthy();
    expect(Array.isArray(yr.retrieval_clues)).toBe(true);
  });
  it('ScarTag 含 type(4种)/healed/healed_at', () => {
    const st: ScarTag = { entry_id: 'test', type: 'argument', healed: false, healed_at: null, healed_by: null };
    expect(['argument', 'boundary_test', 'misunderstanding', 'disappointment']).toContain(st.type);
  });
});

describe('[M8守卫] 外部消费者契约', () => {
  it('M8FusionAdapter 被 webui(2处)/m5-clue/m7(2处) 使用 — 12方法不变', () => {
    const proto = M8FusionAdapter.prototype;
    expect(typeof proto.write).toBe('function');
    expect(typeof proto.matchByClue).toBe('function');
    expect(typeof proto.checkConflict).toBe('function');
    expect(typeof proto.markScar).toBe('function');
    expect(typeof proto.promoteMemory).toBe('function');
  });
  it('JsonYearRingAdapter 已删除', async () => {
    const fs = await import('node:fs');
    const exists = fs.existsSync(new URL('../JsonYearRingAdapter.ts', import.meta.url));
    expect(exists).toBe(false);
  });
});
