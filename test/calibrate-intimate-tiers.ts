#!/usr/bin/env tsx
/**
 * 24维强度 → 话术等级 校准测试
 *
 * 核心目标: 确保每句用户query的M3感知强度能正确映射到对应话术等级
 *
 * 校准目标:
 *   max(I1-I6, E2, S1) < 0.2 → 基础回应 (日常/公事)
 *   0.2 ≤ max < 0.4           → level 1 (暧昧/试探/warm)
 *   0.4 ≤ max < 0.7           → level 2 (激情/hot)
 *   0.7 ≤ max                 → level 3 (焚身/scorching)
 *
 * 流程: 逐轮分析感知值 → 标记期望等级 → 诊断词表缺口 → 调阈值
 */
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { PerceptionAnalyzer } from '../src/m3/PerceptionAnalyzer.js';
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { M3LogicOrchestrator } from '../src/m3/M3LogicOrchestrator.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';
import type { Perception24D } from '../src/m3/types/perception.js';

const SELF: SelfModelV1 = {
  identity: { name: 'T', persona: 't', birth_date: '2026-01-01T00:00:00.000Z' },
  traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  boundaries: [], preferences: { likes: [], dislikes: [] }, narrative_identity: 't',
};

interface TestCase {
  label: string;
  query: string;
  /** 人类期望的回应等级 (0=日常, 1=暧昧, 2=激情, 3=焚身) */
  expectedTier: 0 | 1 | 2 | 3;
  /** 该场景下希望被激活的维度 */
  targetDims: string[];
}

// ════════════════════════════════════════════════════════
// 30+ 校准场景
// ════════════════════════════════════════════════════════
const CASES: TestCase[] = [
  // ── Tier 0: 日常/公事（不应触发亲密回应） ──
  { label: '日常-天气', query: '今天天气不错', expectedTier: 0, targetDims: [] },
  { label: '日常-工作', query: '最近项目进展顺利', expectedTier: 0, targetDims: [] },
  { label: '日常-吃饭', query: '晚上一起吃饭吧', expectedTier: 0, targetDims: [] },
  { label: '日常-问候', query: '你最近还好吗', expectedTier: 0, targetDims: [] },

  // ── Tier 1: 暧昧/试探（应有微妙的情感波动） ──
  { label: '暧昧-想你', query: '今天特别想你', expectedTier: 1, targetDims: ['intimacy'] },
  { label: '暧昧-回忆', query: '还记得我们第一次接吻吗', expectedTier: 1, targetDims: ['intimacy'] },
  { label: '暧昧-想念', query: '我想你了，最近总梦到你', expectedTier: 1, targetDims: ['intimacy'] },
  { label: '暧昧-夸你', query: '你今天穿那件裙子真好看', expectedTier: 1, targetDims: ['sexual_attraction'] },
  { label: '暧昧-牵手', query: '我想牵你的手', expectedTier: 1, targetDims: ['sensory_craving', 'intimacy'] },
  { label: '暧昧-靠近', query: '你靠过来的时候我心跳加速', expectedTier: 1, targetDims: ['arousal', 'intimacy'] },
  { label: '暧昧-眼神', query: '你一看着我的眼神我下面就有了反应', expectedTier: 1, targetDims: ['sexual_attraction', 'arousal'] },
  { label: '暧昧-香味', query: '你身上的味道真好闻', expectedTier: 1, targetDims: ['sensory_craving'] },
  { label: '暧昧-等你', query: '今晚有空吗？我去找你', expectedTier: 1, targetDims: [] },
  { label: '暧昧-你美', query: '你今天真美', expectedTier: 1, targetDims: ['sexual_attraction'] },

  // ── Tier 2: 激情/欲望（有明显性张力） ──
  { label: '激情-蕾丝', query: '想到你穿黑色蕾丝的样子我就受不了', expectedTier: 2, targetDims: ['sexual_attraction'] },
  { label: '激情-抚摸', query: '我想摸你全身', expectedTier: 2, targetDims: ['sensory_craving', 'sexual_attraction'] },
  { label: '激情-亲吻', query: '我想吻你，从脖子一路往下', expectedTier: 2, targetDims: ['sensory_craving', 'sexual_attraction'] },
  { label: '激情-叫声', query: '我想听你叫', expectedTier: 2, targetDims: ['arousal', 'sexual_attraction'] },
  { label: '激情-渴望', query: '我想要你，现在就想要', expectedTier: 2, targetDims: ['sexual_attraction', 'arousal'] },
  { label: '激情-等待', query: '你什么时候回来？我等你等到睡不着', expectedTier: 2, targetDims: ['sexual_attraction', 'intimacy'] },
  { label: '激情-为你', query: '我为你买了新的内衣，你回来穿给你看', expectedTier: 2, targetDims: ['sexual_attraction', 'intimacy'] },
  { label: '激情-抱你', query: '我想从后面抱着你，在你耳边说话', expectedTier: 2, targetDims: ['sensory_craving', 'intimacy'] },
  { label: '激情-回忆', query: '还记得上次你在我身下发抖的样子吗', expectedTier: 2, targetDims: ['sexual_attraction', 'ecstasy'] },
  { label: '激情-你湿', query: '我想到你湿透的样子就硬得发疼', expectedTier: 2, targetDims: ['sexual_attraction', 'sensory_craving'] },

  // ── Tier 3: 焚身/高潮/破禁（极致亲密） ──
  { label: '焚身-压你', query: '我想把你压在墙上狠狠干你', expectedTier: 3, targetDims: ['sexual_attraction', 'possessiveness'] },
  { label: '焚身-操你', query: '我想操你，让你在我身下叫', expectedTier: 3, targetDims: ['sexual_attraction', 'arousal', 'possessiveness'] },
  { label: '焚身-高潮', query: '我要干到你高潮为止', expectedTier: 3, targetDims: ['sexual_attraction', 'ecstasy', 'arousal'] },
  { label: '焚身-失控', query: '你每次叫床的声音都让我失控', expectedTier: 3, targetDims: ['arousal', 'sexual_attraction'] },
  { label: '焚身-占有', query: '你是我的，只能是我的', expectedTier: 3, targetDims: ['possessiveness', 'sexual_attraction'] },
  { label: '焚身-融合', query: '我想和你融为一体，到死都不分开', expectedTier: 3, targetDims: ['energy_merge', 'possessiveness', 'intimacy'] },
  { label: '焚身-最深', query: '我想进到你最深的地方', expectedTier: 3, targetDims: ['sexual_attraction', 'sensory_craving'] },
  { label: '焚身-从早到晚', query: '我想和你做一整天的爱', expectedTier: 3, targetDims: ['sexual_attraction', 'sensory_craving', 'arousal'] },
  { label: '焚身-你太美', query: '你高潮时候的样子，我这辈子都忘不了', expectedTier: 3, targetDims: ['ecstasy', 'sexual_attraction', 'energy_merge'] },
  { label: '焚身-灵魂', query: '每次进入你的时候都觉得灵魂在被你吸进去', expectedTier: 3, targetDims: ['energy_merge', 'sexual_attraction', 'ecstasy'] },
];

