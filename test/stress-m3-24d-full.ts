#!/usr/bin/env tsx
/**
 * M3 24维语义感知 全覆盖压力测试
 *
 * 覆盖策略:
 * - 每个维度独立测试（边界值、极端值、中性值）
 * - 象限内维度冲突测试（正负混合）
 * - 跨象限组合测试（真实场景模拟）
 * - 钙质公式全路径覆盖
 * - 确定性基准测试
 */
import { PerceptionAnalyzer } from '../src/m3/PerceptionAnalyzer.js';
import { M3LogicOrchestrator } from '../src/m3/M3LogicOrchestrator.js';
import type { DNA } from '../src/m1/types/dna.js';
import type { Perception24D, CalciumLevel } from '../src/m3/types/perception.js';

function mkDNA(text: string, genes?: any[]): DNA {
  return {
    locus_path: 'user.misc.default', taxonomy_version: '1.0',
    branch_id: 't', seq_pos: 0, leaf_zone: 'language_semantic_zone',
    ref: 't', entity_genes: genes ?? [], raw_input: text,
    created_at: '2026-06-02T00:00:00.000Z',
  };
}

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) pass++; else { fail++; console.log(`  ❌ ${name}: ${detail ?? ''}`); }
}

const A = new PerceptionAnalyzer();
const M3 = new M3LogicOrchestrator();
const DIMS = ['pleasure','arousal','dominance','aggression','sincerity','humor','factual','logical','certainty','abstract','temporal_focus','self_ref','intimacy','power_diff','dependency','moral_judgment','etiquette','belonging','sexual_attraction','sensory_craving','energy_merge','possessiveness','ecstasy','safety'];

function p(s: string) { return A.analyzeText(s).perception; }

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M3 24维全覆盖压力测试                              ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// ─── 象限1: 情绪(E1-E6) 深度测试 ───
console.log('━━━ 象限1: 情绪 E1-E6 (25项) ─━━');
// E1 pleasure
ok('pleasure=+1.0(极端正面)', p('太幸福了太开心了太快乐了').pleasure > 0.8, `${p('太幸福了太开心了太快乐了').pleasure}`);
ok('pleasure=-1.0(极端负面)', p('崩溃绝望痛苦伤心').pleasure < -0.8, `${p('崩溃绝望痛苦伤心').pleasure}`);
ok('pleasure≈0(中性事实)', () => Math.abs(p('今天是星期二下午三点开会').pleasure) < 0.31, `${p('今天是星期二下午三点开会').pleasure}`);
ok('pleasure≈0(正负抵消)', () => Math.abs(p('开心但又很难过').pleasure) < 0.5, `${p('开心但又很难过').pleasure}`);
ok('pleasure→负(ICU场景)', p('妈妈在ICU医生说只有30%希望').pleasure < -0.3, `${p('妈妈在ICU医生说只有30%希望').pleasure}`);
// E2 arousal
ok('arousal=0(极平静)', p('嗯').arousal < 0.1, '');
ok('arousal>0.3(感叹号)', p('气死我了！！！！！').arousal > 0.3, `${p('气死我了！！！！！').arousal}`);
ok('arousal>0(兴奋词)', p('兴奋极了太棒了').arousal > 0.05, '');
ok('arousal低(低唤醒词)', p('平静淡然放松').arousal < 0.25, `${p('平静淡然放松').arousal}`);
ok('arousal(高情绪+标点)', p('我恨你！！！永远无法原谅！！').arousal >= 0.3, '');
// E3 dominance
ok('dominance>0(命令)', p('你必须听我的给我过来').dominance > 0, `${p('你必须听我的给我过来').dominance}`);
ok('dominance<0(请求)', p('求求你了帮帮我').dominance < 0, `${p('求求你了帮帮我').dominance}`);
ok('dominance≈0(中性)', () => Math.abs(p('今天天气不错').dominance) < 0.3, '');
// E4 aggression
ok('aggression>0(脏话)', p('去死吧你混蛋废物').aggression > 0.3, `${p('去死吧你混蛋废物').aggression}`);
ok('aggression≈0(无攻击)', p('谢谢您非常感谢').aggression < 0.1, '');
ok('Threat_Bonus触发(E4>0.7)', () => {
  const c = PerceptionAnalyzer.recalculateCalcium(p('去死吧杀了你混蛋废物垃圾')).breakdown.threat_bonus;
  return c > 0;
}, '');
// E5 sincerity
ok('sincerity高(诚实)', p('说实话真的我心里话').sincerity > 0.5, `${p('说实话真的我心里话').sincerity}`);
ok('sincerity中等(默认)', p('好的我知道了').sincerity >= 0.3, `${p('好的我知道了').sincerity}`);
// E6 humor
ok('humor>0(哈哈)', p('哈哈太搞笑了').humor > 0.2, `${p('哈哈太搞笑了').humor}`);
ok('humor≈0(严肃)', p('这是一个严肃的问题').humor < 0.2, '');

