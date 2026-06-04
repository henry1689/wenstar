#!/usr/bin/env tsx
/**
 * Hermes 全模块压力测试主入口
 */

import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const SCRIPTS = [
  ['M1', 'stress-m1-dna-encoder.ts'],
  ['M2', 'stress-m2-storage.ts'],
  ['M3-24D', 'stress-m3-24d-full.ts'],
  ['M3-感知', 'stress-m3-perception.ts'],
  ['M4', 'stress-m4-family-graph.ts'],
  ['M5', 'stress-m5-expression.ts'],
  ['速度', 'benchmark-response-time.ts'],
];

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  Hermes 全模块压力测试套件 v1.0                    ║');
console.log('║  7 套件 × 边界值/24维全覆盖/性能基准               ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

let totalPass = 0, totalFail = 0;
const results: Array<{ name: string; pass: number; fail: number }> = [];

for (const [name, script] of SCRIPTS) {
  const path = join(__dirname, script);
  process.stdout.write(`  ◈ ${name}... `);
  try {
    const output = execSync(`npx tsx "${path}"`, { encoding: 'utf-8', cwd: ROOT, timeout: 120000 });
    const match = output.match(/(\d+)\/(\d+) 通过/);
    if (match) {
      const p = parseInt(match[1]), t = parseInt(match[2]);
      results.push({ name, pass: p, fail: t - p });
      totalPass += p; totalFail += t - p;
    } else {
      results.push({ name, pass: 0, fail: 0 });
    }
    console.log(`${match ? match[1] + '/' + match[2] : '完成'}`);
  } catch (err: any) {
    const out = err.stdout ?? '';
    const match = out.match(/(\d+)\/(\d+) 通过/);
    if (match) {
      const p = parseInt(match[1]), t = parseInt(match[2]);
      results.push({ name, pass: p, fail: t - p });
      totalPass += p; totalFail += t - p;
    } else {
      results.push({ name, pass: 0, fail: 1 });
      totalFail++;
    }
    console.log(`⚠️`);
  }
}

console.log('\n═══════════════════════════════════════════════════════');
console.log('  📊 全模块汇总');
for (const r of results) {
  console.log(`  ${r.fail === 0 ? '✅' : '❌'} ${r.name}: ${r.pass}/${r.pass + r.fail} 通过`);
}
const total = totalPass + totalFail;
console.log(totalFail === 0 ? `\n  🎉 全部 ${totalPass} 项压力测试通过\n` : `\n  ⚠️  ${totalPass}/${total} 通过\n`);
if (totalFail > 0) process.exitCode = 1;