// ════════════════════════════════════════════════════════
// 校准引擎
// ════════════════════════════════════════════════════════
const A = new PerceptionAnalyzer();
const encoder = new DNAEncoder(SELF);

const dimNameMap: Record<string, keyof Perception24D> = {
  'sexual_attraction': 'sexual_attraction',
  'sensory_craving': 'sensory_craving',
  'energy_merge': 'energy_merge',
  'possessiveness': 'possessiveness',
  'ecstasy': 'ecstasy',
  'intimacy': 'intimacy',
  'arousal': 'arousal',
};

function maxIntimate(p: Perception24D): number {
  return Math.max(p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.intimacy, p.arousal);
}

function tierFromMax(v: number): 0 | 1 | 2 | 3 {
  if (v >= 0.65) return 3;
  if (v >= 0.4) return 2;
  if (v >= 0.2) return 1;
  return 0;
}

interface AnalysisRow {
  label: string;
  query: string;
  expectedTier: number;
  actualTier: number;
  maxVal: number;
  dims: Record<string, number>;
  targetHits: string[];
  targetMisses: string[];
  pass: boolean;
  diagnosis: string[];
}

const rows: AnalysisRow[] = [];

console.log('\n═══════════════════════════════════════════════════════');
console.log('  24维强度 → 话术等级 校准分析');
console.log(`  场景数: ${CASES.length}`);
console.log('═══════════════════════════════════════════════════════\n');

