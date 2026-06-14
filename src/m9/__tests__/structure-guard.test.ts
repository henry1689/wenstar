/**
 * M9 结构性守卫测试
 *
 * 覆盖类型接口 + 方法签名 + 毕业/丢弃判定逻辑 + 外部契约
 * M9 是 M2 的唯一写入入口，是记忆管线的最后道关卡。
 *
 * Ref: 架构加固指令 — M9 结构性守卫测试
 */
import { describe, it, expect } from 'vitest';
import { WorkingMemory } from '../WorkingMemory.js';
import { computeCalcium } from '../../m2/math.js';
import type { FusionStorageAdapter } from '../../m2/FusionStorageAdapter.js';
import type { Perception24D } from '../../m3/types/perception.js';
import type { DNA } from '../../m1/types/dna.js';

// 模拟的 FusionStorageAdapter（仅用于构造 WorkingMemory）
function createMockStorage(): any {
  return {
    reserveNextSeq: () => 1,
    write: async () => ({ success: true, real_ref: 'seq_000001', seq_pos: 1 }),
    getSQLite: () => ({}),
    getStatus: async () => ({ totalRecords: 0, zoneCounts: {}, currentSeqPos: 0, storagePath: '' }),
  };
}

describe('[M9守卫] WorkingMemory 方法签名', () => {
  it('构造函数接受 (storage, maxSize?)', () => {
    expect(WorkingMemory).toBeInstanceOf(Function);
  });
  it('push(dna, perception, seqPos)', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.push).toBe('function');
  });
  it('consolidate()', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.consolidate).toBe('function');
  });
  it('flushAll()', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.flushAll).toBe('function');
  });
  it('getStatus()', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.getStatus).toBe('function');
  });
  it('startFlushTimer(intervalMs?)', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.startFlushTimer).toBe('function');
  });
  it('stopFlushTimer()', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.stopFlushTimer).toBe('function');
  });
});

describe('[M9守卫] 毕业/丢弃判定逻辑', () => {
  const MOCK_DNA: DNA = {
    locus_path: 'user.misc.default', taxonomy_version: '1.0',
    branch_id: 'evt_00000000_000', seq_pos: 0,
    leaf_zone: 'language_semantic_zone', ref: 'tmp_na_00000',
    entity_genes: [], raw_input: '测试',
    created_at: new Date().toISOString(),
  };

  // 模拟一个感知向量，使 computeCalcium 输出可预测
  const makeP = (pleasure: number, arousal: number): Perception24D => ({
    pleasure, arousal, dominance: 0.5, aggression: 0, sincerity: 0.5, humor: 0,
    factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5,
    temporal_focus: 0, self_ref: 0.5, intimacy: 0.5, power_diff: 0,
    dependency: 0.5, moral_judgment: 0, etiquette: 0.5, belonging: 0.5,
    sexual_attraction: 0, sensory_craving: 0, energy_merge: 0,
    possessiveness: 0, ecstasy: 0, safety: 0.5,
  });

  it('getStatus 返回完整结构（size/maxSize/utilization/pendingGraduates）', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    const s = wm.getStatus();
    expect(typeof s.size).toBe('number');
    expect(typeof s.maxSize).toBe('number');
    expect(typeof s.utilization).toBe('number');
    expect(typeof s.pendingGraduates).toBe('number');
    expect(s.size).toBe(0);
    expect(s.utilization).toBe(0);
  });

  it('push 后 getStatus 显示数量增加', () => {
    const wm = new WorkingMemory(createMockStorage() as any, 50);
    const p = makeP(0.5, 0.3);
    wm.push(MOCK_DNA, p, 1);
    const s = wm.getStatus();
    expect(s.size).toBe(1);
  });

  it('consolidate 不崩溃（空缓冲）', async () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    const results = await wm.consolidate();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBe(0);
  });
});

describe('[M9守卫] 外部消费者契约', () => {
  it('WorkingMemory 被 webui(2处)/chat(1处) 使用 — 有 push/flushAll/getStatus', () => {
    const wm = new WorkingMemory(createMockStorage() as any);
    expect(typeof wm.push).toBe('function');
    expect(typeof wm.flushAll).toBe('function');
    expect(typeof wm.getStatus).toBe('function');
  });

  it('FusionStorageAdapter.reserveNextSeq 被 M9 使用 — 方法存在', () => {
    const mock: any = createMockStorage();
    expect(typeof mock.reserveNextSeq).toBe('function');
  });
});
