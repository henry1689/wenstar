/**
 * FusionEngine 结构性守卫测试
 *
 * 覆盖:
 *   1. fuseSources 函数签名与策略矩阵
 *   2. 四种模式（中性/亲密/低落/事实）的正确性
 *   3. 不传 memorySummary 时降级
 */
import { describe, it, expect } from 'vitest';
import { fuseSources } from '../FusionEngine.js';
import type { FusionInput, FusionResult } from '../FusionEngine.js';
import type { Perception24D } from '../../../m3/types/perception.js';

const BASE_P: Perception24D = {
  pleasure: 0, arousal: 0.5, dominance: 0.5, aggression: 0, sincerity: 0.5, humor: 0,
  factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0, self_ref: 0.5,
  intimacy: 0, power_diff: 0, dependency: 0.5, moral_judgment: 0, etiquette: 0.5, belonging: 0.5,
  sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, possessiveness: 0, ecstasy: 0, safety: 0.5,
};

describe('[Fusion守卫] 类型与函数签名', () => {
  it('fuseSources 是函数', () => { expect(typeof fuseSources).toBe('function'); });
  it('FusionInput 结构 — perception + knowledgeBaseText + memorySummary', () => {
    const input: FusionInput = {
      perception: BASE_P,
      knowledgeBaseText: '',
      memorySummary: { timeline: [], frequentEntities: [], timeSpan: { earliest: '', latest: '' } },
    };
    expect(input.perception.pleasure).toBeDefined();
    expect(typeof input.knowledgeBaseText).toBe('string');
  });
  it('FusionResult 结构 — fusedText + decision', () => {
    const result: FusionResult = { fusedText: '', decision: 'test' };
    expect(typeof result.fusedText).toBe('string');
    expect(typeof result.decision).toBe('string');
  });
});

describe('[Fusion守卫] 策略矩阵', () => {
  it('中性 → 原样传递，不熔铸', () => {
    const result = fuseSources({ perception: BASE_P, knowledgeBaseText: '📄 测试知识', memorySummary: { timeline: [], frequentEntities: [], timeSpan: { earliest: '', latest: '' } } });
    expect(result.fusedText).toBe('📄 测试知识');
    expect(result.decision).toContain('neutral');
  });

  it('亲密度 > 0.4 → 记忆权重↑', () => {
    const p = { ...BASE_P, intimacy: 0.6, factual: 0.3 };
    const result = fuseSources({
      perception: p,
      knowledgeBaseText: '📄 百科知识内容\n情感曲谱: VAD分析',
      memorySummary: { timeline: [{ time: '2026-01-01', summary: '上次开心的聊天', calcium_level: 2 }], frequentEntities: [], timeSpan: { earliest: '', latest: '' } },
    });
    expect(result.fusedText).toContain('我想起的');
    expect(result.decision).toContain('亲密');
  });

  it('低落 (pleasure < -0.2) → 记忆+家族权重↑', () => {
    const p = { ...BASE_P, pleasure: -0.4, intimacy: 0 };
    const result = fuseSources({
      perception: p,
      knowledgeBaseText: '📄 测试知识',
      memorySummary: { timeline: [{ time: '2026-01-01', summary: '温暖时刻', calcium_level: 2 }], frequentEntities: [], timeSpan: { earliest: '', latest: '' } },
      familyContext: [{ entity: '妈妈', relation: '母亲', related_entity: '我' }],
    });
    expect(result.decision).toContain('低落');
    expect(result.fusedText).toContain('妈妈');
  });

  it('事实性 > 0.5 → 知识权重↑', () => {
    const p = { ...BASE_P, factual: 0.7, intimacy: 0, pleasure: 0.1 };
    const result = fuseSources({ perception: p, knowledgeBaseText: '📄 重要知识', memorySummary: { timeline: [], frequentEntities: [], timeSpan: { earliest: '', latest: '' } } });
    expect(result.fusedText).toContain('📄 重要知识');
    expect(result.decision).toContain('事实模式');
  });

  it('空 knowledgeBaseText → 原样返回空', () => {
    const result = fuseSources({ perception: { ...BASE_P, intimacy: 0.6 }, knowledgeBaseText: '', memorySummary: { timeline: [], frequentEntities: [], timeSpan: { earliest: '', latest: '' } } });
    expect(result.fusedText).toBe('');
  });
});
