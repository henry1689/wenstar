#!/usr/bin/env tsx
/**
 * Hermes 响应时间基准测试
 *
 * 测量 M1-M5 每层耗时，50次迭代取平均值
 * 覆盖: 短文本(<10字)、中文本(10-50字)、长文本(>500字)、超长文本(>5000字)
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
const TMP = join(__dirname, '..', '.bench-tmp');
const DB_PATH = join(TMP, 'knowledge', 'family_graph.db');

const SELF: SelfModelV1 = {
  identity: { name: 'T', persona: 't', birth_date: '2026-01-01T00:00:00.000Z' },
  traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  boundaries: [], preferences: { likes: [], dislikes: [] }, narrative_identity: 't',
};

const TESTS = [
  { name: '短文本(2字)', text: '妈妈' },
  { name: '短文本(5字)', text: '今天好开心' },
  { name: '中文本(情感)', text: '最近天天加班到凌晨，压力好大，快撑不住了' },
  { name: '中文本(家庭)', text: '妈妈最近身体不好，我好担心，想回去看看她' },
  { name: '长文本(60字)', text: '今天跟同事聊了很多，他建议我去尝试一些新的事情，我觉得他说得有道理，但是又有点害怕改变，毕竟现在的稳定也是好不容易才得到的' },
  { name: '超长文本(200字)', text: '回顾这段时间的经历真的让我感触良多从一开始的迷茫到现在的坚定中间经历了太多事情妈妈总说人生就是这样起起落落重要的是保持一颗平常心我觉得她说得对虽然有时候还是会焦虑会害怕但至少现在我知道该怎么面对了工作上也有了新的方向虽然压力还是很大但比起以前已经好了很多感谢一直陪伴在我身边的人你们给了我力量让我能够继续前行' },
];

interface BenchResult {
  testName: string;
  m1Ms: number;
  m2Ms: number;
  m3Ms: number;
  m4Ms: number;
  m5Ms: number;
  totalMs: number;
}

async function runSingle(text: string): Promise<{m1:number;m2:number;m3:number;m4:number;m5:number}> {
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

  let t1 = performance.now();
  const dna = encoder.encodeSingle(text);
  const t2 = performance.now();
  await storage.write(dna);
  const t3 = performance.now();
  const decision = m3.decide(dna);
  const t4 = performance.now();
  const ctx = await m4.orchestrate(decision);
  const t5 = performance.now();
  await m5.orchestrate(ctx);
  const t6 = performance.now();

  rmSync(TMP, { recursive: true, force: true });
  return { m1: t2-t1, m2: t3-t2, m3: t4-t3, m4: t5-t4, m5: t6-t5 };
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  Hermes 响应时间基准测试                            ║');
console.log('║  每测试项运行 10 次取平均值                        ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

const allResults: BenchResult[] = [];

for (const test of TESTS) {
  process.stdout.write(`  ◈ ${test.name.padEnd(16)} ${test.text.substring(0,28).padEnd(30)} `);

  const runs: Array<{m1:number;m2:number;m3:number;m4:number;m5:number}> = [];
  for (let i = 0; i < 10; i++) {
    runs.push(await runSingle(test.text));
  }

  const avg = (runs: number[]) => runs.reduce((a,b) => a+b, 0) / runs.length;
  const m1 = avg(runs.map(r => r.m1));
  const m2 = avg(runs.map(r => r.m2));
  const m3 = avg(runs.map(r => r.m3));
  const m4 = avg(runs.map(r => r.m4));
  const m5 = avg(runs.map(r => r.m5));
  const total = m1+m2+m3+m4+m5;

  allResults.push({ testName: test.name, m1Ms: m1, m2Ms: m2, m3Ms: m3, m4Ms: m4, m5Ms: m5, totalMs: total });
  console.log(`M1=${m1.toFixed(1)}ms M2=${m2.toFixed(1)}ms M3=${m3.toFixed(1)}ms M4=${m4.toFixed(1)}ms M5=${m5.toFixed(1)}ms 总计=${total.toFixed(1)}ms`);
}

// 汇总输出
console.log('\n═══════════════════════════════════════════════════════');
console.log('  📊 响应时间汇总 (10次平均值, ms)\n');
console.log('| 测试项 | M1 | M2 | M3 | M4 | M5 | 总计 |\n| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n');
for (const r of allResults) {
  console.log(`| ${r.testName} | ${r.m1Ms.toFixed(1)} | ${r.m2Ms.toFixed(1)} | ${r.m3Ms.toFixed(1)} | ${r.m4Ms.toFixed(1)} | ${r.m5Ms.toFixed(1)} | ${r.totalMs.toFixed(1)} |`);
}

const avgTotal = avg(allResults.map(r => r.totalMs));
const maxTotal = Math.max(...allResults.map(r => r.totalMs));
const minTotal = Math.min(...allResults.map(r => r.totalMs));
console.log(`\n平均响应: ${avgTotal.toFixed(1)}ms | 最快: ${minTotal.toFixed(1)}ms | 最慢: ${maxTotal.toFixed(1)}ms\n`);

function avg(arr: number[]) { return arr.reduce((a,b)=>a+b,0)/arr.length; }