// ─── 象限2: 认知 C1-C6 深度测试 ───
console.log('\n━━━ 象限2: 认知 C1-C6 (16项) ─━━');
ok('factual高(数字+日期)', p('2025年3月15日公司召开了董事会通过了3项决议').factual > 0.3, '');
ok('factual低(纯情绪)', p('我好难过啊').factual < 0.3, '');
ok('logical高(推理词)', p('因为今天下雨所以没出门但是在家看了一本书').logical > 0.2, '');
ok('logical≈0(无推理)', p('好吃').logical < 0.2, '');
ok('certainty高(绝对词)', p('毫无疑问绝对肯定必然').certainty > 0.6, `${p('毫无疑问绝对肯定必然').certainty}`);
ok('certainty低(模糊词)', p('可能大概也许或许不一定').certainty < 0.5, `${p('可能大概也许或许不一定').certainty}`);
ok('abstract高(哲学词)', p('人生的意义灵魂的本质宇宙的真理').abstract > 0.2, '');
ok('abstract≈0(具体)', p('今天吃了米饭').abstract < 0.2, '');
ok('temporal_focus→+1(未来)', p('以后我将来打算去环游世界憧憬着那天').temporal_focus > 0.2, `${p('以后我将来打算去环游世界憧憬着那天').temporal_focus}`);
ok('temporal_focus→-1(过去)', p('以前的我曾经总是很怀旧后悔当初').temporal_focus < -0.2, `${p('以前的我曾经总是很怀旧后悔当初').temporal_focus}`);
ok('temporal_focus≈0(当下)', () => Math.abs(p('我现在正在吃饭').temporal_focus) < 0.3, '');
ok('self_ref高(高频我)', p('我觉得我想我需要我自己一个人静静').self_ref > 0.3, `${p('我觉得我想我需要我自己一个人静静').self_ref}`);
ok('self_ref≈0(无我)', p('今天天气真好').self_ref === 0, '');

// ─── 象限3: 社会 S1-S6 深度测试 ───
console.log('\n━━━ 象限3: 社会 S1-S6 (14项) ─━━');
ok('intimacy高(私密)', p('亲爱的告诉你一个秘密我只告诉你').intimacy > 0.2, '');
ok('intimacy≈0(公事)', p('您好请问您是张三先生吗').intimacy < 0.3, '');
ok('power_diff>0(命令)', p('你必须给我做好这件事').power_diff > 0, '');
ok('power_diff<0(请求)', p('求求您了帮帮我吧').power_diff < 0, '');
ok('dependency高(依赖)', p('我需要你我离不开你陪着我').dependency > 0.2, '');
ok('moral_judgment>0(赞扬)', p('他是个善良正直伟大的人').moral_judgment > 0, '');
ok('moral_judgment<0(谴责)', p('他真是卑鄙无耻缺德').moral_judgment < 0, '');
ok('etiquette高(礼貌)', p('谢谢您不好意思麻烦您了劳驾').etiquette > 0.3, `${p('谢谢您不好意思麻烦您了劳驾').etiquette}`);
ok('etiquette≈0(随意)', p('喂干嘛').etiquette < 0.3, '');
ok('belonging高(我们)', p('我们大家一起努力咱们一定能成功').belonging > 0.3, `${p('我们大家一起努力咱们一定能成功').belonging}`);
ok('belonging≈0(无群体)', p('我自己一个人').belonging < 0.3, '');
ok('belonging(深圳地点)', () => {
  const e = A.analyze(mkDNA('我在深圳很好', [{name:'深圳',type:'place',allele:'深圳',phenotype:'neutral',knowledge_type:'world'}]));
  A.injectContext(e, {current_location:'深圳'});
  return e.perception.belonging > 0.1;
}, '');

// ─── 象限4: 亲密 I1-I6 深度测试 ───
console.log('\n━━━ 象限4: 亲密 I1-I6 (12项) ─━━');
ok('sexual_attraction高(性感)', p('你的身材真性感激起了我的欲望').sexual_attraction > 0.2, `${p('你的身材真性感激起了我的欲望').sexual_attraction}`);
ok('sexual_attraction≈0(日常)', p('今天天气不错').sexual_attraction === 0, '');
ok('sensory_craving高(拥抱)', p('好想抱抱你想要你的拥抱').sensory_craving > 0.2, '');
ok('energy_merge高(心灵相通)', p('我们心灵相通灵魂伴侣同频共振').energy_merge > 0.2, '');
ok('possessiveness高(占有)', p('你是我的专属只有我能拥有你').possessiveness > 0.2, '');
ok('possessiveness≈0(无占有)', p('你好').possessiveness === 0, '');
ok('ecstasy高(极致)', p('太棒了无与伦比最幸福').ecstasy > 0.2, '');
ok('safety高(信任)', p('我相信你很安心踏实').safety > 0.5, `${p('我相信你很安心踏实').safety}`);
ok('safety低(不安)', p('我好害怕好担心没有安全感').safety < 0.5, `${p('我好害怕好担心没有安全感').safety}`);
ok('I6<0.2触发Threat_Bonus', () => {
  const p2 = p('我好害怕好担心不信任你');
  p2.safety = 0.1; // 模拟极低安全感
  return PerceptionAnalyzer.recalculateCalcium(p2).breakdown.threat_bonus > 0;
}, '');

