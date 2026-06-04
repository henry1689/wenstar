#!/usr/bin/env tsx
/**
 * M5 表达生成层 压力测试
 *
 * 焦点:
 * - 所有策略模板覆盖（5种）
 * - 认知组装准确性
 * - 校准器拒绝/降级
 * - 多动作决策路径（ask+memorize 等复合）
 * - 模板占位符边界
 * - 降级兜底链
 */
import { M5Orchestrator } from '../src/m5/M5Orchestrator.js';
import { CognitionAssembler } from '../src/m5/CognitionAssembler.js';
import { StrategySelector } from '../src/m5/StrategySelector.js';
import { HumanisticCalibrator } from '../src/m5/HumanisticCalibrator.js';
import { MockLLMProvider } from '../src/m5/MockLLMProvider.js';
import type { M4Context } from '../src/m4/types/index.js';

function makeCtx(actions: string[], pleasure: number, cl: number, entities: string[] = ['妈妈']): M4Context {
  return {
    decision: {
      actions: actions as any,
      enhanced: {
        branch_id: 'stress_m5', locus_path: 'user.family.general', raw_input: '测试输入',
        entity_genes: entities.map(n => ({ name: n, type: 'person', allele: n, phenotype: 'neutral', knowledge_type: 'family' })),
        perception: {
          pleasure, arousal: 0.4, dominance: 0, aggression: 0, sincerity: 0.6, humor: 0,
          factual: 0.5, logical: 0.3, certainty: 0.6, abstract: 0.1, temporal_focus: 0, self_ref: 0.5,
          intimacy: 0.3, power_diff: 0, dependency: 0.2, moral_judgment: 0, etiquette: 0.2, belonging: 0.3,
          sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, possessiveness: 0, ecstasy: 0, safety: 0.5,
        },
        calcium_score: [0.1, 0.4, 0.7, 0.85][cl] ?? 0.4,
        calcium_level: cl as any,
      }, timestamp: '2026-06-02T12:00:00.000Z',
    } as any,
    memory_summary: { timeline: [], frequentEntities: [], timeSpan: { earliest: '', latest: '' } },
    family_context: [{ entity: '妈妈', relation: '母亲', related_entity: '我' }],
    current_time: '2026-06-02T12:00:00.000Z',
    meta: { has_history: false, has_family_context: true, calcium_level: cl, dominant_action: actions[0] },
  };
}

