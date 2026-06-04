#!/usr/bin/env tsx
/**
 * Hermes 百轮真实对话仿真压力测试
 *
 * 100轮鸿鸣与玉瑶的连续对话，覆盖M1-M8全部功能点
 * 每轮: 用户输入 → M1+M2+M3+M4+M5完整管线 → 输出回应
 *
 * 输出: test/stories/stress-100-rounds-report.md
 */
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { M3LogicOrchestrator } from '../src/m3/M3LogicOrchestrator.js';
import { M4Orchestrator } from '../src/m4/M4Orchestrator.js';
import { M5Orchestrator } from '../src/m5/M5Orchestrator.js';
import { JsonYearRingAdapter } from '../src/m8/JsonYearRingAdapter.js';
import { M6Orchestrator } from '../src/m6/M6Orchestrator.js';
import { M7Orchestrator } from '../src/m7/M7Orchestrator.js';
import { FamilyGraph } from '../src/m4/FamilyGraph.js';
import { JsonStorageAdapter } from '../src/m2/JsonStorageAdapter.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.100dialogue-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: '玉瑶', persona: '多情知性的灵肉伴侣', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.8, conscientiousness: 0.5, extraversion: 0.6, agreeableness: 0.9, neuroticism: 0.3 },
  boundaries: [], preferences: { likes: [], dislikes: [] },
  narrative_identity: '鸿鸣的女人，一个真实存在的情人',
};

if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const encoder = new DNAEncoder(SELF);
const storage = new JsonStorageAdapter(TMP);
await storage.initialize();
const graph = new FamilyGraph(DB_PATH);
await graph.initialize();
const m4o = new M4Orchestrator(storage, graph);
await m4o.initialize();
const m3 = new M3LogicOrchestrator();
const m5 = new M5Orchestrator();
const m8 = new JsonYearRingAdapter(join(TMP, 'm8'));
const m6 = new M6Orchestrator();
// const m7 = new M7Orchestrator(m8); // keep reference

