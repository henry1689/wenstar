import { describe, it, expect } from 'vitest';
import { M5Orchestrator } from '../M5Orchestrator.js';
import { CognitionAssembler } from '../CognitionAssembler.js';
import { StrategySelector } from '../StrategySelector.js';
import { HumanisticCalibrator } from '../HumanisticCalibrator.js';
import { MockLLMProvider } from '../MockLLMProvider.js';
import type { M4Context } from '../../m4/types/index.js';
import type { M3Decision } from '../../m3/types/perception.js';

function makeMockM4Context(actions: string[], pleasure: number, calciumLevel: number): M4Context {
  return {
    decision: {
      actions,
      enhanced: {
        branch_id: 'evt_20260602_001',
        locus_path: 'user.family.general',
        raw_input: '妈妈最近身体不好',
        entity_genes: [
          { name: '妈妈', type: 'person', allele: '妈妈', phenotype: 'neutral', knowledge_type: 'family' },
          { name: '我', type: 'self', allele: '我', phenotype: 'neutral', knowledge_type: 'private' },
        ],
        perception: {
          pleasure, arousal: 0.4, dominance: 0, aggression: 0,
          sincerity: 0.6, humor: 0,
          factual: 0.5, logical: 0.3, certainty: 0.6, abstract: 0.1,
          temporal_focus: 0, self_ref: 0.5,
          intimacy: 0.3, power_diff: 0, dependency: 0.2,
          moral_judgment: 0, etiquette: 0.2, belonging: 0.3,
          sexual_attraction: 0, sensory_craving: 0, energy_merge: 0,
          possessiveness: 0, ecstasy: 0, safety: 0.5,
        },
        calcium_score: calciumLevel >= 3 ? 0.85 : calciumLevel >= 2 ? 0.7 : calciumLevel >= 1 ? 0.4 : 0.1,
        calcium_level: calciumLevel as 0 | 1 | 2 | 3,
      },
      timestamp: '2026-06-02T12:00:00.000Z',
    } as M3Decision,
    memory_summary: {
      timeline: [],
      frequentEntities: [],
      timeSpan: { earliest: '', latest: '' },
    },
    current_time: '2026-06-02T12:00:00.000Z',
    meta: {
      has_history: false,
      has_family_context: true,
      calcium_level: calciumLevel,
      dominant_action: actions[0] ?? 'memorize',
    },
  };
}

describe('M5Orchestrator — 完整流水线', () => {
  it('安慰动作应生成温暖回应', async () => {
    const m5 = new M5Orchestrator();
    const reply = await m5.orchestrate(makeMockM4Context(['comfort'], -0.6, 2));
    expect(reply).toBeTruthy();
    expect(reply.length).toBeGreaterThan(0);
  });

  it('追问动作应生成好奇回应', async () => {
    const m5 = new M5Orchestrator();
    const reply = await m5.orchestrate(makeMockM4Context(['ask'], 0.3, 2));
    expect(reply).toBeTruthy();
  });

  it('忽略动作应生成简短回应', async () => {
    const m5 = new M5Orchestrator();
    const reply = await m5.orchestrate(makeMockM4Context(['ignore'], 0, 0));
    expect(reply).toBeTruthy();
    expect(reply.length).toBeLessThan(20);
  });
});

describe('CognitionAssembler — 认知组装', () => {
  it('应正确推导策略提示', () => {
    const assembler = new CognitionAssembler();
    const m4ctx = makeMockM4Context(['comfort', 'memorize'], -0.6, 2);
    const cognition = assembler.assemble(m4ctx);
    expect(cognition.strategy_hint.tone).toBe('warm');
    expect(cognition.strategy_hint.depth).toBe('medium');
  });
});

describe('StrategySelector — 策略选择', () => {
  it('comfort 动作应选择 com-warm 策略', () => {
    const selector = new StrategySelector();
    const assembler = new CognitionAssembler();
    const cognition = assembler.assemble(makeMockM4Context(['comfort'], -0.6, 2));
    const strategy = selector.select(cognition);
    expect(strategy.strategy_id).toBe('com-warm');
  });

  it('act 动作应选择 act-core 策略', () => {
    const selector = new StrategySelector();
    const assembler = new CognitionAssembler();
    const cognition = assembler.assemble(makeMockM4Context(['act'], -0.8, 3));
    const strategy = selector.select(cognition);
    expect(strategy.strategy_id).toBe('act-core');
  });
});

describe('HumanisticCalibrator — 人文校准', () => {
  it('空文本应降级为兜底话术', () => {
    const calibrator = new HumanisticCalibrator();
    const assembler = new CognitionAssembler();
    const cognition = assembler.assemble(makeMockM4Context(['memorize'], 0.3, 1));
    const result = calibrator.calibrate('', cognition);
    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
  });

  it('有效文本应通过校验', () => {
    const calibrator = new HumanisticCalibrator();
    const assembler = new CognitionAssembler();
    const cognition = assembler.assemble(makeMockM4Context(['memorize'], 0.3, 1));
    const result = calibrator.calibrate('好的，我记住了。', cognition);
    // Calibrator 会去掉末尾句号 + injectThinkingPause 可能追加停顿
    expect(result).toContain('好的，我记住了');
  });
});

describe('MockLLMProvider — 模拟LLM', () => {
  it('应生成模板填充后的文本', async () => {
    const llm = new MockLLMProvider();
    const assembler = new CognitionAssembler();
    const cognition = assembler.assemble(makeMockM4Context(['comfort'], -0.6, 2));
    const result = await llm.generate({
      strategy: { strategy_id: 'com-warm', params: { tone: 'warm', max_length: 100, include_entity: ['妈妈'], include_history: false, include_family: true }, description: '温暖支持' },
      cognition,
    });
    expect(result.text).toBeTruthy();
    expect(result.text.length).toBeGreaterThan(0);
  });
});
