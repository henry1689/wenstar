/**
 * M2 结构性守卫测试
 *
 * 用途：锁定 M2 模块的结构契约，防止后期漂移：
 * - EmotionalMemoryRecord 接口形状
 * - vad_spectrum 字段存在性
 * - SQLiteAdapter 核心方法导出
 * - updateVadSpectrum / findKnowledgeByEntityOverlap 存在性
 *
 * Ref: 架构加固指令 — M2 结构性守卫测试
 */

import { describe, it, expect } from 'vitest';
import { SQLiteAdapter } from '../SQLiteAdapter.js';
import { FusionStorageAdapter } from '../FusionStorageAdapter.js';
import { computeCalcium, emotionalSimilarity, initialStrength, updateDynamics } from '../math.js';
import type {
  EmotionalMemoryRecord,
  RetrievalQuery,
  ScoredMemory,
  EmotionalLandscape,
  StorageStatus,
  WriteResult,
  SimilarityMode,
} from '../types/index.js';

describe('[结构守卫] M2 类型导出', () => {
  it('EmotionalMemoryRecord 包含 vad_spectrum 字段', () => {
    // 编译时验证——如果类型定义缺少 vad_spectrum，这里会报 TS 错误
    const record: EmotionalMemoryRecord = {
      id: 'test',
      seq_pos: 1,
      created_at: new Date().toISOString(),
      perception: {
        pleasure: 0.5, arousal: 0.5, dominance: 0.5,
        aggression: 0.5, sincerity: 0.5, humor: 0.5,
        factual: 0.5, logical: 0.5, certainty: 0.5,
        abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5,
        intimacy: 0.5, power_diff: 0.5, dependency: 0.5,
        moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5,
        sexual_attraction: 0.5, sensory_craving: 0.5,
        energy_merge: 0.5, possessiveness: 0.5,
        ecstasy: 0.5, safety: 0.5,
      },
      calcium_score: 0.5,
      calcium_level: 1,
      raw_input: 'test',
      locus_path: 'user.misc.default',
      entity_genes: [],
      leaf_zone: 'language_semantic_zone',
      recall_count: 0,
      last_recalled_at: null,
      reinforcement_accumulator: 0,
      effective_strength: 1.0,
      strength_updated_at: new Date().toISOString(),
      is_landmark: false,
      landmarked_at: null,
      vad_spectrum: null,  // ← 关键守卫：必须存在
    };
    expect(record.vad_spectrum).toBeNull();
    // 赋值 VAD 后应可正常携带
    record.vad_spectrum = { overall: { valence: 0.8, arousal: 0.4, dominant_emotion: '喜悦', emotional_arc: '喜悦', dynamic_tension: { intensity: 0.5, amplitude: 0.3, frequency: 0.2 } }, peaks: [], score: 0.85, confidence: 0.85 };
    expect(record.vad_spectrum.overall.valence).toBe(0.8);
  });

  it('SimilarityMode 是字符串联合类型', () => {
    const modes: SimilarityMode[] = ['balanced', 'mood_congruent', 'intimacy_search', 'cognitive_match', 'social_resonance', 'by_calcium'];
    expect(modes.length).toBe(6);
  });

  it('WriteResult 包含 success/real_ref/seq_pos', () => {
    const wr: WriteResult = { success: true, real_ref: 'seq_000001', seq_pos: 1 };
    expect(wr.success).toBe(true);
    expect(wr.real_ref).toBeTruthy();
    expect(wr.seq_pos).toBeGreaterThan(0);
  });

  it('ScoredMemory 包含 record/scores/composite', () => {
    const sm: ScoredMemory = {
      record: {} as any,
      scores: { emotional: 0.5, topic: 0.5, entity: 0.5, calcium: 0.5 },
      composite: 0.5,
    };
    expect(sm.composite).toBe(0.5);
  });
});

describe('[结构守卫] M2 核心算法', () => {
  it('computeCalcium 返回 score 和 level', () => {
    const result = computeCalcium({
      pleasure: 0.5, arousal: 0.5, dominance: 0.5,
      aggression: 0.5, sincerity: 0.5, humor: 0.5,
      factual: 0.5, logical: 0.5, certainty: 0.5,
      abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5,
      intimacy: 0.5, power_diff: 0.5, dependency: 0.5,
      moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5,
      sexual_attraction: 0.5, sensory_craving: 0.5,
      energy_merge: 0.5, possessiveness: 0.5,
      ecstasy: 0.5, safety: 0.5,
    });
    expect(result.score).toBeGreaterThan(0);
    expect([0, 1, 2, 3]).toContain(result.level);
  });

  it('emotionalSimilarity 返回 0-1 之间的值', () => {
    const a = { pleasure: 0.6, arousal: 0.3, dominance: 0.5, aggression: 0.4, sincerity: 0.7, humor: 0.3, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 };
    const b = { pleasure: 0.7, arousal: 0.4, dominance: 0.5, aggression: 0.3, sincerity: 0.6, humor: 0.4, factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5, intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5, sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5 };
    const sim = emotionalSimilarity(a, b, 'balanced');
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it('initialStrength 是 S 曲线', () => {
    expect(initialStrength(0)).toBeCloseTo(0.1, 1);
    expect(initialStrength(1)).toBeCloseTo(1.0, 1);
  });
});

describe('[结构守卫] M2 类导出', () => {
  it('SQLiteAdapter 是类', () => {
    expect(SQLiteAdapter).toBeInstanceOf(Function);
  });
  it('FusionStorageAdapter 是类', () => {
    expect(FusionStorageAdapter).toBeInstanceOf(Function);
  });
});

describe('[结构守卫] SQLiteAdapter 方法存在性', () => {
  it('类原型上有write/findById/getStatus/updateVadSpectrum/findKnowledgeByEntityOverlap', () => {
    const proto = SQLiteAdapter.prototype;
    expect(typeof proto.write).toBe('function');
    expect(typeof proto.findById).toBe('function');
    expect(typeof proto.getStatus).toBe('function');
    expect(typeof (proto as any).updateVadSpectrum).toBe('function');
    expect(typeof (proto as any).findKnowledgeByEntityOverlap).toBe('function');
  });

  it('updateVadSpectrum 接受 (memoryId, vad) 两参数', () => {
    const method = (SQLiteAdapter.prototype as any).updateVadSpectrum;
    expect(method).toBeDefined();
    expect(method.length).toBe(2);
  });

  it('findKnowledgeByEntityOverlap 有 entityNames 参数', () => {
    const method = (SQLiteAdapter.prototype as any).findKnowledgeByEntityOverlap;
    expect(method).toBeDefined();
    expect(method.length).toBeGreaterThanOrEqual(1);
  });
});