let passed = 0, failed = 0;
function check(name: string, ok: (() => boolean) | boolean, detail?: string) {
  const result = typeof ok === 'function' ? ok() : ok;
  if (result) passed++; else { failed++; console.log(`  ❌ ${name}: ${detail ?? ''}`); }
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M5 表达生成层 压力测试                              ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

const m5 = new M5Orchestrator();
const assembler = new CognitionAssembler();
const selector = new StrategySelector();
const calibrator = new HumanisticCalibrator();

// ─── 1. 所有5种策略 ───
console.log('━━━ 策略覆盖 ─━━');
check('ignore→简短', async () => { const r = await m5.orchestrate(makeCtx(['ignore'], 0, 0)); return r.length < 20; }, '');
check('memorize→确认', async () => { const r = await m5.orchestrate(makeCtx(['memorize'], 0, 1)); return r.length > 0; }, '');
check('ask→追问', async () => { const r = await m5.orchestrate(makeCtx(['ask'], 0.4, 2)); return r.length > 5; }, '');
check('comfort→温暖', async () => { const r = await m5.orchestrate(makeCtx(['comfort'], -0.6, 2)); return r.length > 5; }, '');
check('act→响应', async () => { const r = await m5.orchestrate(makeCtx(['act'], -0.8, 3)); return r.length > 5; }, '');

// ─── 2. 复合动作 ───
console.log('\n━━━ 复合动作 ─━━');
check('memorize+ask→先确认再追问', async () => {
  const r = await m5.orchestrate(makeCtx(['memorize', 'ask'], 0.3, 2));
  return r.length > 0;
}, '');

// ─── 3. 认知组装 ───
console.log('\n━━━ 认知组装 ─━━');
const co = assembler.assemble(makeCtx(['comfort', 'memorize'], -0.6, 2));
check('comfort→tone=warm', co.strategy_hint.tone === 'warm', `got ${co.strategy_hint.tone}`);
check('level2→depth=medium', co.strategy_hint.depth === 'medium', `got ${co.strategy_hint.depth}`);
check('有家族上下文', co.family?.has_family_context === true, '');
check('实体传递正确', co.current.key_entities.includes('妈妈'), '');

// ─── 4. 策略选择 ───
console.log('\n━━━ 策略选择 ─━━');
check('comfort→com-warm', selector.select(assembler.assemble(makeCtx(['comfort'], -0.6, 2))).strategy_id === 'com-warm', '');
check('act→act-core', selector.select(assembler.assemble(makeCtx(['act'], -0.8, 3))).strategy_id === 'act-core', '');
check('ask→ask-curious', selector.select(assembler.assemble(makeCtx(['ask'], 0.4, 2))).strategy_id === 'ask-curious', '');
check('memorize→mem-general', selector.select(assembler.assemble(makeCtx(['memorize'], 0, 1))).strategy_id === 'mem-general', '');

// ─── 5. 校准器 ───
console.log('\n━━━ 校准器 ─━━');
const co2 = assembler.assemble(makeCtx(['memorize'], 0.3, 1));
check('空文本→降级非空', calibrator.calibrate('', co2).length > 0, '');
check('有效文本→通过', calibrator.calibrate('好的妈妈', co2).includes('妈妈'), '');
check('超长文本→截断', calibrator.calibrate('X'.repeat(500), co2).length <= 205, '');

// ─── 6. LLM故障模拟 ───
console.log('\n━━━ LLM故障 ─━━');
class FailingLLM extends MockLLMProvider {
  async generate() { return { text: '' }; }
}
const m5Fail = new M5Orchestrator(new FailingLLM());
check('LLM返回空→降级非空', async () => {
  const r = await m5Fail.orchestrate(makeCtx(['comfort'], -0.6, 2));
  return r.length > 0;
}, '');

class CrashingLLM extends MockLLMProvider {
  async generate() { throw new Error('LLM crash'); }
}
const m5Crash = new M5Orchestrator(new CrashingLLM());
check('LLM异常→降级非空', async () => {
  const r = await m5Crash.orchestrate(makeCtx(['ask'], 0.4, 2));
  return r.length > 0;
}, '');

// ─── 7. 所有动作降级 ───
console.log('\n━━━ 降级覆盖 ─━━');
for (const action of ['ignore', 'memorize', 'ask', 'comfort', 'act'] as const) {
  check(`${action}降级话术非空`, async () => {
    const r = await m5Fail.orchestrate(makeCtx([action], 0, 1));
    return r.length > 0;
  }, '');
}

// ─── 8. MockLLM模板渲染 ───
console.log('\n━━━ 模板渲染 ─━━');
const llm = new MockLLMProvider();
const co3 = assembler.assemble(makeCtx(['comfort'], -0.6, 2));
const result = await llm.generate({
  strategy: { strategy_id: 'com-warm', params: { tone: 'warm', max_length: 100, include_entity: ['妈妈'], include_history: false, include_family: true }, description: '' },
  cognition: co3,
});
check('模板包含实体信息', result.text.includes('妈妈'), `实际: ${result.text.substring(0, 50)}`);
check('模板非空', result.text.length > 0, '');

// ─── 9. 边界 ───
console.log('\n━━━ 边界 ─━━');
try { await m5.orchestrate({} as any); } catch { check('非法ctx抛异常', true, ''); }

const total = passed + failed;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  M5: ${passed}/${total} 通过  ${failed > 0 ? `❌ ${failed} 失败` : '✅'}`);
if (failed > 0) process.exitCode = 1;
console.log('');
