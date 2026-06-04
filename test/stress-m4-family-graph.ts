#!/usr/bin/env tsx
/**
 * M4 家族知识图谱 压力测试
 *
 * 焦点:
 * - 复杂家谱构建（多代多人）
 * - 关系推断准确率
 * - 重复边/节点去重
 * - 手动修正
 * - 图谱查询性能
 * - 路径搜索
 */
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FamilyGraph } from '../src/m4/FamilyGraph.js';
import type { EntityGene } from '../src/m1/types/dna.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DB_PATH = join(__dirname, '..', '.stress-m4.db');

if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

function EG(name: string, type: 'person' | 'place' = 'person'): EntityGene {
  return { name, type, allele: name, phenotype: 'neutral', knowledge_type: type === 'place' ? 'world' : 'family' };
}

let passed = 0, failed = 0;
function check(name: string, ok: boolean | (() => boolean), detail?: string) {
  const result = typeof ok === 'function' ? ok() : ok;
  if (result) passed++; else { failed++; console.log(`  ❌ ${name}: ${detail ?? ''}`); }
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M4 家族知识图谱 压力测试                           ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

const graph = new FamilyGraph(DB_PATH);
await graph.initialize();

// ─── 1. 基础操作 ───
console.log('━━━ 基础操作 ─━━');
await graph.addNode({ id: 'u1', type: 'person', name: '我' });
await graph.addNode({ id: 'p1', type: 'person', name: '李华' });
await graph.addEdge({ source_id: 'u1', target_id: 'p1', relation: 'mother_of' });
const r1 = await graph.findRelated('李华');
check('添加后查询到节点', r1.length === 1, `实际${r1.length}`);
check('关系出/入边正确', r1[0].relationships.length >= 1, '');

// ─── 2. 自动推断 - 核心场景 ───
console.log('\n━━━ 自动推断 ─━━');
let inf1 = await graph.integrateFromEntity([EG('妈妈')], '我妈妈叫王芳');
check('妈妈→mother_of', () => inf1.details.some(d => d.includes('mother_of')), inf1.details.join('; '));

let inf2 = await graph.integrateFromEntity([EG('老婆')], '我老婆叫小芳');
check('老婆→spouse_of', () => inf2.details.some(d => d.includes('spouse_of')), '');

let inf3 = await graph.integrateFromEntity([EG('哥哥')], '我哥哥叫张伟');
check('哥哥→sibling_of', () => inf3.details.some(d => d.includes('sibling_of')), '');

let inf4 = await graph.integrateFromEntity([EG('爷爷')], '我爷爷叫李大明');
check('爷爷→grandfather_of', () => inf4.details.some(d => d.includes('grandfather_of')), '');

// ─── 3. 地点关联 ───
console.log('\n━━━ 地点关联 ─━━');
let inf5 = await graph.integrateFromEntity([EG('妈妈'), EG('深圳', 'place')], '我妈妈在深圳');
check('地点→lives_in', () => inf5.details.some(d => d.includes('lives_in')), '');

// ─── 4. 去重 ───
console.log('\n━━━ 去重 ─━━');
let inf6 = await graph.integrateFromEntity([EG('妈妈')], '我妈妈是王芳'); // 重复
check('重复推断不新增边', () => inf6.edges_created === 0, `新增${inf6.edges_created}条边`);

// ─── 5. 手动修正 ───
console.log('\n━━━ 手动修正 ─━━');
await graph.correctRelation('我', '老婆', 'sibling_of');
const afterCorrect = await graph.findRelated('老婆');
check('修正后关系更新', () => afterCorrect.length > 0, '');

// ─── 6. 复杂家谱 ───
console.log('\n━━━ 复杂家谱 ─━━');
const bigFamily = ['爷爷', '奶奶', '爸爸', '妈妈', '哥哥', '妹妹', '舅舅', '阿姨', '外公', '外婆', '表姐', '表弟', '姑姑', '姑父', '大伯', '叔叔'];
for (const member of bigFamily) {
  await graph.integrateFromEntity([EG(member)], `我的${member}是${member}`);
}
const summary = await graph.getFamilySummary();
check('家谱成员数≥5', summary.members.length >= 5, `实际${summary.members.length}人`);
check('家谱中不包含重复', new Set(summary.members.map(m => m.name)).size === summary.members.length, '');

// ─── 7. 路径搜索 ───
console.log('\n━━━ 路径搜索 ─━━');
const path = await graph.findPath('我', '爷爷');
check('我与爷爷有路径可达', path !== null, '');

// ─── 8. 添加家族成员API ───
console.log('\n━━━ 添加接口 ─━━');
await graph.addFamilyMember('测试成员', 'close_to');
const afterAdd = await graph.findRelated('测试成员');
check('addFamilyMember创建了节点', afterAdd.length > 0, '');

// ─── 9. 大规模节点 ───
console.log('\n━━━ 大规模节点 ─━━');
const start = Date.now();
for (let i = 0; i < 50; i++) {
  await graph.addNode({ id: `bulk_${i}`, type: 'person', name: `批量人${i}` });
}
const bulkTime = Date.now() - start;
check('50个节点快速写入', bulkTime < 10000, `${bulkTime}ms`);

// ─── 10. 边界 ───
console.log('\n━━━ 边界 ─━━');
try {
  await graph.integrateFromEntity([], '');
  check('空entity+空文本不崩溃', true, '');
} catch { check('空entity+空文本不崩溃', false, ''); }

try {
  await graph.correctRelation('不存在的人', '也不存在', 'mother_of');
  check('修正不存在的节点不崩溃', true, '');
} catch { check('修正不存在的节点不崩溃', false, ''); }

// ─── 清理 ───
try { fs.unlinkSync(DB_PATH); } catch {}

const total = passed + failed;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  M4: ${passed}/${total} 通过  ${failed > 0 ? `❌ ${failed} 失败` : '✅'}`);
if (failed > 0) process.exitCode = 1;
console.log('');
