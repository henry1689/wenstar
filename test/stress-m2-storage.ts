#!/usr/bin/env tsx
/**
 * M2 JSON存储适配器 压力测试
 *
 * 焦点:
 * - 高容量写入（500+ 条）
 * - 5区隔离完整性
 * - index.json 一致性
 * - counter.json 原子性
 * - 文件损毁恢复
 * - 跨会话 seq_pos 连续性
 */
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonStorageAdapter } from '../src/m2/JsonStorageAdapter.js';
import type { DNA, LeafZone } from '../src/m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP = join(__dirname, '..', '.stress-m2');

if (fs.existsSync(TMP)) fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function makeDNA(lz: LeafZone, id: number): DNA {
  const s = String(id).padStart(4, '0');
  return {
    locus_path: 'user.misc.default', taxonomy_version: '1.0',
    branch_id: `stress_m2_${s}`,
    seq_pos: id, leaf_zone: lz, ref: `tmp_${s}`,
    entity_genes: [],
    raw_input: `M2应力测试输入第${id}条`.repeat(id > 300 ? 20 : 1),
    created_at: '2026-06-02T00:00:00.000Z',
  };
}

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) passed++; else { failed++; console.log(`  ❌ ${name}: ${detail}`); }
}

const ZONES: LeafZone[] = [
  'language_semantic_zone', 'emotion_valence_zone',
  'embodied_perception_zone', 'spatiotemporal_episode_zone',
  'social_schema_zone',
];

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M2 JSON存储适配器 压力测试                         ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

const adapter = new JsonStorageAdapter(TMP);
await adapter.initialize();

// ─── 1. 高容量写入 ───
console.log('━━━ 高容量写入 ─━━');
const writeStart = Date.now();
for (let i = 1; i <= 500; i++) {
  const dna = makeDNA(ZONES[i % 5], i);
  const r = await adapter.write(dna);
  if (!r.success) { check(`写入第${i}条`, false, r.error ?? ''); break; }
  if (i === 500) check('500条写入全部成功', r.success && r.seq_pos === 500, `最后seq=${r.seq_pos}`);
}
const writeTime = Date.now() - writeStart;
check(`500条写入耗时`, writeTime < 30000, `实际${writeTime}ms`);

// ─── 2. 5区隔离 ───
console.log('\n━━━ 5区隔离 ─━━');
for (const z of ZONES) {
  const zoneFile = join(TMP, 'zones', `${z}.json`);
  const raw = JSON.parse(fs.readFileSync(zoneFile, 'utf-8'));
  const expected = 500 / 5; // 平均100条
  check(`区${z}记录数≈${expected}`, Math.abs(raw.length - expected) < 20, `实际${raw.length}`);
}

// ─── 3. index.json 一致性 ───
console.log('\n━━━ 索引一致性 ─━━');
const indexFile = join(TMP, 'index.json');
const idx = JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
check('index条目数=500', idx.entries.length === 500, `实际${idx.entries.length}`);
check('branch_id格式正确', idx.entries.every((e: any) => e.branch_id.startsWith('stress_m2_')), '');
check('seq_pos无重复', new Set(idx.entries.map((e: any) => e.seq_pos)).size === 500, '');

// ─── 4. 读取验证 ───
console.log('\n━━━ 读取 ─━━');
const readResult = await adapter.read('stress_m2_0250');
check('第250条可读回', readResult.dna?.raw_input.includes('250'), '');
const notFound = await adapter.read('nonexistent');
check('不存在branch_id→null', notFound.dna === null, '');

// ─── 5. counter.json 原子性 ───
console.log('\n━━━ 计数器 ─━━');
const counterFile = join(TMP, 'counter.json');
const cnt = JSON.parse(fs.readFileSync(counterFile, 'utf-8'));
check('counter.lastId=500', cnt.lastId === 500, `实际${cnt.lastId}`);

// ─── 6. 跨会话连续性 ───
console.log('\n━━━ 跨会话 ─━━');
const adapter2 = new JsonStorageAdapter(TMP);
await adapter2.initialize();
const finalDna = makeDNA('language_semantic_zone', 999);
const r2 = await adapter2.write(finalDna);
check('跨会话seq_pos继续递增', r2.seq_pos === 501, `实际${r2.seq_pos}`);

// ─── 7. 文件损毁恢复 ───
console.log('\n━━━ 文件损毁恢复 ─━━');
const bogus = join(TMP, 'zones', 'bogus.json');
fs.writeFileSync(bogus, '{invalid json', 'utf-8');
try {
  const adapter3 = new JsonStorageAdapter(TMP);
  await adapter3.initialize();
  check('损坏文件不阻塞初始化', true, '');
} catch { check('损坏文件不阻塞初始化', false, '抛出异常'); }

// ─── 8. 查询 ───
console.log('\n━━━ 查询 ─━━');
const q1 = await adapter.findByLocus('user.misc');
check('locus前缀查询返回数据', q1.length > 0, `返回${q1.length}条`);
const q2 = await adapter.findBySeqPosRange(1, 10);
check('范围查询返回10条', q2.length === 10, `返回${q2.length}条`);

// ─── 9. 大文本 ───
console.log('\n━━━ 大文本 ─━━');
const bigDna = makeDNA('language_semantic_zone', 1000);
bigDna.raw_input = 'X'.repeat(50000);
const r3 = await adapter.write(bigDna);
check('5万字文本写入成功', r3.success, '');

// ─── 汇总 ───
fs.rmSync(TMP, { recursive: true, force: true });
const total = passed + failed;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  M2: ${passed}/${total} 通过  ${failed > 0 ? `❌ ${failed} 失败` : '✅'}`);
if (failed > 0) process.exitCode = 1;
console.log('');