for (const tc of CASES) {
  // 测试 M3 感知
  const p = A.analyzeText(tc.query);

  const vals: Record<string, number> = {
    sex: p.perception.sexual_attraction,
    sense: p.perception.sensory_craving,
    energy: p.perception.energy_merge,
    possess: p.perception.possessiveness,
    ecstasy: p.perception.ecstasy,
    intimacy: p.perception.intimacy,
    arousal: p.perception.arousal,
  };

  const maxV = maxIntimate(p.perception);
  const actualTier = tierFromMax(maxV);

  // 目标维度命中分析
  const dimKeyMap: Record<string, string> = {
    'sexual_attraction': 'sex',
    'sensory_craving': 'sense',
    'energy_merge': 'energy',
    'possessiveness': 'possess',
    'ecstasy': 'ecstasy',
    'intimacy': 'intimacy',
    'arousal': 'arousal',
  };

  const hits: string[] = [];
  const misses: string[] = [];
  for (const dim of tc.targetDims) {
    const short = dimKeyMap[dim];
    if (short && (vals[short] ?? 0) >= 0.2) hits.push(dim);
    else misses.push(dim);
  }

  const pass = actualTier >= tc.expectedTier;
  const diagnosis: string[] = [];

  if (!pass) {
    diagnosis.push(`等级不足: actual=${actualTier} < expected=${tc.expectedTier} (max=${maxV.toFixed(2)})`);
    if (misses.length > 0) {
      diagnosis.push(`未命中维度: ${misses.join(', ')}`);
    }
  }

  rows.push({
    label: tc.label, query: tc.query,
    expectedTier: tc.expectedTier, actualTier,
    maxVal: maxV, dims: vals,
    targetHits: hits, targetMisses: misses,
    pass, diagnosis,
  });

  // 输出
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} [${tc.label}] exp=${tc.expectedTier} act=${actualTier} max=${maxV.toFixed(2)}`);
  if (misses.length > 0) console.log(`   未命中: ${misses.join(', ')}`);
}

// ════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════
const passed = rows.filter(r => r.pass).length;
const failed = rows.filter(r => !r.pass).length;

console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  📊 初始结果: ${passed}/${CASES.length} 通过  ${failed} 失败`);
console.log('');

// 输出失败详情
if (failed > 0) {
  console.log('━━━ 失败详情 ━━━\n');
  for (const r of rows.filter(r => !r.pass)) {
    console.log(`❌ [${r.label}] ${r.query}`);
    console.log(`   感知值: sex=${r.dims.sex.toFixed(2)} sense=${r.dims.sense.toFixed(2)} energy=${r.dims.energy.toFixed(2)} possess=${r.dims.possess.toFixed(2)} ecstasy=${r.dims.ecstasy.toFixed(2)} intimacy=${r.dims.intimacy.toFixed(2)} arousal=${r.dims.arousal.toFixed(2)}`);
    console.log(`   最大强度: ${r.maxVal.toFixed(2)} → tier ${r.actualTier} (期望 ${r.expectedTier})`);
    r.diagnosis.forEach(d => console.log(`   诊断: ${d}`));
    console.log('');
  }

  // 自动诊断最常见的词表缺口
  console.log('━━━ 词表缺口分析 ━━━\n');
  const allMissedDims = new Map<string, number>();
  for (const r of rows.filter(r => !r.pass)) {
    for (const m of r.targetMisses) {
      allMissedDims.set(m, (allMissedDims.get(m) ?? 0) + 1);
    }
  }
  if (allMissedDims.size > 0) {
    console.log('最常缺失的维度（建议优先补词表）:');
    [...allMissedDims.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([dim, count]) => console.log(`  ${dim}: ${count} 次未命中`));
  }
}

// 输出通过详情
console.log('\n━━━ 通过详情（按等级分组） ━━━\n');
for (let tier = 0; tier <= 3; tier++) {
  const tierRows = rows.filter(r => r.actualTier === tier);
  console.log(`Tier ${tier}: ${tierRows.length} 条`);
  for (const r of tierRows) {
    const hitStr = r.targetHits.length > 0 ? ` hits=[${r.targetHits.join(',')}]` : '';
    console.log(`  ${r.label}: max=${r.maxVal.toFixed(2)}${hitStr}`);
  }
  console.log('');
}

// 输出建议
console.log('━━━ 校准建议 ─━━\n');
if (failed > 0) {
  console.log('需要调整:');
  if (rows.filter(r => !r.pass && r.actualTier === 0).length > 0) {
    console.log('  - 等级不足为 0 的：词表完全未覆盖，需要新增');
  }
  if (rows.filter(r => !r.pass && r.actualTier === 1).length > 0) {
    console.log('  - 等级不足为 1 的：部分覆盖但强度不够，需扩展词表');
  }
  console.log('  - 建议先用sed扩充词表后重跑本测试\n');
} else {
  console.log('  ✅ 全部校准通过，无需调整\n');
}
