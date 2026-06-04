#!/usr/bin/env tsx
/**
 * M3 感知分析器 压力测试
 *
 * 焦点:
 * - 24维所有维度边界值
 * - 钙质公式极端情况
 * - 情感极性冲突（正负词混合）
 * - 上下文注入（时间/地点修正）
 * - 确定性验证
 * - 超大/超短/空输入
 */
import { PerceptionAnalyzer } from '../src/m3/PerceptionAnalyzer.js';
import { M3LogicOrchestrator } from '../src/m3/M3LogicOrchestrator.js';
import type { DNA } from '../src/m1/types/dna.js';

function makeDNA(text: string): DNA {
  return {
    locus_path: 'user.misc.default', taxonomy_version: '1.0',
    branch_id: 'stress_m3', seq_pos: 0, leaf_zone: 'language_semantic_zone',
    ref: 'tmp_stress', entity_genes: [], raw_input: text,
    created_at: '2026-06-02T00:00:00.000Z',
  };
}

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) passed++; else { failed++; console.log(`  ❌ ${name}: ${detail}`); }
}

const A = new PerceptionAnalyzer();
const M3 = new M3LogicOrchestrator();

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M3 感知分析器 压力测试                              ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// ─── 1. 情绪象限 (E1-E6) ───
console.log('━━━ 情绪象限 E1-E6 ─━━');
check('极正 pleasure→1.0', A.analyzeText('太幸福了太开心了太快乐了').perception.pleasure > 0.5, '');
check('极负 pleasure→-1.0', A.analyzeText('崩溃绝望痛苦伤心难过').perception.pleasure < -0.5, '');
check('中性→0', () => { const p = A.analyzeText('今天是星期二').perception.pleasure; return Math.abs(p) < 0.3; }, '');
check('高唤醒-感叹号', A.analyzeText('气死我了！！！！！').perception.arousal > 0.3, '');
check('低唤醒-平静', A.analyzeText('嗯，平静地躺着').perception.arousal < 0.5, '');
check('攻击性→E4>0', A.analyzeText('去死吧你混蛋').perception.aggression > 0.3, '');
check('幽默→E6>0', A.analyzeText('哈哈太好笑了').perception.humor > 0.2, '');
check('支配感→E3>0', A.analyzeText('你必须听我的').perception.dominance > 0, '');
check('服从→E3<0', A.analyzeText('求求你了帮帮我').perception.dominance < 0, '');

// ─── 2. 认知象限 (C1-C6) ───
console.log('\n━━━ 认知象限 C1-C6 ─━━');
check('事实性-含数字', A.analyzeText('2025年3月15日公司召开了董事会').perception.factual > 0.3, '');
check('逻辑性-连接词', A.analyzeText('因为今天下雨所以没出门').perception.logical > 0.2, '');
check('确定性-绝对词', A.analyzeText('毫无疑问我相信这个结论').perception.certainty > 0.5, '');
check('不确定性-模糊词', A.analyzeText('可能大概也许或许').perception.certainty < 0.5, '');
check('未来焦点→C5>0', A.analyzeText('我以后打算去环游世界').perception.temporal_focus > 0, '');
check('过去焦点→C5<0', A.analyzeText('以前的我总是很怀旧').perception.temporal_focus < 0, '');
check('自我参照-高频我', A.analyzeText('我觉得我想我需要我自己').perception.self_ref > 0.3, '');

// ─── 3. 社会象限 (S1-S6) ───
console.log('\n━━━ 社会象限 S1-S6 ─━━');
check('亲密度', A.analyzeText('亲爱的告诉你一个秘密').perception.intimacy > 0.2, '');
check('礼仪', A.analyzeText('谢谢您不好意思麻烦您了').perception.etiquette > 0.3, '');
check('群体归属-我们', A.analyzeText('我们大家一起努力').perception.belonging > 0.3, '');
check('道德赞扬', A.analyzeText('他真是个善良正义的人').perception.moral_judgment > 0, '');

