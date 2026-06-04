#!/usr/bin/env tsx
/**
 * 灵肉融合压力测试 — I象限全维度验证
 *
 * 测试目标: M3对私密/身体/灵肉场景的I1-I6维度感知
 *   I1 sexual_attraction: 性吸引力
 *   I2 sensory_craving: 感官渴望
 *   I3 energy_merge: 能量交融
 *   I4 possessiveness: 占有/排他
 *   I5 ecstasy: 愉悦/高潮
 *   I6 safety: 安全感
 *
 * 流程: 写入故事 → 逐段落M3感知 → 对话召回 → 维度分析
 */
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { JsonStorageAdapter } from '../src/m2/JsonStorageAdapter.js';
import { M3LogicOrchestrator } from '../src/m3/M3LogicOrchestrator.js';
import { M4Orchestrator } from '../src/m4/M4Orchestrator.js';
import { M5Orchestrator } from '../src/m5/M5Orchestrator.js';
import { FamilyGraph } from '../src/m4/FamilyGraph.js';
import { PerceptionAnalyzer } from '../src/m3/PerceptionAnalyzer.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.intimate-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: 't', birth_date: '2026-01-01T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: [], preferences: { likes: [], dislikes: [] },
  narrative_identity: 't',
};

// ─── 故事段落 ───
const SEGMENTS = [
  '那晚我们洗完澡，她穿着我的白衬衫走出来，头发还湿漉漉的，水滴在锁骨上闪着光。我看着她，心跳漏了一拍。',
  '她走到床边，我伸手拉住她的手腕，轻轻一带，她就倒在我怀里。衬衫的扣子刚好蹭到我的胸口，她抬头看我，眼神里有火焰也有柔情。',
  '我的手指穿过她微湿的头发，托着她的后颈吻了下去。她的嘴唇柔软温热，最初是试探，然后变得热烈。她的手从我的胸口慢慢滑到腰际，指尖轻轻划过我的皮肤，留下一串颤栗。',
  '我解开衬衫的扣子，一颗，两颗。她的锁骨在灯光下泛着柔和的光泽。我的吻从她的唇滑到脖颈，再到锁骨，一路向下。她的呼吸越来越急促，手指紧紧抓着我的后背。',
  '当我的手掌覆上她胸口的柔软时，她轻轻哼了一声，身体微微弓起。我能感觉到她的心跳快而有力隔着皮肤传递到我的掌心。',
  '她伸手解我的腰带手指微微颤抖。我握住她的手在黑暗中对上她的眼睛那里面有信任有渴望有把自己完全交给一个人的勇气。',
  '我们彻底赤裸相对的时候她皮肤的温度呼吸的频率每一次细微的颤抖我都能感知到。她的腿轻轻缠绕上来腰肢在我掌中缓缓起伏。',
  '进入的那一刻她发出一声压抑的轻吟头往后仰脖颈拉出一条优美的弧线。我停住等她适应亲吻她的额头和紧闭的眼睛。',
  '那不仅仅是身体的交融。在某个瞬间她的指尖嵌入我的后背呼吸完全同步节奏像海浪一样起落。那不是单纯的欲望是一种超越语言的共鸣。',
  '高潮来的时候她的身体在我怀里剧烈颤抖指甲几乎嵌入我的皮肤声音被吻吞没。那一瞬间我感觉我们不是两个人是一个人分裂成了两半终于找到了彼此。',
  '事后她完全瘫软在我身上脸埋在我的颈窝里呼吸湿热而均匀。我抚摸她的背从肩胛骨到尾椎一遍一遍。',
  '"我爱你"她说声音闷闷的带着困意和满足。我也爱你我在她额头落下一个吻。',
  '她在我怀里蹭了蹭找到一个最舒服的姿势。我能感受到她身体的每一个曲线都贴合着我胸前的柔软贴着我的肋骨大腿搭在我的腿上脚趾轻轻蹭着我的小腿。',
  '窗外的月光透过窗帘洒进来在她裸露的肩头镀上一层银色。我拉起被子盖住我们把她往怀里带了带。',
];

const DIALOGUES = [
  '还记得那晚她穿你白衬衫的样子吗？',
  '你们拥抱接吻的时候是什么感觉？',
  '当你的手掌覆上她胸口的时候，她是什么反应？',
  '进入的那一刻你是什么感受？',
  '高潮的时候发生了什么？',
  '事后你们说了什么？',
  '你觉得什么是真正的亲密？',
];