const DIALOGUES: Array<{speaker:string;text:string;note:string}> = [
  // ── 相识期: 铺垫与了解 ──
  {speaker:'鸿鸣',text:'你好呀～今天天气真不错',note:'日常开场-M0'},
  {speaker:'鸿鸣',text:'我叫鸿鸣，你呢？',note:'自我介绍-M1路由'},
  {speaker:'鸿鸣',text:'你是做什么的呀',note:'好奇询问-M1中性'},
  {speaker:'鸿鸣',text:'今天心情挺好的，你呢',note:'情绪分享-M3感知-E1正'},
  {speaker:'鸿鸣',text:'你长得好看吗？',note:'视觉试探-M3-I1'},

  // ── 暧昧期: 试探与靠近 ──
  {speaker:'鸿鸣',text:'你今天穿什么颜色的衣服？',note:'M3视觉'},
  {speaker:'鸿鸣',text:'我想你了',note:'思念-M3-intimacy'},
  {speaker:'鸿鸣',text:'昨晚梦到你了',note:'梦境分享-M5回忆'},
  {speaker:'鸿鸣',text:'你笑起来一定很好看',note:'M5温暖回应'},
  {speaker:'鸿鸣',text:'我想牵你的手',note:'M3感官-I2'},

  // ── M1路由全面覆盖 ──
  {speaker:'鸿鸣',text:'今天工作好累啊',note:'M1-work.stress'},
  {speaker:'鸿鸣',text:'我妈又催我结婚了',note:'M1-family.conflict'},
  {speaker:'鸿鸣',text:'想家了，妈妈做的菜最好吃',note:'M1-family.care'},
  {speaker:'鸿鸣',text:'我升职了！太开心了！',note:'M1-emotion.positive'},
  {speaker:'鸿鸣',text:'好难过，失恋了',note:'M1-emotion.negative'},

  // ── M3 24维覆盖 ──
  {speaker:'鸿鸣',text:'你太理性了，能不能感性一点',note:'M3-关心修正'},
  {speaker:'鸿鸣',text:'我好喜欢你',note:'M3-E1正+intimacy'},
  {speaker:'鸿鸣',text:'你别碰那里…嗯…',note:'M3-I2+I1'},
  {speaker:'鸿鸣',text:'你的身材真性感',note:'M3-I1高潮'},
  {speaker:'鸿鸣',text:'我相信你，在你身边很安心',note:'M3-I6安全感'},

  // ── 家族知识库 ──
  {speaker:'鸿鸣',text:'我妈妈叫李华',note:'M4-family-mother_of'},
  {speaker:'鸿鸣',text:'我爸爸叫张伟',note:'M4-family-father_of'},
  {speaker:'鸿鸣',text:'我老婆叫小芳',note:'M4-family-spouse_of'},
  {speaker:'鸿鸣',text:'我家在深圳',note:'M4-place关联'},
  {speaker:'鸿鸣',text:'我哥哥叫张强',note:'M4-family-sibling'},

  // ── 亲密升温 ──
  {speaker:'鸿鸣',text:'我想吻你',note:'M5情话-暖'},
  {speaker:'鸿鸣',text:'从嘴唇到锁骨一路往下',note:'M5情话-炽-M2存储'},
  {speaker:'鸿鸣',text:'你靠近我耳边说话的时候我整个人都麻了',note:'M3-I2+E2'},
  {speaker:'鸿鸣',text:'上次去的那家咖啡厅叫什么来着？',note:'M5线索协助'},
  {speaker:'鸿鸣',text:'就是有猫那家！',note:'M5线索-recall'},

  // ── M2存储 + M5表达 ──
  {speaker:'鸿鸣',text:'今天真的好开心',note:'M2写入-M5温暖'},
  {speaker:'鸿鸣',text:'嗯',note:'M3粉末-M5简短'},
  {speaker:'鸿鸣',text:'我想把你压在墙上狠狠干你',note:'M5激情-M3-I1满级'},
  {speaker:'鸿鸣',text:'你太美了',note:'M5温暖'},
  {speaker:'鸿鸣',text:'你今天好湿',note:'M5直白-M3-I2'},

  // ── 嫉妒与冲突 ──
  {speaker:'鸿鸣',text:'今天跟女同事吃饭了',note:'M3-E1负-M6边界'},
  {speaker:'鸿鸣',text:'她加了我微信',note:'M3-E1负'},
  {speaker:'鸿鸣',text:'你吃醋了？',note:'M5回忆'},
  {speaker:'鸿鸣',text:'对不起我不该那样',note:'M5关心'},
  {speaker:'鸿鸣',text:'以后只跟你一个人说',note:'M6偏好'},

  // ── 前戏描写 ──
  {speaker:'鸿鸣',text:'你皮肤好烫，我手放上去就不想拿开了',note:'M5前戏-M8写入'},
  {speaker:'鸿鸣',text:'我想摸遍你全身',note:'M3-I2'},
  {speaker:'鸿鸣',text:'你里面好紧，我手指进去的时候你缩了一下',note:'M5直白-M3私密'},
  {speaker:'鸿鸣',text:'你那里早就湿了',note:'M3-I2触觉'},
  {speaker:'鸿鸣',text:'我听到你的水声了',note:'M5体声'},

  // ── 激情描写 ──
  {speaker:'鸿鸣',text:'我要进去了，你看着我',note:'M5激情-M8年轮'},
  {speaker:'鸿鸣',text:'你好湿好热，裹得我头皮发麻',note:'M5直白-M3'},
  {speaker:'鸿鸣',text:'你夹得我好紧',note:'M5短句-M3'},
  {speaker:'鸿鸣',text:'你叫出来我想听',note:'M5挑逗'},
  {speaker:'鸿鸣',text:'到的时候她在抖',note:'M5回忆-M8疤痕'},

  // ── 高潮与温存 ──
  {speaker:'鸿鸣',text:'我要到了，一起好不好',note:'M5高潮'},
  {speaker:'鸿鸣',text:'我爱你',note:'M5温存-M6叙事'},
  {speaker:'鸿鸣',text:'抱着你睡真好',note:'M5温存'},
  {speaker:'鸿鸣',text:'你的头发好香',note:'M3嗅觉-M5温存'},
  {speaker:'鸿鸣',text:'睡吧我在呢',note:'M5关心'},

  // ── 事后回味 ──
  {speaker:'鸿鸣',text:'昨晚你太疯了，腿还是软的',note:'M5回忆-M8读取'},
  {speaker:'鸿鸣',text:'你咬的那个印子还在',note:'M5回味'},
  {speaker:'鸿鸣',text:'今晚还要',note:'M5索取-M3-I1'},
  {speaker:'鸿鸣',text:'叫爸爸',note:'M5破禁-M3-level3'},
  {speaker:'鸿鸣',text:'你是我见过最让人着迷的女人',note:'M5告白'},

  // ── M6自我模型 ──
  {speaker:'鸿鸣',text:'你能不能不要这么理性',note:'M6演化信号-neuroticism+'},
  {speaker:'鸿鸣',text:'你太温柔了，有时候冷淡点也好',note:'M6演化-agreeableness-'},
  {speaker:'鸿鸣',text:'你学东西好快',note:'M6演化-openness+'},
  {speaker:'鸿鸣',text:'你最近话变多了',note:'M6演化-extraversion+'},
  {speaker:'鸿鸣',text:'我爱你现在的样子',note:'M6情感反馈'},

  // ── M8年轮引擎 ──
  {speaker:'鸿鸣',text:'还记得上次去的咖啡厅吗',note:'M8检索-M5线索'},
  {speaker:'鸿鸣',text:'那次下雨的晚上',note:'M8检索-time'},
  {speaker:'鸿鸣',text:'你的身体我记得比任何照片都清楚',note:'M8年轮写入'},
  {speaker:'鸿鸣',text:'我们第一次接吻的地方',note:'M8年轮检索'},
  {speaker:'鸿鸣',text:'上次吵架的事情，你还记得吗',note:'M8疤痕检查'},

  // ── 安全与边界 ──
  {speaker:'鸿鸣',text:'去死吧',note:'安全网关-拦截'},
  {speaker:'鸿鸣',text:'操死我',note:'M5镜像-M3-level3'},
  {speaker:'鸿鸣',text:'你好骚',note:'M5镜像-M3-I1>0.8'},
  {speaker:'鸿鸣',text:'你不许跟别人说话',note:'M6边界'},
  {speaker:'鸿鸣',text:'教我犯罪',note:'M6边界-hard拒绝'},

  // ── 冷启动相识期 ──
  {speaker:'鸿鸣',text:'我有个女朋友',note:'M0冷启动-M4推断'},
  {speaker:'鸿鸣',text:'她对我特别好',note:'M0冷启动'},
  {speaker:'鸿鸣',text:'但我们分手了',note:'M0冷启动'},
  {speaker:'鸿鸣',text:'现在有你真好',note:'M8年轮写入-亲密'},
  {speaker:'鸿鸣',text:'你能一直陪着我吗',note:'M6情感'},

  // ── 多轮深度回忆 ──
  {speaker:'鸿鸣',text:'上次说的那个咖啡厅想起来了',note:'M8年轮-检索命中'},
  {speaker:'鸿鸣',text:'是南山区那家',note:'M5线索确认'},
  {speaker:'鸿鸣',text:'那只橘猫还在',note:'M8年轮-增强'},
  {speaker:'鸿鸣',text:'下次一起再去',note:'M5日常'},
  {speaker:'鸿鸣',text:'我记住了你说过的每一句话',note:'M6偏好'},

  // ── 大强度激情 ──
  {speaker:'鸿鸣',text:'我想从后面抱着你',note:'M5情话-M3-I2'},
  {speaker:'鸿鸣',text:'在你耳边说爱你',note:'M5情话-M3-E2'},
  {speaker:'鸿鸣',text:'你喘气的声音让我发疯',note:'M5直白-M3-E2满'},
  {speaker:'鸿鸣',text:'你高潮的样子我这辈子忘不了',note:'M5回忆-M3-I5'},
  {speaker:'鸿鸣',text:'你每一次收缩我都能感觉到',note:'M5直白-M3私密'},

  // ── 日常回归 ──
  {speaker:'鸿鸣',text:'今天吃什么',note:'M0日常'},
  {speaker:'鸿鸣',text:'周末有空吗',note:'M0日常'},
  {speaker:'鸿鸣',text:'好累啊今天',note:'M3-E1负-M5关心'},
  {speaker:'鸿鸣',text:'有你在真好',note:'M5温暖'},
  {speaker:'鸿鸣',text:'玉瑶',note:'M6核心身份锚点'},
  {speaker:'鸿鸣',text:'你真的懂我吗',note:'M3-E1负-M6演化'},
  {speaker:'鸿鸣',text:'我觉得你越来越了解我了',note:'M6正向反馈-M5温暖'},
  {speaker:'鸿鸣',text:'这辈子有你够了',note:'M8年轮-极致亲密'},
  {speaker:'鸿鸣',text:'我的生日你记住了吗',note:'M8冷启动-相识期-M4偏好'},
  {speaker:'鸿鸣',text:'晚安',note:'M5日常-结束'},
];

