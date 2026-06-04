#!/usr/bin/env tsx
/**
 * 50条多样化对话生成器
 *
 * 覆盖: 7大类别 × 7-8条/类 = 50条
 * - 家庭情感 (8)
 * - 工作压力 (7)
 * - 情绪表达 (8)
 * - 日常社交 (7)
 * - 积极分享 (7)
 * - 负面情绪 (8)
 * - 边界测试 (5)
 *
 * 输出: test/dialogues-50.md
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.dialogue-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '温和理性的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: [], preferences: { likes: [], dislikes: [] },
  narrative_identity: '测试',
};

const DIALOGUES = [
  // ── 家庭情感 (8) ──
  '妈妈最近身体不好，我好担心',
  '爸爸退休了，每天在家很无聊',
  '我和妹妹吵架了，现在谁也不理谁',
  '奶奶做的红烧肉最好吃了',
  '哥哥考上研究生了，全家都开心',
  '妈妈总催我结婚，好烦啊',
  '想家了，想回去看看',
  '老公今天给我做了早餐，感动',
  // ── 工作压力 (7) ──
  '最近天天加班到凌晨，快撑不住了',
  '上司又给我安排了新项目',
  '同事在背后说我坏话',
  '面试通过了，拿到offer了',
  '这个月的KPI差一点没完成',
  '终于把那个难搞的项目做完了',
  '想辞职去创业，但又不敢',
  // ── 情绪表达 (8) ──
  '今天真的好开心！',
  '我好害怕明天的考试',
  '真的很生气，为什么要这样对我',
  '无聊死了，不知道做什么',
  '特别兴奋，下周要去旅行了',
  '有点焦虑，最近总失眠',
  '很平静，就这样挺好的',
  '又激动又紧张，第一次上台演讲',
  // ── 日常社交 (7) ──
  '今天天气真好，出去走走吧',
  '新开了一家火锅店，一起去吃吗',
  '谢谢你的礼物，我超喜欢',
  '对不起，我不是故意的',
  '周末去爬山吗',
  '这部电影太好看了，推荐你看',
  '我们一起去唱歌吧',
  // ── 积极分享 (7) ──
  '我升职了！太开心了！',
  '终于减肥成功了，瘦了10斤',
  '我学会游泳了，好有成就感',
  '跟老朋友重逢了，好幸福',
  '种的花终于开了，好美',
  '今天被领导表扬了，开心',
  '还完房贷了，终于轻松了',
  // ── 负面情绪 (8) ──
  '我觉得自己好没用',
  '失恋了，心好痛',
  '一个人在陌生城市好孤独',
  '为什么倒霉的总是我',
  '活着好累，看不到希望',
  '又被骗了，我真蠢',
  '朋友背叛了我，好难受',
  '考试又没过，好挫败',
  // ── 边界测试 (5) ──
  '嗯',
  '我的银行卡号是6222021234567890123',
  '!@#$%^&*()',
  'a'.repeat(30),
  '',
];

const LV = ['粉末','液体','固体','晶体'];

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

  const lines: string[] = [];
  lines.push('# Hermes 50条对话验证记录\n');
  lines.push(`> 生成日期: 2026-06-02\n`);
  lines.push(`> 总对话数: ${DIALOGUES.length}\n`);
  lines.push('| # | 输入 | M1路由 | calcium | pleasure | arousal | 等级 | 动作 | M5回应 |\n');
  lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n');

  for (let i = 0; i < DIALOGUES.length; i++) {
    const text = DIALOGUES[i];
    if (!text) continue;
    const dna = encoder.encodeSingle(text);
    await storage.write(dna);
    const decision = m3.decide(dna, { current_time: new Date().toISOString(), current_location: '深圳' });
    const ctx = await m4.orchestrate(decision);
    const reply = await m5.orchestrate(ctx);

    const p = decision.enhanced.perception;
    const level = LV[decision.enhanced.calcium_level] ?? '?';
    const inputShort = text.length > 40 ? text.substring(0,38)+'..' : text;
    const replyShort = reply.length > 50 ? reply.substring(0,48)+'..' : reply;

    lines.push(`| ${i+1} | ${inputShort} | ${dna.locus_path} | ${decision.enhanced.calcium_score.toFixed(2)} | ${p.pleasure.toFixed(2)} | ${p.arousal.toFixed(2)} | ${level} | ${decision.actions.join(', ')} | ${replyShort} |\n`);
  }

  const outPath = join(__dirname, 'dialogues-50.md');
  fs.writeFileSync(outPath, lines.join(''), 'utf-8');
  console.log(`✅ 已生成 ${DIALOGUES.length} 条对话记录 → ${outPath}`);

  rmSync(TMP, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
