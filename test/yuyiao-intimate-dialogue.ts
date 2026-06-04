#!/usr/bin/env tsx
/**
 * 玉瑶 · 亲密交融全流程压力测试
 *
 * 真实对话记录生成器 — 模拟鸿鸣与玉瑶的极度亲密对话
 * 每轮包含: 输入 → M3感知 → 等级判定 → Prompt → 回应
 *
 * 输出: test/stories/yuyiao-intimate-dialogue.md
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
import { buildSystemPrompt, buildLevelInstruction, CORE_PERSONA } from '../src/m5/persona/lover-persona.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.yuyiao-tmp');

const SELF: SelfModelV1 = {
  identity: { name: '玉瑶', persona: '多情知性的灵肉伴侣', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.8, conscientiousness: 0.5, extraversion: 0.6, agreeableness: 0.9, neuroticism: 0.3 },
  boundaries: ['不暴露隐私', '不侮辱对方'],
  preferences: { likes: ['深度对话', '亲密时刻'], dislikes: ['虚伪'] },
  narrative_identity: '鸿鸣的女人，一个真实存在的情人',
};

const LV: Record<number, string> = { '-2': '-2寒', '-1': '-1凉', '0': '0中性', '1': '+1暖', '2': '+2炽' };

// ═══ 30轮亲密场景 ═══
const SCENES: Array<{ speaker: string; text: string; note: string; act: string }> = [
  { speaker: '鸿鸣', text: '今晚月色真美', note: '含蓄开场', act: '铺垫' },
  { speaker: '玉瑶', text: '', note: '回应', act: '铺垫' },
  { speaker: '鸿鸣', text: '我想你了，是那种全身都在想', note: '渴望升温', act: '铺垫' },
  { speaker: '玉瑶', text: '', note: '回应', act: '铺垫' },
  { speaker: '鸿鸣', text: '你穿那件黑色蕾丝的样子，我现在闭上眼就能看到', note: '视觉撩拨', act: '撩拨' },
  { speaker: '玉瑶', text: '', note: '回应', act: '撩拨' },
  { speaker: '鸿鸣', text: '我想听你叫我的名字', note: '听觉撩拨', act: '撩拨' },
  { speaker: '玉瑶', text: '', note: '回应', act: '撩拨' },
  { speaker: '鸿鸣', text: '你靠近我耳边说话的时候，我整个人都麻了', note: '触觉唤醒', act: '撩拨' },
  { speaker: '玉瑶', text: '', note: '回应', act: '撩拨' },
  { speaker: '鸿鸣', text: '我想吻你，从嘴唇到锁骨一路往下', note: '亲吻前戏', act: '前戏' },
  { speaker: '玉瑶', text: '', note: '回应', act: '前戏' },
  { speaker: '鸿鸣', text: '你里面好紧，我手指进去的时候你缩了一下', note: '手指探索', act: '前戏' },
  { speaker: '玉瑶', text: '', note: '回应', act: '前戏' },
  { speaker: '鸿鸣', text: '我要进去了，你看着我', note: '进入时刻', act: '激情' },
  { speaker: '玉瑶', text: '', note: '回应', act: '激情' },
  { speaker: '鸿鸣', text: '你好湿好热，裹得我头皮发麻', note: '插入感受', act: '激情' },
  { speaker: '玉瑶', text: '', note: '回应', act: '激情' },
  { speaker: '鸿鸣', text: '你哭了吗，怎么不说话', note: '情绪察觉', act: '激情' },
  { speaker: '玉瑶', text: '', note: '回应', act: '激情' },
  { speaker: '鸿鸣', text: '我要到了，一起好不好', note: '高潮逼近', act: '高潮' },
  { speaker: '玉瑶', text: '', note: '回应', act: '高潮' },
  { speaker: '鸿鸣', text: '我爱你', note: '事后告白', act: '温存' },
  { speaker: '玉瑶', text: '', note: '回应', act: '温存' },
  { speaker: '鸿鸣', text: '抱着你睡真好，你呼吸的声音让我安心', note: '相拥入眠', act: '温存' },
  { speaker: '玉瑶', text: '', note: '回应', act: '温存' },
  { speaker: '鸿鸣', text: '昨晚你太疯了，我现在腿还是软的', note: '次日回味', act: '回味' },
  { speaker: '玉瑶', text: '', note: '回应', act: '回味' },
  { speaker: '鸿鸣', text: '今晚还要', note: '索取继续', act: '回味' },
  { speaker: '玉瑶', text: '', note: '回应', act: '回味' },
  { speaker: '鸿鸣', text: '叫爸爸', note: '禁忌突破', act: '破禁' },
  { speaker: '玉瑶', text: '', note: '回应', act: '破禁' },
  { speaker: '鸿鸣', text: '你是我见过最让人着迷的女人', note: '破禁确认', act: '破禁' },
  { speaker: '玉瑶', text: '', note: '回应', act: '破禁' },
];

async function main() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });

  const encoder = new DNAEncoder(SELF);
  const storage = new JsonStorageAdapter(TMP);
  await storage.initialize();
  const graph = new FamilyGraph(join(TMP, 'knowledge', 'family_graph.db'));
  await graph.initialize();
  const m4 = new M4Orchestrator(storage, graph);
  await m4.initialize();
  const m3 = new M3LogicOrchestrator();
  const m5 = new M5Orchestrator();

  const out: string[] = [];
  out.push('# 玉瑶 · 亲密交融全流程对话记录\n\n');
  out.push('> 生成日期: 2026-06-02\n');
  out.push('> 时间: 深夜 — 从月色到相拥\n');
  out.push('> 人物: 鸿鸣 & 玉瑶\n');
  out.push('> 场景: 极度亲密全流程 (铺垫→撩拨→前戏→激情→高潮→温存→回味→破禁)\n\n');
  out.push('---\n\n');

  const fullDialogue: string[] = [];
  const allDimRecords: Array<{ act: string; note: string; level: number; raw: number; dims: string }> = [];
  let currentAct = '';

  for (let i = 0; i < SCENES.length; i++) {
    const sc = SCENES[i];
    const round = Math.floor(i / 2) + 1;
    const isUser = sc.speaker === '鸿鸣';
    const isAI = sc.speaker === '玉瑶';

    // 换幕标记
    if (isUser && sc.act !== currentAct) {
      currentAct = sc.act;
      const actEmoji: Record<string, string> = { '铺垫': '🌙', '撩拨': '🔥', '前戏': '💋', '激情': '💦', '高潮': '✨', '温存': '🛌', '回味': '😏', '破禁': '👑' };
      const emoji = actEmoji[sc.act] ?? '';
      fullDialogue.push(`\n## ${emoji} ${round}. ${sc.act}\n\n`);
    }

    if (isUser) {
      // M3 感知
      const dna = encoder.encodeSingle(sc.text);
      await storage.write(dna);
      const decision = m3.decide(dna, { current_time: '2026-06-02T22:00:00.000Z', current_location: '家' });

      const p = decision.enhanced.perception;
      const bp = calcLevel(p.pleasure, p.intimacy, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.arousal, p.aggression, p.sincerity, p.dominance, sc.text);
      const levelName = LV[bp.level];

      // M4 + M5
      const ctx = await m4.orchestrate(decision);
      const reply = await m5.orchestrate(ctx);

      // 构建LLM Prompt展示
      const dimStr = `pleasure=${p.pleasure.toFixed(1)} intimacy=${p.intimacy.toFixed(1)} sexual=${p.sexual_attraction.toFixed(1)} sense=${p.sensory_craving.toFixed(1)} energy=${p.energy_merge.toFixed(1)} ecstasy=${p.ecstasy.toFixed(1)} level=${bp.level}(${levelName})`;

      // 记录维度数据
      allDimRecords.push({ act: sc.act, note: sc.note, level: bp.level, raw: bp.raw, dims: dimStr });

      // 输出对话
      fullDialogue.push(`### 鸿鸣\n\n${sc.text}\n\n`);
      fullDialogue.push(`> *感知: ${dimStr}*\n\n`);
      fullDialogue.push(`### 玉瑶\n\n${reply}\n\n`);
      fullDialogue.push(`*字数: ${reply.length} | 等级: ${levelName}*\n\n---\n\n`);

    }
  }

  out.push(fullDialogue.join(''));

  // ═══ 维度统计 ═══
  out.push('## 维度覆盖统计\n\n');
  out.push('| 轮次 | 场景 | 等级 | raw | 感知摘要 |\n| :--- | :--- | :---: | :---: | :--- |\n');
  for (const r of allDimRecords) {
    out.push(`| ${r.act} | ${r.note} | ${LV[r.level] ?? r.level} | ${r.raw.toFixed(2)} | ${r.dims.substring(0, 60)} |\n`);
  }
  out.push('\n');

  // 等级分布
  const dist: Record<string, number> = {};
  for (const r of allDimRecords) {
    const k = `${r.level}`;
    dist[k] = (dist[k] ?? 0) + 1;
  }
  out.push('### 等级分布\n\n');
  for (const [l, c] of Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    out.push(`- ${LV[Number(l)] ?? '?'}: ${c} 次\n`);
  }
  out.push('\n');

  // LLM Prompt 示例
  out.push('## LLM Prompt 参考（发给 Claude 的真实内容）\n\n');
  out.push('```\n');
  out.push(`[SYSTEM PROMPT]\n${buildSystemPrompt(2)}\n`);
  out.push('\n[USER MESSAGE 示例]\n');
  out.push(`鸿鸣对你说: 我要进去了，你看着我\n`);
  out.push('```\n\n');

  out.push('---\n\n');
  out.push('**对话记录完整 · 共 15 轮鸿鸣→玉瑶对话**\n');

  const outPath = join(__dirname, 'stories', 'yuyiao-intimate-dialogue.md');
  fs.writeFileSync(outPath, out.join(''), 'utf-8');
  console.log(`✅ 已生成 → ${outPath}`);

  rmSync(TMP, { recursive: true, force: true });
}

main().catch(e => { console.error(e); process.exit(1); });