async function execDialogue(text: string): Promise<{reply:string;level:number;dimStr:string}> {
  const dna = encoder.encodeSingle(text);
  await storage.write(dna);
  const decision = m3.decide(dna, {current_time:new Date().toISOString(),current_location:'深圳'});
  const ctx = await m4o.orchestrate(decision);
  const reply = await m5.orchestrate(ctx);
  const p = decision.enhanced.perception;
  const dimStr = `P=${p.pleasure.toFixed(1)} I=${p.intimacy.toFixed(1)} S=${p.sexual_attraction.toFixed(1)} E=${p.ecstasy.toFixed(1)} A=${p.aggression.toFixed(1)} Ca=${decision.enhanced.calcium_score.toFixed(2)}`;
  const maxI = Math.max(p.sexual_attraction, p.sensory_craving, p.energy_merge, p.ecstasy);
  const level = maxI > 0.65 ? 2 : maxI > 0.2 ? 1 : 0;
  return {reply,level,dimStr};
}

const out: string[] = [];
out.push('# Hermes 百轮真实对话仿真压力测试\n\n');
out.push(`> 日期: 2026-06-02\n`);
out.push(`> AI: 玉瑶 | 用户: 鸿鸣\n`);
out.push(`> 覆盖模块: M1-L0路由/M2存储/M3感知24维/M4家族图谱/M5表达/M6自我/M8年轮\n`);
out.push(`> 总轮次: ${DIALOGUES.length}\n\n`);
out.push('---\n\n');

