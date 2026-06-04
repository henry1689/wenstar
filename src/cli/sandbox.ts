#!/usr/bin/env tsx
/**
 * Hermes Developer CLI Sandbox
 *
 * 开发者专用对话沙盒 — 亲手验证 M1→M5 整条管线
 *
 * 用法: npm run sandbox
 *       或 npx tsx src/cli/sandbox.ts
 *
 * 命令: /exit  /reset  /status
 *
 * 纯本地运行，零网络请求，零隐私风险。
 */

import * as readline from 'node:readline';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DNAEncoder } from '../m1/DNAEncoder.js';
import { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import { M3LogicOrchestrator } from '../m3/M3LogicOrchestrator.js';
import { M4Orchestrator } from '../m4/M4Orchestrator.js';
import { M5Orchestrator } from '../m5/M5Orchestrator.js';
import { FamilyGraph } from '../m4/FamilyGraph.js';
import type { SelfModelV1 } from '../m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP_DIR = join(__dirname, '..', '..', '.sandbox-data');
const DB_PATH = join(TMP_DIR, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '温和理性的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: ['不提供医疗建议', '不泄露隐私', '不编造事实'],
  preferences: { likes: ['深度对话'], dislikes: ['敷衍'] },
  narrative_identity: '我是一个正在生长中的认知生命体',
};

let encoder: DNAEncoder;
let storage: FusionStorageAdapter;
let m3: M3LogicOrchestrator;
let familyGraph: FamilyGraph;
let m4: M4Orchestrator;
let m5: M5Orchestrator;
let conversationCount = 0;

async function init(): Promise<void> {
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  encoder = new DNAEncoder(SELF);
  storage = new FusionStorageAdapter(TMP_DIR);
  await storage.initialize();
  familyGraph = new FamilyGraph(DB_PATH);
  await familyGraph.initialize();
  m4 = new M4Orchestrator(storage, familyGraph);
  await m4.initialize();
  m3 = new M3LogicOrchestrator();
  m5 = new M5Orchestrator();
}

async function processInput(text: string): Promise<void> {
  conversationCount++;
  const levelNames = ['粉末', '液体', '固体', '晶体'];

  const dna = encoder.encodeSingle(text);
  console.log(`  📦 M1: ${dna.branch_id}  ${dna.locus_path}`);
  if (dna.entity_genes.length > 0) {
    console.log(`      实体: ${dna.entity_genes.map(e => `${e.name}(${e.type})`).join(', ')}`);
  }

  // 沙盒模式：用中性感知向量写入 Fusion 存储
  const neutralPerception = {
    pleasure: 0, arousal: 0.3, dominance: 0, aggression: 0, sincerity: 0.5, humor: 0,
    factual: 0.5, logical: 0.5, certainty: 0.5, abstract: 0.3, temporal_focus: 0, self_ref: 0.5,
    intimacy: 0, power_diff: 0, dependency: 0, moral_judgment: 0, etiquette: 0.3, belonging: 0,
    sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, possessiveness: 0, ecstasy: 0, safety: 0.5,
  };
  const wr = await storage.write(dna, neutralPerception);
  console.log(`  💾 Fusion: ref=${wr.real_ref} seq=${wr.seq_pos}`);

  const decision = m3.decide(dna, { current_time: new Date().toISOString(), current_location: '深圳' });
  const p = decision.enhanced.perception;
  const level = levelNames[decision.enhanced.calcium_level] ?? '?';
  console.log(`  🧠 M3: calcium=${decision.enhanced.calcium_score.toFixed(2)}(${level}) pleasure=${p.pleasure.toFixed(2)} arousal=${p.arousal.toFixed(2)}`);
  console.log(`      动作: ${decision.actions.join(', ')}`);

  const ctx = await m4.orchestrate(decision);
  const fg = ctx.family_context ? `🏠${ctx.family_context.length}个家族关系` : '';
  const hist = ctx.memory_summary.timeline.length > 0 ? `📜${ctx.memory_summary.timeline.length}条历史` : '';
  console.log(`  📚 M4: ${[fg, hist].filter(Boolean).join(' ') || '无相关记忆'}`);

  const reply = await m5.orchestrate(ctx);
  console.log(`  💬 M5: ${reply}`);
  console.log('');
}

async function main(): Promise<void> {
  await init();

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Hermes Developer CLI Sandbox  v1.0         ║');
  console.log('║  输入任意文本 → 自动运行 M1→M5 全管线       ║');
  console.log('║  命令: /exit  /reset  /status               ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // 收集所有输入行（兼容管道和交互模式）
  const lines: string[] = [];
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '🤖 > ' });

  if (process.stdin.isTTY) {
    // 交互模式
    rl.prompt();
    rl.on('line', (line: string) => {
      const input = line.trim();
      if (!input) { rl.prompt(); return; }
      if (input === '/exit' || input === '/quit') { rl.close(); return; }
      if (input === '/reset') { init().then(() => { console.log('  🗑️  重置完成\n'); rl.prompt(); }); return; }
      if (input === '/status') { console.log(`  对话: ${conversationCount}\n`); rl.prompt(); return; }
      processInput(input).then(() => rl.prompt()).catch(e => { console.error(`  ❌ ${e.message}\n`); rl.prompt(); });
    });
    rl.on('close', () => { console.log('👋 再见'); process.exit(0); });
  } else {
    // 管道模式（echo "你好" | npm run sandbox）
    rl.on('line', (line: string) => lines.push(line));
    rl.on('close', async () => {
      for (const line of lines) {
        const input = line.trim();
        if (!input || input === '/exit') continue;
        if (input === '/reset') { await init(); continue; }
        await processInput(input).catch(e => console.error(`  ❌ ${e.message}\n`));
      }
      process.exit(0);
    });
  }
}

main().catch(e => { console.error('致命错误:', e); process.exit(1); });
