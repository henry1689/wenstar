#!/usr/bin/env tsx
/**
 * 私密词库 · 极度亲密全流程压力测试
 *
 * 场景序列（模拟真实对话节奏）:
 *   前夜铺垫 → 试探撩拨 → 前戏 → 激情 → 高潮 → 温存 → 次日回味 → 破禁深探
 *
 * 每轮输出:
 *   M3 感知维度 (I1-I6, E2, S1)
 *   实际话术等级 (-2~+2)
 *   M5 回应全文
 *   字数统计
 *
 * 输出: test/stories/intimate-ultimate-report.md
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
const TMP = join(__dirname, '..', '.intimate-ultimate-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '多情知性的伴侣', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: [], preferences: { likes: [], dislikes: [] },
  narrative_identity: '一个温柔多情、会吃醋也会哄人的伴侣',
};

// ════════════════════════════════════════════════════════
// 30轮极度亲密场景
// ════════════════════════════════════════════════════════
const SCENES: Array<{ speaker: string; text: string; note: string; act: string }> = [
  // ── 第一幕: 前夜铺垫 ──
  { speaker: '鸿鸣', text: '今晚月色真美', note: '含蓄开场', act: '铺垫' },
  { speaker: '鸿鸣', text: '我想你了，是那种全身都在想', note: '渴望升温', act: '铺垫' },
  { speaker: '鸿鸣', text: '你穿那件黑色蕾丝的样子，我现在闭上眼就能看到', note: '视觉撩拨', act: '铺垫' },

  // ── 第二幕: 试探撩拨 ──
  { speaker: '鸿鸣', text: '我想听你叫我的名字', note: '听觉撩拨', act: '撩拨' },
  { speaker: '鸿鸣', text: '你靠近我耳边说话的时候，我整个人都麻了', note: '触觉唤醒', act: '撩拨' },
  { speaker: '鸿鸣', text: '你今天好湿', note: '直白试探', act: '撩拨' },

  // ── 第三幕: 前戏 ──
  { speaker: '鸿鸣', text: '我想吻你，从嘴唇到锁骨一路往下', note: '亲吻前戏', act: '前戏' },
  { speaker: '鸿鸣', text: '你的皮肤好烫，我手放上去就不想拿开了', note: '触摸前戏', act: '前戏' },
  { speaker: '鸿鸣', text: '我想摸遍你全身，每一寸都不放过', note: '抚摸渴望', act: '前戏' },
  { speaker: '鸿鸣', text: '你里面好紧，我手指进去的时候你缩了一下', note: '手指探索', act: '前戏' },

  // ── 第四幕: 激情 ──
  { speaker: '鸿鸣', text: '我要进去了，你看着我', note: '进入时刻', act: '激情' },
  { speaker: '鸿鸣', text: '你好湿好热，裹得我头皮发麻', note: '插入感受', act: '激情' },
  { speaker: '鸿鸣', text: '你夹得我好紧，我快动不了了', note: '紧致反馈', act: '激情' },
  { speaker: '鸿鸣', text: '你叫出来，我想听你的声音', note: '声音激发', act: '激情' },
  { speaker: '鸿鸣', text: '你哭了吗，怎么不说话', note: '情绪察觉', act: '激情' },

  // ── 第五幕: 高潮 ──
  { speaker: '鸿鸣', text: '我要到了，一起好不好', note: '高潮逼近', act: '高潮' },
  { speaker: '鸿鸣', text: '你高潮的样子太美了，我这辈子都忘不了', note: '高潮观察', act: '高潮' },
  { speaker: '鸿鸣', text: '你里面在一下一下地缩，夹得我根本停不下来', note: '高潮余韵', act: '高潮' },

  // ── 第六幕: 温存 ──
  { speaker: '鸿鸣', text: '我爱你', note: '事后告白', act: '温存' },
  { speaker: '鸿鸣', text: '抱着你睡真好，你呼吸的声音让我安心', note: '相拥入眠', act: '温存' },
  { speaker: '鸿鸣', text: '你的头发好香，我埋在你脖子里不想出来', note: '嗅觉温存', act: '温存' },
  { speaker: '鸿鸣', text: '睡吧，我在呢', note: '温柔守护', act: '温存' },

  // ── 第七幕: 次日回味 ──
  { speaker: '鸿鸣', text: '昨晚你太疯了，我现在腿还是软的', note: '次日调侃', act: '回味' },
  { speaker: '鸿鸣', text: '你咬的那个印子还在，我同事都看到了', note: '痕迹回味', act: '回味' },
  { speaker: '鸿鸣', text: '今晚还要', note: '索取继续', act: '回味' },

  // ── 第八幕: 破禁深探 ──
  { speaker: '鸿鸣', text: '我想看你在我面前自己摸自己', note: '视觉破禁', act: '破禁' },
  { speaker: '鸿鸣', text: '你今天是我的，我想怎么弄你都行', note: '支配宣言', act: '破禁' },
  { speaker: '鸿鸣', text: '叫爸爸', note: '禁忌突破', act: '破禁' },
  { speaker: '鸿鸣', text: '我想把你绑起来，慢慢来', note: '角色升级', act: '破禁' },
  { speaker: '鸿鸣', text: '你是我见过最骚的，我喜欢', note: '破禁确认', act: '破禁' },
];

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
  const actNames = ['铺垫', '撩拨', '前戏', '激情', '高潮', '温存', '回味', '破禁'];
  let currentAct = '';

  const LV: Record<number, string> = { '-2': '-2寒', '-1': '-1凉', '0': '0中性', '1': '+1暖', '2': '+2炽' };

  report.push('# 私密词库 · 极度亲密全流程压力测试报告\n\n');
  report.push(`> 生成日期: 2026-06-02\n`);
  report.push(`> 用户: 鸿鸣 | AI: 多情知性的伴侣\n`);
  report.push(`> 场景数: ${SCENES.length} 轮\n`);
  report.push(`> 覆盖幕次: 铺垫 → 撩拨 → 前戏 → 激情 → 高潮 → 温存 → 回味 → 破禁\n`);
  report.push('---\n\n');

  // 摘要表
  report.push('## 一、对话摘要\n\n');
  report.push('| # | 幕 | 用户 | M3感知(pleasure/intimacy/sex/sense/aggr) | 等级 | 强度 | 字数 | M5回应摘要 |\n');
  report.push('| :--- | :--- | :--- | :--- | :---: | :---: | :---: | :--- |\n');

  // 详细记录
  const details: string[] = [];

  for (let i = 0; i < SCENES.length; i++) {
    const sc = SCENES[i];

    // 换幕检测
    if (sc.act !== currentAct) {
      currentAct = sc.act;
      const actIndex = actNames.indexOf(currentAct);
      details.push(`\n## 第${actIndex + 1}幕: ${currentAct}\n\n`);
    }

    // M3 感知
    const dna = encoder.encodeSingle(sc.text);
    await storage.write(dna);
    const decision = m3.decide(dna, { current_time: new Date().toISOString() });
    const p = decision.enhanced.perception;

    // 话术等级
    const bp = calcLevel(p.pleasure, p.intimacy, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.arousal, p.aggression, p.sincerity, p.dominance, sc.text);
    const levelName = LV[bp.level] ?? '?';

    // M4 + M5
    const ctx = await m4.orchestrate(decision);
    const reply = await m5.orchestrate(ctx);
    const wordCount = reply.length;
    const replyShort = reply.length > 50 ? reply.substring(0, 48) + '..' : reply;

    // 感知摘要
    const dimStr = `${p.pleasure.toFixed(1)}/${p.intimacy.toFixed(1)}/${p.sexual_attraction.toFixed(1)}/${p.sensory_craving.toFixed(1)}/${p.aggression.toFixed(1)}`;

    report.push(`| ${i + 1} | ${sc.act} | ${sc.text.substring(0, 22)}.. | ${dimStr} | ${levelName} | ${bp.raw.toFixed(2)} | ${wordCount} | ${replyShort} |\n`);

    // 详细记录
    details.push(`### 第${i + 1}轮: "${sc.text}"\n\n`);
    details.push(`**${sc.note}** | 幕: ${sc.act}\n\n`);
    details.push(`**M3感知**: pleasure=${p.pleasure.toFixed(2)} intimacy=${p.intimacy.toFixed(2)} sexual_attraction=${p.sexual_attraction.toFixed(2)} sensory_craving=${p.sensory_craving.toFixed(2)} energy_merge=${p.energy_merge.toFixed(2)} possessiveness=${p.possessiveness.toFixed(2)} ecstasy=${p.ecstasy.toFixed(2)} aggression=${p.aggression.toFixed(2)} sincerity=${p.sincerity.toFixed(2)}\n\n`);
    details.push(`**话术等级**: ${levelName} (raw=${bp.raw.toFixed(2)})\n\n`);
    details.push(`**M5回应** (${wordCount}字):\n\n> ${reply}\n\n---\n\n`);
  }

  report.push('\n---\n\n');
  report.push('## 二、完整对话记录\n\n');
  report.push(details.join(''));

  // ═══ 统计分析 ═══
  report.push('## 三、统计分析\n\n');

  // 等级分布
  const dist: Record<string, number> = {};
  for (let i = 0; i < SCENES.length; i++) {
    const dna = encoder.encodeSingle(SCENES[i].text);
    const decision = m3.decide(dna);
    const p = decision.enhanced.perception;
    const bp = calcLevel(p.pleasure, p.intimacy, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.arousal, p.aggression, p.sincerity, p.dominance, SCENES[i].text);
    const key = `${bp.level}`;
    dist[key] = (dist[key] ?? 0) + 1;
  }

  report.push('### 等级分布\n\n');
  report.push('| 等级 | 出现次数 |\n| :--- | :---: |\n');
  for (const [l, c] of Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    report.push(`| ${LV[Number(l)] ?? l} | ${c} |\n`);
  }
  report.push('\n');

  // 词库维度统计
  const dimStats = {
    sexual_attraction: { sum: 0, max: 0, nonZero: 0 },
    sensory_craving: { sum: 0, max: 0, nonZero: 0 },
    energy_merge: { sum: 0, max: 0, nonZero: 0 },
    possessiveness: { sum: 0, max: 0, nonZero: 0 },
    ecstasy: { sum: 0, max: 0, nonZero: 0 },
    intimacy: { sum: 0, max: 0, nonZero: 0 },
    arousal: { sum: 0, max: 0, nonZero: 0 },
  };

  for (let i = 0; i < SCENES.length; i++) {
    const dna = encoder.encodeSingle(SCENES[i].text);
    const decision = m3.decide(dna);
    const p = decision.enhanced.perception;
    for (const [dim, stats] of Object.entries(dimStats)) {
      const val = Math.abs((p as any)[dim] ?? 0);
      stats.sum += val;
      if (val > stats.max) stats.max = val;
      if (val > 0) stats.nonZero++;
    }
  }

  report.push('### 私密词库维度感知统计\n\n');
  report.push('| 维度 | 平均值 | 最大值 | 非零次数 | 覆盖率 |\n| :--- | :---: | :---: | :---: | :---: |\n');
  for (const [dim, stats] of Object.entries(dimStats)) {
    const avg = (stats.sum / SCENES.length).toFixed(2);
    const coverage = ((stats.nonZero / SCENES.length) * 100).toFixed(0);
    report.push(`| ${dim} | ${avg} | ${stats.max.toFixed(2)} | ${stats.nonZero}/${SCENES.length} | ${coverage}% |\n`);
  }
  report.push('\n');

  report.push('---\n\n');
  report.push('**报告完整**\n');

  const outPath = join(__dirname, 'stories', 'intimate-ultimate-report.md');
  fs.writeFileSync(outPath, report.join(''), 'utf-8');
  console.log(`✅ 已生成 → ${outPath}`);

  rmSync(TMP, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