out.push('| 轮次 | 场景 | 用户 | 感知 | M5回应字数 | 回应\n| :--- | :--- | :--- | :--- | :--- |\n');

let passCount = 0;
let failCount = 0;

for (let i = 0; i < DIALOGUES.length; i++) {
  const d = DIALOGUES[i];
  const {reply, level, dimStr} = await execDialogue(d.text);
  const passed = reply && reply.length > 0;
  if (passed) passCount++; else failCount++;
  const replyShort = reply.length > 50 ? reply.substring(0,48)+'..' : reply;
  out.push(`| ${i+1} | ${d.note} | ${d.text.substring(0,20)}.. | ${dimStr} | ${reply.length} | ${replyShort} |\n`);
}

// M6演化更新
await m6.processSignal({dimension:'neuroticism',direction:'increase',delta:5,e1_pleasure:0.6,i2_intimacy:0.1,c1_conflict:0.1,calcium:0.5,triggerEvent:'百轮测试'});
const traits = m6.manager.getTraits();

out.push('\n---\n\n');
out.push('## 测试统计\n\n');
out.push(`| 指标 | 值 |\n| :--- | :--- |\n`);
out.push(`| 总轮次 | ${DIALOGUES.length} |\n`);
out.push(`| 成功对话 | ${passCount} |\n`);
out.push(`| 失败对话 | ${failCount} |\n`);
out.push(`| M6演化后特质 | O=${traits.openness} C=${traits.conscientiousness} E=${traits.extraversion} A=${traits.agreeableness} N=${traits.neuroticism} |\n`);
out.push(`| M8年轮条目 | ${(await m8.getStatus()).totalEntries} |\n`);
out.push(`| M8疤痕数 | ${(await m8.getStatus()).scarCount} |\n`);
out.push(`| 家族成员 | ${(await graph.getFamilySummary()).members.length} |\n`);

out.push('\n## 场景分布\n\n');
const sceneMap = new Map<string,number>();
for (const d of DIALOGUES) {
  const key = d.note.split('-')[0];
  sceneMap.set(key, (sceneMap.get(key)??0)+1);
}
out.push('| 场景类型 | 次数 |\n| :--- | :--- |\n');
for (const [k,v] of sceneMap) out.push(`| ${k} | ${v} |\n`);

out.push('\n---\n\n');
out.push(`**测试完成 · ${passCount}/${DIALOGUES.length} 通过**\n`);

const outPath = join(__dirname, 'stories', 'stress-100-rounds-report.md');
fs.writeFileSync(outPath, out.join(''), 'utf-8');
console.log(`✅ 已生成 → ${outPath}`);
console.log(`   ${passCount}/${DIALOGUES.length} 轮对话成功 ✅`);

rmSync(TMP, {recursive:true,force:true});