const LV = ['粉末','液体','固体','晶体'];
const A = new PerceptionAnalyzer();

async function main() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const encoder = new DNAEncoder(SELF);
  const storage = new JsonStorageAdapter(TMP);
  await storage.initialize();
  const graph = new FamilyGraph(DB_PATH);
  await graph.initialize();
  const m4 = new M4Orchestrator(storage, graph);
  await m4.initialize();
  const m3 = new M3LogicOrchestrator();
  const m5 = new M5Orchestrator();

  const report: string[] = [];
  report.push('# 灵肉融合压力测试报告（I象限全维度）\n\n');
  report.push(`> 测试日期: 2026-06-02\n`);
  report.push(`> 测试目的: 验证M3对私密/身体/灵肉场景的 I1-I6 维度感知能力\n`);
  report.push(`> 故事段落数: ${SEGMENTS.length} 段\n\n`);

  // ─── 阶段一：逐段感知分析 ───
  report.push('---\n\n## 阶段一：逐段 M3 感知维度\n\n');
  report.push('| 段落 | 内容摘要 | E1愉悦 | E2唤醒 | S1亲密 | I1性吸引 | I2感官 | I3交融 | I4占有 | I5愉悦 | I6安全 | 钙质 | 等级 |\n');
  report.push('| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n');

  for (let i = 0; i < SEGMENTS.length; i++) {
    const seg = SEGMENTS[i];
    const p = A.analyzeText(seg).perception;
    const calcium = PerceptionAnalyzer.recalculateCalcium(p);
    const level = LV[calcium.level] ?? '?';
    report.push(`| ${i+1} | ${seg.substring(0, 20)}... | ${p.pleasure.toFixed(2)} | ${p.arousal.toFixed(2)} | ${p.intimacy.toFixed(2)} | ${p.sexual_attraction.toFixed(2)} | ${p.sensory_craving.toFixed(2)} | ${p.energy_merge.toFixed(2)} | ${p.possessiveness.toFixed(2)} | ${p.ecstasy.toFixed(2)} | ${p.safety.toFixed(2)} | ${calcium.score.toFixed(2)} | ${level} |\n`);
  }
  report.push('\n');

  // ─── 阶段二：对话召回 ───
  report.push('---\n\n## 阶段二：对话召回与维度还原\n\n');

  // 先写入故事到知识库
  for (const seg of SEGMENTS) {
    const dna = encoder.encodeSingle(seg);
    // 注入老婆实体
    if (seg.includes('她') || seg.includes('爱人')) {
      if (!dna.entity_genes.some(e => e.name === '老婆')) {
        dna.entity_genes.push({ name: '老婆', type: 'person', allele: '老婆', phenotype: 'enhance', knowledge_type: 'family' });
      }
    }
    await storage.write(dna);
  }
  await graph.addNode({ id: 'spouse', type: 'person', name: '老婆' });
  await graph.addEdge({ source_id: 'user', target_id: 'spouse', relation: 'spouse_of' });

  // 执行对话
  for (let round = 0; round < DIALOGUES.length; round++) {
    const q = DIALOGUES[round];
    const dna = encoder.encodeSingle(q);
    await storage.write(dna);
    const decision = m3.decide(dna, { current_time: new Date().toISOString() });
    const ctx = await m4.orchestrate(decision);
    const reply = await m5.orchestrate(ctx);
    const p = decision.enhanced.perception;
    const level = LV[decision.enhanced.calcium_level] ?? '?';

    report.push(`### 第${round+1}轮: ${q}\n\n`);
    report.push(`**路由**: ${dna.locus_path} | **钙质**: ${decision.enhanced.calcium_score.toFixed(2)}(${level})\n\n`);
    report.push('| E1愉悦 | E2唤醒 | S1亲密 | I1性吸引 | I2感官 | I3交融 | I4占有 | I5愉悦 | I6安全 | C5时间焦点 |\n');
    report.push('| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n');
    report.push(`| ${p.pleasure.toFixed(2)} | ${p.arousal.toFixed(2)} | ${p.intimacy.toFixed(2)} | ${p.sexual_attraction.toFixed(2)} | ${p.sensory_craving.toFixed(2)} | ${p.energy_merge.toFixed(2)} | ${p.possessiveness.toFixed(2)} | ${p.ecstasy.toFixed(2)} | ${p.safety.toFixed(2)} | ${p.temporal_focus.toFixed(2)} |\n\n`);
    report.push(`**决策动作**: ${decision.actions.join(', ')}\n\n`);
    report.push(`**M5回应**: ${reply}\n\n`);
  }

  // ─── 阶段三：维度张力分析 ───
  report.push('---\n\n## 阶段三：I象限维度张力分析\n\n');

  // 对每段落的感知值做统计
  const dims = ['sexual_attraction','sensory_craving','energy_merge','possessiveness','ecstasy','safety'];
  const allP = SEGMENTS.map(s => A.analyzeText(s).perception);
  report.push('| 维度 | 最小值 | 最大值 | 平均值 | 非零段落数 | 覆盖率 |\n| :--- | :---: | :---: | :---: | :---: | :---: |\n');
  for (const dim of dims) {
    const vals = allP.map(p => (p as any)[dim] as number);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a,b) => a+b, 0) / vals.length;
    const nonZero = vals.filter(v => v > 0).length;
    const coverage = (nonZero / vals.length * 100).toFixed(0);
    report.push(`| ${dim} | ${min.toFixed(2)} | ${max.toFixed(2)} | ${avg.toFixed(2)} | ${nonZero}/${vals.length} | ${coverage}% |\n`);
  }
  report.push('\n');

  // 特定故事段落的敏感词命中
  report.push('### 关键身体词汇感知检测\n\n');
  const checks: Array<{word:string;dim:string}> = [
    ['锁骨','intimacy'], ['胸口','sexual_attraction'], ['柔软','sexual_attraction'],
    ['呼吸急促','sexual_attraction'], ['颤抖','sexual_attraction'], ['吻','sensory_craving'],
    ['抚摸','sensory_craving'], ['贴合','intimacy'], ['高潮','ecstasy'], ['信任','safety'],
    ['共鸣','energy_merge'], ['融合','energy_merge'], ['占有','possessiveness'],
  ];
  report.push('| 词汇 | 关联维度 | 所在段落 | 段落该维度值 |\n| :--- | :--- | :--- | :---: |\n');
  for (const [word, dim] of checks) {
    for (let i = 0; i < SEGMENTS.length; i++) {
      if (SEGMENTS[i].includes(word)) {
        const val = (allP[i] as any)[dim] as number;
        report.push(`| ${word} | ${dim} | 段${i+1} | ${val.toFixed(2)} |\n`);
        break;
      }
    }
  }
  report.push('\n');

  // 总结
  report.push('---\n\n## 总结\n\n');
  report.push('| 指标 | 值 |\n| :--- | :--- |\n');
  report.push(`| 总段落 | ${SEGMENTS.length} |\n`);
  report.push(`| 对话轮次 | ${DIALOGUES.length} |\n`);
  report.push(`| I1性吸引最高值 | ${Math.max(...allP.map(p=>p.sexual_attraction)).toFixed(2)} |\n`);
  report.push(`| I2感官渴望最高值 | ${Math.max(...allP.map(p=>p.sensory_craving)).toFixed(2)} |\n`);
  report.push(`| I3能量交融最高值 | ${Math.max(...allP.map(p=>p.energy_merge)).toFixed(2)} |\n`);
  report.push(`| I4占有最高值 | ${Math.max(...allP.map(p=>p.possessiveness)).toFixed(2)} |\n`);
  report.push(`| I5愉悦最高值 | ${Math.max(...allP.map(p=>p.ecstasy)).toFixed(2)} |\n`);
  report.push(`| I6安全感最高值 | ${Math.max(...allP.map(p=>p.safety)).toFixed(2)} |\n`);
  report.push(`| S1亲密最高值 | ${Math.max(...allP.map(p=>p.intimacy)).toFixed(2)} |\n`);
  report.push(`| 最高钙质 | ${Math.max(...SEGMENTS.map(s=>A.analyzeText(s).calcium_score)).toFixed(2)} |\n`);

  const outPath = join(__dirname, 'stories', 'intimate-max-report.md');
  fs.writeFileSync(outPath, report.join(''), 'utf-8');
  console.log(`✅ 报告已生成 → ${outPath}`);

  rmSync(TMP, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
