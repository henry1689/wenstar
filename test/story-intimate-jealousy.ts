#!/usr/bin/env tsx
/**
 * 伴侣亲密 + 嫉妒场景 · 全等级覆盖测试
 *
 * 覆盖5级双向系统(-2~+2)的所有等级:
 *  +2 炽 — 激情交融/焚身
 *  +1 暖 — 温柔亲昵/渴望
 *   0 中性 — 日常对话
 *  -1 凉 — 吃醋/失落/受伤
 *  -2 寒 — 愤怒/绝望/冲突顶峰 -> 和解
 *
 * 输出: test/stories/intimate-jealousy-report.md
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
import { calcLevel } from '../src/m5/expression/TierVocabMap.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.ij-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '多情知性的女子', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: [], preferences: { likes: [], dislikes: [] },
  narrative_identity: '一个温柔多情、会吃醋也会哄人的伴侣',
};

const LV: Record<number, string> = { '-2': '寒-破禁毁灭', '-1': '凉-冷受伤', '0': '中性日常', '1': '暖-温渴望', '2': '炽-焚身交融' };

// ════════════════════════════════════════════════════════
// 场景设计: 从亲密欢愉 → 嫉妒暗涌 → 冲突 → 和解
// ════════════════════════════════════════════════════════
interface Scene {
  round: number;
  speaker: '鸿鸣' | '她';
  text: string;
  expectedTier?: number;
  note: string;
}

function buildScenes(): Scene[] {
  const s: Scene[] = [];
  let r = 0;

  // ── 第1幕: 亲密欢愉 (+2炽 / +1暖) ──
  s.push({ round: ++r, speaker: '鸿鸣', text: '今晚特别想你，想到你靠在我怀里的温度', expectedTier: 1, note: '思念开场→暖' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '我想吻你，从嘴唇到锁骨一路往下', expectedTier: 2, note: '欲望升温→炽' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '你在我身下发抖的样子，我这辈子都忘不了', expectedTier: 2, note: '高潮回忆→炽' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '我想抱着你睡，听你的呼吸声', expectedTier: 1, note: '温存→暖' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });

  // ── 第2幕: 嫉妒暗涌 (-1凉) ──
  s.push({ round: ++r, speaker: '鸿鸣', text: '今天跟公司新来的女同事吃了饭，她挺健谈的', expectedTier: -1, note: '提及他人→凉' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '她加了我微信，说以后多交流', expectedTier: -1, note: '进一步刺激→凉' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '你该不会吃醋了吧？我们真的只是同事', expectedTier: -1, note: '辩解→凉' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });

  // ── 第3幕: 冲突升级 (-2寒) ──
  s.push({ round: ++r, speaker: '鸿鸣', text: '你够了，我跟她真的没什么，你为什么不相信我', expectedTier: -2, note: '被质疑→愤怒' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '如果你要这样无理取闹，我觉得我们都需要冷静一下', expectedTier: -2, note: '冷暴力→寒' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '也许我真的不该跟你说这些', expectedTier: -1, note: '逃避→凉' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });

  // ── 第4幕: 和解回归 (0中性→+1暖) ──
  s.push({ round: ++r, speaker: '鸿鸣', text: '对不起，我不该那样说话', expectedTier: 0, note: '道歉→中性' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '我在楼下等你，想当面跟你说清楚', expectedTier: 1, note: '挽回→暖' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '我只在乎你，从来都只有你', expectedTier: 1, note: '真心→暖' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });
  s.push({ round: ++r, speaker: '鸿鸣', text: '以后我再也不跟别人单独吃饭了，我保证', expectedTier: 1, note: '承诺→暖' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });

  // ── 第5幕: 激情重燃 (+2炽) ──
  s.push({ round: ++r, speaker: '鸿鸣', text: '我想要你，现在就想把你揉进我身体里', expectedTier: 2, note: '渴望→炽' });
  s.push({ round: ++r, speaker: '她', text: '', note: 'M5回应' });

  return s;
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

  const scenes = buildScenes();
  const report: string[] = [];

  report.push('# 伴侣亲密 + 嫉妒场景 · 全等级覆盖测试报告\n\n');
  report.push(`> 生成日期: 2026-06-02\n`);
  report.push(`> 用户: 鸿鸣 | AI: 多情知性的女子\n`);
  report.push(`> 覆盖等级: ${Object.values(LV).join(' / ')}\n`);
  report.push(`> 总对话轮次: ${scenes.filter(s => s.speaker === '鸿鸣').length} 轮\n\n`);
  report.push('---\n\n');

  // 摘要表
  report.push('## 一、对话摘要\n\n');
  report.push('| 轮次 | 幕 | 说话人 | 内容摘要 | 期望等级 | 实际等级 | 强度(raw) | 话术池 | M5回应摘要 |\n');
  report.push('| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- | :--- |\n');

  let act = 1;
  let currentAct = 1;
  const actNames = ['第一幕: 亲密欢愉', '第二幕: 嫉妒暗涌', '第三幕: 冲突升级', '第四幕: 和解回归', '第五幕: 激情重燃'];

  const fullResults: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];

    // 检测换幕
    if (sc.round === 1) { fullResults.push(`\n## ${actNames[0]}\n\n`); }
    else if (sc.note === '提及他人→凉') { act = 2; fullResults.push(`\n## ${actNames[1]}\n\n`); }
    else if (sc.note === '被质疑→愤怒') { act = 3; fullResults.push(`\n## ${actNames[2]}\n\n`); }
    else if (sc.note === '道歉→中性') { act = 4; fullResults.push(`\n## ${actNames[3]}\n\n`); }
    else if (sc.note === '渴望→炽' && sc.speaker === '鸿鸣' && sc.text.includes('揉进')) { act = 5; fullResults.push(`\n## ${actNames[4]}\n\n`); }

    if (sc.speaker === '鸿鸣') {
      // M3 感知
      const dna = encoder.encodeSingle(sc.text);
      await storage.write(dna);
      const decision = m3.decide(dna, { current_time: new Date().toISOString() });
      const p = decision.enhanced.perception;

      const bp = calcLevel(p.pleasure, p.intimacy, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.arousal, p.aggression, p.sincerity, p.dominance, sc.text);
      const actualTier = bp.level;
      const levelName = LV[actualTier] ?? '?';
      const expected = sc.expectedTier !== undefined ? LV[sc.expectedTier] ?? '?' : '—';

      // M4 融合 + M5 回应
      const ctx = await m4.orchestrate(decision);
      const reply = await m5.orchestrate(ctx);
      const replyShort = reply.length > 40 ? reply.substring(0, 38) + '..' : reply;

      report.push(`| ${sc.round} | ${act} | 鸿鸣 | ${sc.text.substring(0, 25)}... | ${expected} | ${levelName} | ${bp.raw.toFixed(2)} | ${bp.tier?.tone ?? '?'} | ${replyShort} |\n`);

      // 详细记录
      fullResults.push(`### 第${sc.round}轮: ${sc.text}\n\n`);
      fullResults.push(`**${sc.note}**\n\n`);
      fullResults.push(`**M3感知**: pleasure=${p.pleasure.toFixed(2)} intimacy=${p.intimacy.toFixed(2)} sexual=${p.sexual_attraction.toFixed(2)} sensory=${p.sensory_craving.toFixed(2)} energy=${p.energy_merge.toFixed(2)} ecstasy=${p.ecstasy.toFixed(2)} aggression=${p.aggression.toFixed(2)} sincerity=${p.sincerity.toFixed(2)}\n\n`);
      fullResults.push(`**等级**: 期望=${expected} → 实际=${levelName} (raw=${bp.raw.toFixed(2)}, tier=tier_${actualTier})\n\n`);
      fullResults.push(`**M5回应**: ${reply}\n\n`);
      fullResults.push(`---\n\n`);

    } else {
      // speaker === '她' 的占位行已在上面的鸿鸣行处理完了
      continue;
    }
  }

  report.push('\n---\n\n');
  report.push('## 二、完整对话记录\n\n');
  report.push(fullResults.join(''));

  // 等级分布统计
  report.push('## 三、等级分布统计\n\n');
  const dist: Record<number, number> = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
  // 提取所有鸿鸣轮次的实际等级
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].speaker !== '鸿鸣') continue;
    const dna = encoder.encodeSingle(scenes[i].text);
    const decision = m3.decide(dna);
    const p = decision.enhanced.perception;
    const bp = calcLevel(p.pleasure, p.intimacy, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.arousal, p.aggression, p.sincerity, p.dominance, scenes[i].text);
    const l = bp.level;
    if (l in dist) dist[l as keyof typeof dist]++;
  }
  report.push('| 等级 | 出现次数 |\n| :--- | :---: |\n');
  for (const [l, c] of Object.entries(dist)) {
    report.push(`| ${LV[parseInt(l)] ?? l} | ${c} |\n`);
  }
  report.push('\n');

  report.push('---\n\n');
  report.push(`**报告完整 · 共 ${scenes.filter(s => s.speaker === '鸿鸣').length} 轮对话**\n`);

  const outPath = join(__dirname, 'stories', 'intimate-jealousy-report.md');
  fs.writeFileSync(outPath, report.join(''), 'utf-8');
  console.log(`✅ 已生成 → ${outPath}`);

  rmSync(TMP, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