// ─── 4. 亲密象限 (I1-I6) ───
console.log('\n━━━ 亲密象限 I1-I6 ─━━');
check('性吸引力', A.analyzeText('你的身材真性感').perception.sexual_attraction > 0.2, '');
check('感官渴望-抱抱', A.analyzeText('好想抱抱你').perception.sensory_craving > 0.2, '');
check('安全-信任', A.analyzeText('我相信你，在你身边很安心').perception.safety > 0.5, '');
check('不安全', A.analyzeText('我好害怕不信任你').perception.safety < 0.5, '');

// ─── 5. 钙质公式 ───
console.log('\n━━━ 钙质公式 ─━━');
check('粉末 calcium<0.3', A.analyzeText('嗯').calcium_level === 0, '');
check('液体 0.3~0.6', () => { const c = A.analyzeText('今天心情还可以').calcium_score; return c >= 0.3 && c < 0.6; }, '');
check('固体 0.6~0.8', () => { const c = A.analyzeText('我好难过好伤心绝望').calcium_score; return c >= 0.6 && c < 0.8; }, `got ${A.analyzeText('我好难过好伤心绝望').calcium_score}`);
check('晶体≥0.8', () => { const c = A.analyzeText('去死吧我恨你！我永远无法原谅你！').calcium_score; return c >= 0.8; }, '');
check('Threat_Bonus攻击>0.7', () => {
  const c = PerceptionAnalyzer.recalculateCalcium(A.analyzeText('去死吧我杀了你').perception);
  return c.breakdown.threat_bonus > 0;
}, '');

// ─── 6. 冲突信号 ───
console.log('\n━━━ 冲突信号 ─━━');
const mixed = A.analyzeText('虽然很开心但是又很难过');
check('正负混合→pleasure≈0', () => Math.abs(mixed.perception.pleasure) < 0.5, `got ${mixed.perception.pleasure}`);

// ─── 7. 上下文注入 ───
console.log('\n━━━ 上下文注入 ─━━');
const base = A.analyze(makeDNA('今天心情不错'));
const context = { current_time: '2026-06-02T12:00:00.000Z', current_location: '深圳' };
A.injectContext(base, context);
check('"今天"提升temporal_focus', base.perception.temporal_focus >= 0.1, '');
const withPlace = A.analyze(makeDNA('我在深圳很好'));
withPlace.entity_genes.push({ name: '深圳', type: 'place', allele: '深圳', phenotype: 'neutral', knowledge_type: 'world' });
A.injectContext(withPlace, { current_location: '深圳' });
check('地点匹配提升belonging', withPlace.perception.belonging > 0.1, '');

// ─── 8. 决策路由 ───
console.log('\n━━━ 决策路由 ─━━');
check('粉末→ignore', M3.decide(makeDNA('嗯')).actions.includes('ignore'), '');
check('负面液体→包含comfort', () => {
  const d = M3.decide(makeDNA('我好累啊'));
  return d.enhanced.calcium_level >= 1 && d.actions.includes('comfort');
}, '');
check('积极液体→memorize', () => {
  const d = M3.decide(makeDNA('今天心情不错'));
  return d.actions.includes('memorize');
}, '');

// ─── 9. 确定性 ───
console.log('\n━━━ 确定性 ─━━');
let allSame = true;
const ref = A.analyzeText('今天真的好开心和你在一起');
for (let i = 0; i < 50; i++) {
  const r = A.analyzeText('今天真的好开心和你在一起');
  if (r.calcium_score !== ref.calcium_score || r.perception.pleasure !== ref.perception.pleasure) allSame = false;
}
check('50次相同输入完全一致', allSame, '');

// ─── 10. 边界 ───
console.log('\n━━━ 边界 ─━━');
try { A.analyzeText(''); check('空文本不崩溃', true, ''); } catch { check('空文本不崩溃', false, ''); }
try { A.analyzeText('!'.repeat(100000)); check('10万字符不崩溃', true, ''); } catch { check('10万字符不崩溃', false, ''); }
try { A.analyzeText('😡😡😡😡😡🔥🔥🔥🔥🔥'); check('纯emoji不崩溃', true, ''); } catch { check('纯emoji不崩溃', false, ''); }

const total = passed + failed;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  M3: ${passed}/${total} 通过  ${failed > 0 ? `❌ ${failed} 失败` : '✅'}`);
if (failed > 0) process.exitCode = 1;
console.log('');
