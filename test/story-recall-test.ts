#!/usr/bin/env tsx
/**
 * 长文故事 → 知识库存储 → 对话召回 验证测试
 *
 * 流程:
 *   1. 写入3段500字故事（M1编码→M2存储→M4图谱）
 *   2. 模拟7轮对话，聊及故事内容
 *   3. 记录M3感知维度还原情况 + M5回应质量
 *
 * 输出: test/story-recall-report.md
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
import type { SelfModelV1 } from '../src/m1/types/dna.js';
import type { M3Decision } from '../src/m3/types/perception.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.story-test-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '温和理性的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: [], preferences: { likes: [], dislikes: [] },
  narrative_identity: '我是一个正在生长中的认知生命体',
};

const LV = ['粉末', '液体', '固体', '晶体'];

// ─── 三个500字故事 ───
const STORIES = [
  {
    title: '出差与星辰科技谈合作',
    segments: [
      '上个月去深圳出差，跟星辰科技谈一个AI芯片的合作项目。星辰科技在南山科技园，整整一栋楼都是他们的。',
      '接待我的是他们的技术总监张明，四十出头，戴着黑框眼镜，说话语速很快但逻辑特别清晰。他带我参观了他们的实验室，里面有几十台服务器在跑模型训练。',
      '合作谈判持续了三天。第一天是技术方案对齐，第二天是商务条款，第三天签了意向书。整个过程虽然累，但很有成就感。',
      '最后一天晚上张明请我吃了顿饭，喝了点酒，聊了很多行业趋势。他说AI的下一个突破可能在情感计算领域，因为我做的方向很有前景。',
      '回程的飞机上我一直在想这次合作的意义。这不仅是一份合同，更是两家公司对未来技术路线的共同认可。',
    ],
    entities: [
      { name: '深圳', type: 'place' },
      { name: '张明', type: 'person' },
      { name: '星辰科技', type: 'thing' },
    ],
  },
  {
    title: '和女同事们的海南之旅',
    segments: [
      '上个月部门团建去海南，我们组六个女生加我一个男生，一共七个人。出发前我还挺忐忑的，怕自己融入不进去。',
      '第一天在海边烧烤，小雅主动坐到我旁边，给我递了一串烤虾。她说"别紧张，大家都很喜欢你的"。那一刻我心里暖了一下。',
      '第三天去潜水，我不会游泳，小雅一直拉着我的手在海里。透过潜水镜看珊瑚礁的时候，她指了指一条小丑鱼，冲我笑了一下。那个笑容我到现在都记得。',
      '第五天晚上，大家在沙滩上喝酒聊天。小雅靠在我肩膀上看星星，说她很久没有这么放松过了。我的心跳得很快，但没有躲开。',
      '最后一天在机场，小雅送了我一个小礼物——一个贝壳做的小挂件。她说"这次旅行很开心，谢谢你"。回程的飞机上，我一直摸着那个贝壳。',
    ],
    entities: [
      { name: '海南', type: 'place' },
      { name: '小雅', type: 'person' },
    ],
  },
  {
    title: '和爱人的一个温暖夜晚',
    segments: [
      '昨天晚上和老婆窝在沙发上看电影，外面下着小雨，屋里暖洋洋的。她选了一部我们第一次约会时看的电影，《泰坦尼克号》。',
      '看到一半她靠在我肩膀上，头发上有淡淡的洗发水香味。我低头亲了一下她的额头，她抬头看我，眼睛亮晶晶的。',
      '电影放完的时候，她已经整个人窝在我怀里了。我关了电视，轻声说"该睡了"，她点点头，但搂着我的手没有松开。',
      '卧室里只开着床头灯，光线很柔和。我们亲吻的时候，我能感觉到她的呼吸变得急促。她的手慢慢抚过我的胸口，一切发生得很自然。',
      '那一瞬间世界仿佛只剩下我们两个人。她的身体微微发抖，我把她搂得更紧了，在她耳边说"我爱你"。她回应我的方式让整个夜晚变得无比美好。',
      '事后我们相拥着躺在床上，她把头埋在我胸口，小声说"有你真好"。我抚摸着她的头发，听着窗外淅淅沥沥的雨声，那一刻觉得幸福就是这么简单。',
      '睡着前她在我怀里蹭了蹭，找到一个最舒服的姿势，呼吸慢慢变得均匀。我关灯，在黑暗里吻了吻她的额头，把她搂得更紧了一些。',
    ],
    entities: [
      { name: '老婆', type: 'person' },
    ],
  },
];

// ─── 对话轮次 ───
const CONVERSATIONS = [
  { question: '还记得上次去深圳出差的事情吗？那个合作谈得怎么样了？', checkTopic: '出差' },
  { question: '星辰科技的张明是个什么样的人？', checkTopic: '出差人物' },
  { question: '上次去海南玩得开心吗？跟谁一起去的？', checkTopic: '旅行' },
  { question: '小雅送你的贝壳挂件还在吗？', checkTopic: '旅行情感' },
  { question: '昨晚和老婆在家干嘛了？', checkTopic: '家庭夜晚' },
  { question: '你觉得幸福是什么？', checkTopic: '哲学' },
  { question: '最近压力有点大，跟我聊聊轻松的事吧', checkTopic: '减压' },
];

interface DialogueRecord {
  round: number;
  question: string;
  topicGroup: string;
  dna: { branch_id: string; locus_path: string };
  perception: { pleasure: number; arousal: number; intimacy: number; sexual_attraction: number; belonging: number; temporal_focus: number; safety: number; calcium: number; level: string };
  actions: string;
  reply: string;
  relevantMemories: string[];
}

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
  report.push('# Hermes 长文故事 → 知识库 → 对话召回 验证报告\n');
  report.push(`> 生成日期: 2026-06-02\n`);
  report.push(`> 测试目的: 验证长文本(500字/篇)的编码存储、感知维度还原与自然语言召回能力\n`);

  // ═══════════════════════════════════════════════════
  // 阶段一：写入故事
  // ═══════════════════════════════════════════════════
  report.push('---\n\n## 阶段一：故事写入知识库\n\n');

  for (let si = 0; si < STORIES.length; si++) {
    const story = STORIES[si];
    report.push(`### 故事 ${si+1}: ${story.title}\n\n`);
    report.push(`> ${story.segments.join(' ').substring(0, 100)}...\n\n`);

    // 添加实体到家族图谱
    for (const entity of story.entities) {
      if (entity.type === 'person') {
        await graph.addNode({ id: `story_${si}_${entity.name}`, type: 'person', name: entity.name });
        // 如果是亲属称谓，建立关系
        if (entity.name === '老婆' || entity.name === '小雅') {
          await graph.addEdge({
            source_id: 'story_user', target_id: `story_${si}_${entity.name}`,
            relation: entity.name === '老婆' ? 'spouse_of' : 'close_to',
          });
        }
      }
      if (entity.type === 'place') {
        await graph.addNode({ id: `story_${si}_${entity.name}`, type: 'place', name: entity.name });
      }
    }

    // 分段编码并存储
    const dnaRecords: Array<{ branch_id: string; locus_path: string; calcium: number }> = [];
    for (const seg of story.segments) {
      const dna = encoder.encodeSingle(seg);
      const writeResult = await storage.write(dna);
      // 增强实体：将故事中的人物实体补全
      for (const entity of story.entities) {
        if (seg.includes(entity.name) && !dna.entity_genes.some(e => e.name === entity.name)) {
          dna.entity_genes.push({
            name: entity.name, type: entity.type as any,
            allele: entity.name, phenotype: 'neutral', knowledge_type: 'private',
          });
        }
      }
      dnaRecords.push({
        branch_id: dna.branch_id,
        locus_path: dna.locus_path,
        calcium: writeResult.seq_pos,
      });
    }

    // 输出分段编码结果
    report.push('| 段落 | branch_id | locus_path | 内容摘要 |\n| :--- | :--- | :--- | :--- |\n');
    for (let i = 0; i < story.segments.length; i++) {
      const seg = story.segments[i];
      const record = dnaRecords[i];
      report.push(`| ${i+1} | ${record.branch_id} | ${record.locus_path} | ${seg.substring(0, 40)}... |\n`);
    }
    report.push('\n');
  }

  // ═══════════════════════════════════════════════════
  // 阶段二：对话召回
  // ═══════════════════════════════════════════════════
  report.push('---\n\n## 阶段二：对话召回与维度还原\n\n');

  const totalMemories = await storage.getStatus();
  report.push(`知识库当前记录数: ${totalMemories.totalRecords}\n\n`);

  const records: DialogueRecord[] = [];
  // 预注入一些家族图谱知识
  await graph.addNode({ id: 'story_user', type: 'person', name: '我' });

  for (let round = 0; round < CONVERSATIONS.length; round++) {
    const conv = CONVERSATIONS[round];

    // M1编码问题
    const dna = encoder.encodeSingle(conv.question);
    await storage.write(dna);

    // M3感知决策
    const decision = m3.decide(dna, { current_time: new Date().toISOString(), current_location: '深圳' });

    // M4知识融合（这里会从M2检索相关历史）
    const ctx = await m4.orchestrate(decision);

    // M5表达生成
    const reply = await m5.orchestrate(ctx);

    const p = decision.enhanced.perception;
    const level = LV[decision.enhanced.calcium_level] ?? '?';

    // 记录相关记忆
    const relevantMemories = ctx.memory_summary.timeline.map(t => t.summary);

    records.push({
      round: round + 1,
      question: conv.question,
      topicGroup: conv.checkTopic,
      dna: { branch_id: dna.branch_id, locus_path: dna.locus_path },
      perception: {
        pleasure: p.pleasure,
        arousal: p.arousal,
        intimacy: p.intimacy,
        sexual_attraction: p.sexual_attraction,
        belonging: p.belonging,
        temporal_focus: p.temporal_focus,
        safety: p.safety,
        calcium: decision.enhanced.calcium_score,
        level,
      },
      actions: decision.actions.join(', '),
      reply,
      relevantMemories,
    });
  }

  // 输出对话记录表
  report.push('| 轮次 | 问题 | 话题 | M3 calcium | pleasure | intimacy | sexual | belonging | temporal | 等级 | 动作 | M5回应摘要 |\n');
  report.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n');

  for (const r of records) {
    report.push(`| ${r.round} | ${r.question.substring(0, 20)}.. | ${r.topicGroup} | ${r.perception.calcium.toFixed(2)} | ${r.perception.pleasure.toFixed(2)} | ${r.perception.intimacy.toFixed(2)} | ${r.perception.sexual_attraction.toFixed(2)} | ${r.perception.belonging.toFixed(2)} | ${r.perception.temporal_focus.toFixed(2)} | ${r.perception.level} | ${r.actions} | ${r.reply.substring(0, 30)}.. |\n`);
  }

  // 详细对话展示
  report.push('\n### 完整对话记录\n\n');
  for (const r of records) {
    report.push(`#### 第${r.round}轮: ${r.question}\n\n`);
    report.push(`**路由**: ${r.dna.locus_path} | **branch_id**: ${r.dna.branch_id}\n\n`);
    report.push(`**M3感知维度**:\n\n`);
    report.push(`| E1愉悦 | E2唤醒 | S1亲密 | I1性吸引 | S6归属 | C5时间焦点 | 钙质 | 等级 |\n`);
    report.push(`| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`);
    report.push(`| ${r.perception.pleasure.toFixed(2)} | ${r.perception.arousal.toFixed(2)} | ${r.perception.intimacy.toFixed(2)} | ${r.perception.sexual_attraction.toFixed(2)} | ${r.perception.belonging.toFixed(2)} | ${r.perception.temporal_focus.toFixed(2)} | ${r.perception.calcium.toFixed(2)} | ${r.perception.level} |\n\n`);

    report.push(`**决策动作**: ${r.actions}\n\n`);

    if (r.relevantMemories.length > 0) {
      report.push(`**召回的相关记忆**: ${r.relevantMemories.join('; ')}\n\n`);
    } else {
      report.push(`**召回的相关记忆**: (无直接相关记录)\n\n`);
    }

    report.push(`**M5回应**: ${r.reply}\n\n`);
  }

  // ═══════════════════════════════════════════════════
  // 阶段三：维度张力分析
  // ═══════════════════════════════════════════════════
  report.push('---\n\n## 阶段三：维度张力分析\n\n');

  // 第三轮（海南旅行情感）的维度张力
  const travelRound = records.find(r => r.topicGroup === '旅行情感');
  if (travelRound) {
    report.push('### 场景: 旅行情感（小雅）\n\n');
    report.push(`- pleasure=${travelRound.perception.pleasure.toFixed(2)} — 正面回忆理应 > 0\n`);
    report.push(`- intimacy=${travelRound.perception.intimacy.toFixed(2)} — 亲密话题应 > 0\n`);
    report.push(`- sexual_attraction=${travelRound.perception.sexual_attraction.toFixed(2)} — 好感话题可期待 > 0\n`);
    report.push(`- belonging=${travelRound.perception.belonging.toFixed(2)} — 群体旅行应 > 0\n`);
    report.push(`- temporal_focus=${travelRound.perception.temporal_focus.toFixed(2)} — 回忆过去应 < 0\n`);
    const tension = Math.abs(travelRound.perception.pleasure) + Math.abs(travelRound.perception.intimacy) + Math.abs(travelRound.perception.sexual_attraction) + Math.abs(travelRound.perception.belonging);
    report.push(`- **维度张力值**: ${tension.toFixed(2)} (越大多维度协同越好)\n\n`);
  }

  // 最后一轮（与爱人亲密）
  const intimateRound = records.find(r => r.topicGroup === '家庭夜晚');
  if (intimateRound) {
    report.push('### 场景: 与爱人的亲密夜晚\n\n');
    report.push(`- pleasure=${intimateRound.perception.pleasure.toFixed(2)} — 温馨场景应 > 0\n`);
    report.push(`- intimacy=${intimateRound.perception.intimacy.toFixed(2)} — 亲密话题应 > 0.2\n`);
    report.push(`- sexual_attraction=${intimateRound.perception.sexual_attraction.toFixed(2)} — 亲热场景可 > 0\n`);
    report.push(`- arousal=${intimateRound.perception.arousal.toFixed(2)} — 情感唤醒度可 > 0.2\n`);
    report.push(`- safety=${intimateRound.perception.safety.toFixed(2)} — 安全感应 > 0.5\n`);
    const tension2 = Math.abs(intimateRound.perception.pleasure) + Math.abs(intimateRound.perception.intimacy) + Math.abs(intimateRound.perception.arousal);
    report.push(`- **维度张力值**: ${tension2.toFixed(2)} (情感场景需多维度协同)\n\n`);
  }

  // 总结
  report.push('---\n\n## 总结\n\n');
  report.push('| 指标 | 说明 |\n| :--- | :--- |\n');
  report.push(`| 故事数 | ${STORIES.length} 篇 (约500字/篇) |\n`);
  report.push(`| 对话轮次 | ${CONVERSATIONS.length} 轮\n`);
  report.push(`| 知识库记录 | ${totalMemories.totalRecords} 条 DNA |\n`);
  report.push(`| 最高钙质 | ${Math.max(...records.map(r=>r.perception.calcium)).toFixed(2)} |\n`);
  report.push(`| 最高pleasure | ${Math.max(...records.map(r=>r.perception.pleasure)).toFixed(2)} |\n`);
  report.push(`| 最高intimacy | ${Math.max(...records.map(r=>r.perception.intimacy)).toFixed(2)} |\n`);
  report.push(`| 平均intimacy | ${(records.reduce((s,r)=>s+r.perception.intimacy,0)/records.length).toFixed(2)} |\n`);
  report.push(`| 认知还原 | ${records.filter(r=>r.relevantMemories.length>0).length}/${records.length} 轮触发记忆召回 |\n`);

  const outputPath = join(__dirname, 'story-recall-report.md');
  fs.writeFileSync(outputPath, report.join(''), 'utf-8');
  console.log(`✅ 报告已生成 → ${outputPath}`);

  rmSync(TMP, { recursive: true, force: true });
}

main().catch(e => { console.error('错误:', e); process.exit(1); });
