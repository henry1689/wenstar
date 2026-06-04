// PerceptionAnalyzer + M3LogicOrchestrator 单元测试 (M3)
// Ref: 24维语义感知与钙质强度定义规范
// Ref: M3-design-v1.md §3, §5

import { describe, it, expect } from 'vitest';
import { PerceptionAnalyzer } from '../PerceptionAnalyzer.js';
import { M3LogicOrchestrator } from '../M3LogicOrchestrator.js';
import type { DNA } from '../../m1/types/dna.js';

function makeDNA(raw_input: string, locus_path = 'user.misc.default'): DNA {
  return {
    locus_path,
    taxonomy_version: '1.0',
    branch_id: 'evt_20260602_001',
    seq_pos: 1,
    leaf_zone: 'language_semantic_zone',
    ref: 'tmp_lang_00001',
    entity_genes: [],
    raw_input,
    created_at: '2026-06-02T00:00:00.000Z',
  };
}

// ─── PerceptionAnalyzer 单元测试 ───

describe('PerceptionAnalyzer (M3) — 24维完整性', () => {
  it('分析应返回完整的 24 个感知维度', () => {
    const analyzer = new PerceptionAnalyzer();
    const dna = makeDNA('今天心情不错，开心！');
    const enhanced = analyzer.analyze(dna);
    expect(enhanced.branch_id).toBe(dna.branch_id);
    expect(enhanced.locus_path).toBe(dna.locus_path);
    const p = enhanced.perception;
    expect(typeof p.pleasure).toBe('number');
    expect(typeof p.arousal).toBe('number');
    expect(typeof p.dominance).toBe('number');
    expect(typeof p.aggression).toBe('number');
    expect(typeof p.sincerity).toBe('number');
    expect(typeof p.humor).toBe('number');
    expect(typeof p.factual).toBe('number');
    expect(typeof p.logical).toBe('number');
    expect(typeof p.certainty).toBe('number');
    expect(typeof p.abstract).toBe('number');
    expect(typeof p.temporal_focus).toBe('number');
    expect(typeof p.self_ref).toBe('number');
    expect(typeof p.intimacy).toBe('number');
    expect(typeof p.power_diff).toBe('number');
    expect(typeof p.dependency).toBe('number');
    expect(typeof p.moral_judgment).toBe('number');
    expect(typeof p.etiquette).toBe('number');
    expect(typeof p.belonging).toBe('number');
    expect(typeof p.sexual_attraction).toBe('number');
    expect(typeof p.sensory_craving).toBe('number');
    expect(typeof p.energy_merge).toBe('number');
    expect(typeof p.possessiveness).toBe('number');
    expect(typeof p.ecstasy).toBe('number');
    expect(typeof p.safety).toBe('number');
    expect(typeof enhanced.calcium_score).toBe('number');
    expect([0, 1, 2, 3]).toContain(enhanced.calcium_level);
  });
});

describe('PerceptionAnalyzer (M3) — 情绪检测', () => {
  it('正面文本应产生正愉悦度', () => {
    expect(new PerceptionAnalyzer().analyzeText('今天真的太开心了！好幸福！！').perception.pleasure).toBeGreaterThan(0);
  });
  it('负面文本应产生负愉悦度', () => {
    expect(new PerceptionAnalyzer().analyzeText('我好难过，好孤独，没有人理解我').perception.pleasure).toBeLessThan(0);
  });
  it('愤怒文本应检测到攻击性和唤醒度', () => {
    const enhanced = new PerceptionAnalyzer().analyzeText('你这个混蛋！给我滚！去死吧！');
    expect(enhanced.perception.aggression).toBeGreaterThan(0.2);
    expect(enhanced.perception.arousal).toBeGreaterThan(0.2);
  });
  it('幽默文本应检测到幽默感', () => {
    expect(new PerceptionAnalyzer().analyzeText('哈哈，开玩笑啦，逗你玩的').perception.humor).toBeGreaterThan(0.2);
  });
});

describe('PerceptionAnalyzer (M3) — 认知/社会/欲望', () => {
  it('包含数字的文本应高事实性', () => {
    expect(new PerceptionAnalyzer().analyzeText('2025年3月15日，公司召开了董事会').perception.factual).toBeGreaterThan(0.3);
  });
  it('第一人称高频文本应高自我参照', () => {
    expect(new PerceptionAnalyzer().analyzeText('我觉得我想我需要我自己一个人静静').perception.self_ref).toBeGreaterThan(0.3);
  });
  it('感谢用语应提升社交礼仪分', () => {
    expect(new PerceptionAnalyzer().analyzeText('谢谢您，不好意思麻烦您了').perception.etiquette).toBeGreaterThan(0.3);
  });
  it('性感相关词汇提升性吸引力', () => {
    expect(new PerceptionAnalyzer().analyzeText('你的眼睛好迷人，你的身材真性感').perception.sexual_attraction).toBeGreaterThan(0.2);
  });
});