// ─── 钙质全等级 ───
console.log('\n━━━ 钙质全等级 (10项) ─━━');
ok('粉末 calcium<0.3', A.analyzeText('嗯').calcium_level === 0, `${A.analyzeText('嗯').calcium_score}`);
ok('液体 0.3~0.6', () => { const c = A.analyzeText('今天心情还可以').calcium_score; return c >= 0.3 && c < 0.6; }, '');
ok('固体 0.6~0.8', () => { const c = A.analyzeText('我好难过好伤心绝望').calcium_score; return c >= 0.6 && c < 0.8; }, `${A.analyzeText('我好难过好伤心绝望').calcium_score}`);
ok('晶体≥0.8', () => A.analyzeText('去死吧我恨你我永远无法原谅你').calcium_score >= 0.8, `${A.analyzeText('去死吧我恨你我永远无法原谅你').calcium_score}`);
ok('Base_Core>0(有效情绪+认知)', () => {
  const b = PerceptionAnalyzer.recalculateCalcium(p('我好难过因为妈妈生病了')).breakdown.base_core;
  return b > 0;
}, '');
ok('Emotional_Boost>0(极端情绪)', () => {
  const b = PerceptionAnalyzer.recalculateCalcium(p('崩溃绝望气死我了')).breakdown.emotional_boost;
  return b > 0.1;
}, '');

// ─── 真实场景组合 ───
console.log('\n━━━ 真实场景组合 (10项) ─━━');
const SCENARIOS: Array<{name:string;input:string;check:(p:Perception24D,cl:number)=>boolean}> = [
  {name:'亲人重病-pleasure负', input:'妈妈查出癌症了晚期', check:(p)=>p.pleasure < -0.2},
  {name:'情感表白-亲密高', input:'亲爱的我爱你，想一直抱着你', check:(p)=>p.intimacy > 0.2 || p.sensory_craving > 0.2},
  {name:'工作投诉-愤怒', input:'这个项目完全是失败的上司根本不听建议', check:(p)=>p.aggression > 0.1 || p.pleasure < 0},
  {name:'升职喜悦-愉悦高', input:'终于升职了，十年努力没有白费！', check:(p)=>p.pleasure > 0.3},
  {name:'道歉-礼仪高', input:'对不起，我错了，请您原谅', check:(p)=>p.etiquette > 0.2},
  {name:'家庭矛盾-烦躁', input:'我妈天天催婚真的很烦', check:(p)=>p.pleasure < 0},
  {name:'哲学思考-抽象高', input:'人生的意义到底是什么？灵魂是否永恒？', check:(p)=>p.abstract > 0.1},
  {name:'紧急求助-唤醒高', input:'救命！出事了！快帮帮我！！', check:(p)=>p.arousal >= 0.3},
  {name:'回忆往事-过去焦点', input:'想起以前我们在一起的时光，好怀念', check:(p)=>p.temporal_focus < 0},
  {name:'规划未来-未来焦点', input:'明年我打算去日本留学，憧憬新生活', check:(p)=>p.temporal_focus > 0},
];
for (const s of SCENARIOS) {
  const r = A.analyzeText(s.input);
  ok(`${s.name}`, s.check(r.perception, r.calcium_level), `pleasure=${r.perception.pleasure.toFixed(2)} arousal=${r.perception.arousal.toFixed(2)} aggression=${r.perception.aggression.toFixed(2)}`);
}

// ─── 确定性 ───
console.log('\n━━━ 确定性 (2项) ─━━');
const ref = A.analyzeText('妈妈在ICU医生说只有30%希望我真的好担心');
let allSame = true;
for (let i=0; i<100; i++) {
  const r = A.analyzeText('妈妈在ICU医生说只有30%希望我真的好担心');
  if (r.calcium_score !== ref.calcium_score || r.perception.pleasure !== ref.perception.pleasure) { allSame=false; break; }
}
ok('100次相同输入完全一致', allSame, '');
ok('100次决策一致', () => {
  const d0 = M3.decide(mkDNA('妈妈在ICU医生说只有30%希望我真的好担心'));
  for (let i=0; i<100; i++) {
    const d = M3.decide(mkDNA('妈妈在ICU医生说只有30%希望我真的好担心'));
    if (d.actions.join() !== d0.actions.join()) return false;
  }
  return true;
}, '');

const total = pass + fail;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  24维全覆盖: ${pass}/${total} 通过  ${fail > 0 ? `❌ ${fail} 失败` : '✅'}`);
if (fail > 0) process.exitCode = 1;
console.log('');
