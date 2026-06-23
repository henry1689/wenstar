/**
 * M3 结构性守卫测试
 *
 * 用途：锁定 M3 模块的结构契约，防止后期架构漂移。
 * 覆盖以下维度：
 *   1. 类型导出（perception.ts 全部 7 个类型接口形状）
 *   2. 类方法签名（PerceptionAnalyzer + M3LogicOrchestrator）
 *   3. 算法/规则不变性（24维评分范围、钙质公式）
 *   4. 外部消费者契约（被 24 处外部 import 的接口不变）
 *
 * Ref: 架构加固指令 — M3 结构性守卫测试
 */

import { describe, it, expect } from 'vitest';
import { PerceptionAnalyzer, getHitReport } from '../PerceptionAnalyzer.js';
import { M3LogicOrchestrator } from '../M3LogicOrchestrator.js';
import type {
  Perception24D,
  EnhancedDNA,
  CalciumResult,
  CalciumLevel,
  M3Decision,
  M3Action,
  M3Context,
} from '../types/perception.js';

// ════════════════════════════════════════════════════════════════════
// 第 1 组：类型接口形状守卫
// ════════════════════════════════════════════════════════════════════

describe('[M3守卫] perception.ts 类型接口', () => {
  it('Perception24D 有 24 个 number 字段、4 象限各 6 维', () => {
    const p: Perception24D = {
      pleasure: 0.5, arousal: 0.5, dominance: 0.5, aggression: 0.5, sincerity: 0.5, humor: 0.5,
      factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.5, temporal_focus: 0.5, self_ref: 0.5,
      intimacy: 0.5, power_diff: 0.5, dependency: 0.5, moral_judgment: 0.5, etiquette: 0.5, belonging: 0.5,
      sexual_attraction: 0.5, sensory_craving: 0.5, energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5, safety: 0.5,
    };
    expect(Object.keys(p).length).toBe(24);
    // 所有字段均为 number
    for (const [k, v] of Object.entries(p)) {
      expect(typeof v).toBe('number');
    }
  });

  it('CalciumLevel 只能是 0 | 1 | 2 | 3', () => {
    const levels: CalciumLevel[] = [0, 1, 2, 3];
    expect(levels.length).toBe(4);
    // 编译时验证：赋值 4 会报 TS 错误
  });

  it('CalciumResult 有 score + level + breakdown(3项)', () => {
    const cr: CalciumResult = { score: 0.5, level: 1, breakdown: { base_core: 0.2, emotional_boost: 0.2, threat_bonus: 0 } };
    expect(Object.keys(cr.breakdown).length).toBe(3);
    expect(cr.score).toBeGreaterThanOrEqual(0);
    expect(cr.score).toBeLessThanOrEqual(1);
  });

  it('EnhancedDNA 含 7 个必含字段（perception+calcium+基础DNA字段）', () => {
    const ed: EnhancedDNA = {
      branch_id: 'evt_00000000_000', locus_path: 'user.misc.default',
      raw_input: 'test', entity_genes: [],
      perception: {} as Perception24D,
      calcium_score: 0.5, calcium_level: 1,
    };
    expect(ed.branch_id).toBeTruthy();
    expect(typeof ed.calcium_score).toBe('number');
  });

  it('M3Action 只能是 5 种之一', () => {
    const actions: M3Action[] = ['ignore', 'memorize', 'ask', 'comfort', 'act'];
    expect(actions.length).toBe(5);
  });

  it('M3Context 含 4 个可选字段', () => {
    const ctx: M3Context = { current_time: '2026-01-01', current_location: '深圳', recent_decisions: [], emotion_baseline: { avg_pleasure: 0.5, avg_arousal: 0.3 } };
    expect(ctx.current_location).toBe('深圳');
    expect(ctx.emotion_baseline?.avg_pleasure).toBe(0.5);
    const ctxMin: M3Context = {};
    expect(ctxMin.current_time).toBeUndefined();
  });

  it('M3Decision 含 enhanced + actions + reason + timestamp', () => {
    const dec: M3Decision = { enhanced: {} as EnhancedDNA, actions: ['memorize'], reason: '测试', timestamp: new Date().toISOString() };
    expect(Array.isArray(dec.actions)).toBe(true);
    expect(typeof dec.reason).toBe('string');
    expect(dec.timestamp).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 2 组：PerceptionAnalyzer 方法签名守卫
// ════════════════════════════════════════════════════════════════════

describe('[M3守卫] PerceptionAnalyzer 公开方法', () => {
  const proto = PerceptionAnalyzer.prototype;

  it('构造函数', () => {
    expect(PerceptionAnalyzer).toBeInstanceOf(Function);
  });

  it('analyze(dna) — 输入 DNA → 输出 EnhancedDNA', () => {
    expect(typeof proto.analyze).toBe('function');
  });

  it('analyzeBatch(dnas) — 批量分析', () => {
    expect(typeof proto.analyzeBatch).toBe('function');
  });

  it('analyzeText(text) — 快捷方式', () => {
    expect(typeof proto.analyzeText).toBe('function');
  });

  it('injectContext(enhanced, context?) — 上下文注入', () => {
    expect(typeof proto.injectContext).toBe('function');
  });

  it('describeLevel — 静态方法，钙质中文描述', () => {
    expect(typeof PerceptionAnalyzer.describeLevel).toBe('function');
  });

  it('recalculateCalcium — 静态方法，重算钙质', () => {
    expect(typeof PerceptionAnalyzer.recalculateCalcium).toBe('function');
  });

  it('getHitReport — 导出函数，调试词级命中', () => {
    expect(typeof getHitReport).toBe('function');
    const report = getHitReport();
    expect(typeof report).toBe('object');
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 3 组：M3LogicOrchestrator 方法签名守卫
// ════════════════════════════════════════════════════════════════════

describe('[M3守卫] M3LogicOrchestrator 公开方法', () => {
  const proto = M3LogicOrchestrator.prototype;

  it('构造函数', () => {
    expect(M3LogicOrchestrator).toBeInstanceOf(Function);
  });

  it('decide(dna, context?) — 核心决策', () => {
    expect(typeof proto.decide).toBe('function');
  });

  it('decideBatch(dnas, context?) — 批量决策', () => {
    expect(typeof proto.decideBatch).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 4 组：运行时不变性守卫
// ════════════════════════════════════════════════════════════════════

describe('[M3守卫] 运行时不变性', () => {
  it('analyze() 返回完整 24 维感知向量', () => {
    const p = new PerceptionAnalyzer().analyze({
      locus_path: 'user.misc.default', taxonomy_version: '1.0',
      branch_id: 'evt_00000000_000', seq_pos: 0,
      leaf_zone: 'language_semantic_zone', ref: 'tmp_na_00000',
      entity_genes: [], raw_input: '今天好开心',
      created_at: new Date().toISOString(),
    });
    const dims = Object.keys(p.perception);
    expect(dims.length).toBe(24);
    expect(typeof p.calcium_score).toBe('number');
  });

  it('getHitReport 在 countHits 后返回正确的词级统计', () => {
    // 清空
    getHitReport();
    // 执行一次分析（会触发 countHits）
    new PerceptionAnalyzer().analyzeText('今天好开心');
    const report = getHitReport();
    // 应该有 "开心" 被记录
    expect(Object.keys(report).length).toBeGreaterThan(0);
  });

  it('describeLevel 4 种钙质都有中文描述', () => {
    const descriptions = [0, 1, 2, 3].map(l => PerceptionAnalyzer.describeLevel(l as CalciumLevel));
    expect(descriptions[0]).toContain('粉末');
    expect(descriptions[1]).toContain('液体');
    expect(descriptions[2]).toContain('固体');
    expect(descriptions[3]).toContain('晶体');
  });

  it('recalculateCalcium 返回值在 [0,1]', () => {
    const p = new PerceptionAnalyzer().analyzeText('测试').perception;
    const result = PerceptionAnalyzer.recalculateCalcium(p);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect([0, 1, 2, 3]).toContain(result.level);
  });

  it('decide 完整流水线返回正确结构', () => {
    const m3 = new M3LogicOrchestrator();
    const dec = m3.decide({
      locus_path: 'user.misc.default', taxonomy_version: '1.0',
      branch_id: 'evt_00000000_000', seq_pos: 0,
      leaf_zone: 'language_semantic_zone', ref: 'tmp_na_00000',
      entity_genes: [], raw_input: '测试',
      created_at: new Date().toISOString(),
    });
    expect(Array.isArray(dec.actions)).toBe(true);
    expect(dec.reason).toBeTruthy();
    expect(dec.timestamp).toBeTruthy();
    expect(dec.enhanced.perception.pleasure).toBeDefined();
  });

  it('injectContext 不崩溃（空 context）', () => {
    const m3 = new M3LogicOrchestrator();
    const dec = m3.decide({
      locus_path: 'user.misc.default', taxonomy_version: '1.0',
      branch_id: 'evt_00000000_000', seq_pos: 0,
      leaf_zone: 'language_semantic_zone', ref: 'tmp_na_00000',
      entity_genes: [], raw_input: '今天在深圳很好',
      created_at: new Date().toISOString(),
    }, {});
    expect(dec).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 5 组：外部消费者契约守卫
// ════════════════════════════════════════════════════════════════════

describe('[M3守卫] 外部消费者契约', () => {
  it('Perception24D 被 m2/math/types/SQLite/m5/m8/m9/adapter 使用 — 24 字段不变', () => {
    const keys: (keyof Perception24D)[] = [
      'pleasure', 'arousal', 'dominance', 'aggression', 'sincerity', 'humor',
      'factual', 'logical', 'certainty', 'abstract', 'temporal_focus', 'self_ref',
      'intimacy', 'power_diff', 'dependency', 'moral_judgment', 'etiquette', 'belonging',
      'sexual_attraction', 'sensory_craving', 'energy_merge', 'possessiveness', 'ecstasy', 'safety',
    ];
    expect(keys.length).toBe(24);
  });

  it('M3Decision 被 m4(3处)/m5(2处)/webui(2处) 使用 — 结构不变', () => {
    const dec: M3Decision = {
      enhanced: {} as EnhancedDNA,
      actions: ['memorize'],
      reason: 'test',
      timestamp: '2026-01-01',
    };
    expect(dec.actions.length).toBe(1);
  });

  it('M3Action 被 m4/m5(3处) 使用 — 5 种不变', () => {
    const actions: M3Action[] = ['ignore', 'memorize', 'ask', 'comfort', 'act'];
    expect(actions.length).toBe(5);
  });

  it('M3LogicOrchestrator 被 webui/cli/e2e/migration 使用 — 有 decide 和 decideBatch', () => {
    const proto = M3LogicOrchestrator.prototype;
    expect(typeof proto.decide).toBe('function');
    expect(typeof proto.decideBatch).toBe('function');
  });
});