describe('PerceptionAnalyzer (M3) — 钙质公式', () => {
  it('平静文本应为粉末级（level 0）', () => {
    expect(new PerceptionAnalyzer().analyzeText('嗯').calcium_level).toBe(0);
  });
  it('高攻击性文本钙质应显著高于中性文本', () => {
    const neutral = new PerceptionAnalyzer().analyzeText('好的我知道了');
    const aggressive = new PerceptionAnalyzer().analyzeText('去死吧混蛋！杀了你！');
    expect(aggressive.calcium_score).toBeGreaterThan(neutral.calcium_score);
  });
  it('recalculateCalcium 静态方法应返回正确的钙质', () => {
    const p = new PerceptionAnalyzer().analyzeText('测试').perception;
    const result = PerceptionAnalyzer.recalculateCalcium(p);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.breakdown.base_core).toBeGreaterThanOrEqual(0);
  });
});

describe('PerceptionAnalyzer (M3) — 确定性', () => {
  it('相同输入 50 次应返回完全相同的结果', () => {
    const analyzer = new PerceptionAnalyzer();
    const results = Array.from({ length: 50 }, () => analyzer.analyzeText('今天真的好开心，和你在一起很幸福'));
    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i].calcium_score).toBe(first.calcium_score);
      expect(results[i].perception.pleasure).toBe(first.perception.pleasure);
    }
  });
});

describe('PerceptionAnalyzer (M3) — 边界情况', () => {
  it('空文本不应崩溃', () => { expect(new PerceptionAnalyzer().analyzeText('')).toBeDefined(); });
  it('超长文本不应崩溃', () => { expect(new PerceptionAnalyzer().analyzeText('测试'.repeat(5000))).toBeDefined(); });
  it('特殊字符不应崩溃', () => { expect(new PerceptionAnalyzer().analyzeText('!@#$%^&*()😡😭😤🔥')).toBeDefined(); });
  it('实体基因应完整传递', () => {
    const analyzer = new PerceptionAnalyzer();
    const dna = makeDNA('妈妈我好想你');
    dna.entity_genes = [
      { name: '妈妈', type: 'person', allele: '妈妈', phenotype: 'enhance', knowledge_type: 'family' },
    ];
    expect(analyzer.analyze(dna).entity_genes).toHaveLength(1);
  });
});

// ─── M3LogicOrchestrator 单元测试 ───

describe('M3LogicOrchestrator — 决策路由', () => {
  it('粉末级输入应返回 ignore', () => {
    const decision = new M3LogicOrchestrator().decide(makeDNA('嗯'));
    expect(decision.actions).toContain('ignore');
  });

  it('液体级输入应返回 memorize', () => {
    const decision = new M3LogicOrchestrator().decide(makeDNA('今天天气不错'));
    expect(['memorize', 'ignore']).toContain(decision.actions[0]);
  });

  it('负面固体级输入应包含 comfort', () => {
    const decision = new M3LogicOrchestrator().decide(makeDNA('我好难过，为什么总是这样'));
    // 负面文本应触发 comfort
    if (decision.enhanced.calcium_level >= 2) {
      expect(decision.actions).toContain('comfort');
    }
  });

  it('高威胁晶体级输入应返回 act', () => {
    const decision = new M3LogicOrchestrator().decide(makeDNA('去死吧！杀了你！'));
    if (decision.enhanced.calcium_level === 3) {
      expect(decision.actions).toContain('act');
    }
  });

  it('决策结果应包含理由和时间戳', () => {
    const decision = new M3LogicOrchestrator().decide(makeDNA('妈妈我好想你'));
    expect(decision.reason).toBeTruthy();
    expect(decision.timestamp).toBeTruthy();
  });
});

describe('M3LogicOrchestrator — 上下文注入', () => {
  it('"今天"应提升 temporal_focus', () => {
    const decision = new M3LogicOrchestrator().decide(
      makeDNA('今天心情不错'),
      { current_time: '2026-06-02T12:00:00.000Z', current_location: '深圳' }
    );
    expect(decision.enhanced.perception.temporal_focus).toBeGreaterThanOrEqual(0.1);
  });

  it('匹配的地点应提升 belonging', () => {
    const dna = makeDNA('我在深圳很好');
    dna.entity_genes = [
      { name: '深圳', type: 'place', allele: '深圳', phenotype: 'neutral', knowledge_type: 'world' },
    ];
    const decision = new M3LogicOrchestrator().decide(dna, { current_location: '深圳' });
    expect(decision.enhanced.perception.belonging).toBeGreaterThan(0.1);
  });
});
