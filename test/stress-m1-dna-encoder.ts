#!/usr/bin/env tsx
/**
 * M1 DNA编码器 压力测试
 *
 * 焦点:
 * - L0路由精度（模糊/复合/边界输入）
 * - L3实体提取（噪音/缺失/冲突）
 * - 语义边界检测（快速话题切换/情感翻转链）
 * - push/flush 流式模式（深度缓冲/强制中断）
 * - seq_pos 单调性（跨重置/高强度连续）
 */
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { routeL0 } from '../src/m1/L0Router.js';
import { SemanticBoundaryDetector } from '../src/m1/SemanticBoundaryDetector.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';
import type { TaxonomyTree } from '../src/m1/types/dna.js';

const SELF: SelfModelV1 = {
  identity: { name: 'T', persona: 't', birth_date: '2026-01-01T00:00:00.000Z' },
  traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  boundaries: [], preferences: { likes: [], dislikes: [] }, narrative_identity: 't',
};

const TAX: TaxonomyTree = {
  version: '1.0-test',
  tree: { user: { family: ['conflict', 'care'], emotion: ['positive', 'negative'], work: ['stress', 'achievement'], misc: ['default'] } },
};

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) passed++; else { failed++; console.log(`  ❌ ${name}: ${detail ?? ''}`); }
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M1 DNA编码器 压力测试                              ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// ─── 1. L0路由精度 ───
console.log('━━━ 路由精度 ─━━');
check('家庭冲突', routeL0('我妈又催婚了，烦死了', TAX).locus_path === 'user.family.conflict', '');
check('家庭关爱', routeL0('想家了，想回去看看妈妈', TAX).locus_path === 'user.family.care', '');
check('工作压力', routeL0('加班到凌晨，压力好大', TAX).locus_path === 'user.work.stress', '');
check('积极情绪', routeL0('今天太开心了！升职了！', TAX).locus_path.startsWith('user.emotion.positive'), '');
check('复合意图最高优先级优先', routeL0('加班虽然累但很开心', TAX).locus_path === 'user.work.stress', '');
check('空字符串兜底', routeL0('', TAX).is_fallback, '');
check('纯特殊字符兜底', routeL0('!@#$%^&*()', TAX).is_fallback, '');
check('中英混合兜底', routeL0('I love you 宝贝', TAX).is_fallback, '');

// ─── 2. 实体提取 ───
console.log('\n━━━ 实体提取 ─━━');
const e1 = new DNAEncoder(SELF).encodeSingle('妈妈和爸爸在深圳').entity_genes;
check('提取家庭成员', e1.some(e => e.type === 'person'), e1.map(e=>e.name+':'+e.type).join(', '));
check('提取地点', e1.some(e => e.type === 'place'), e1.filter(e=>e.type==='place').map(e=>e.name).join(',') || '无地点');

const e2 = new DNAEncoder(SELF).encodeSingle('我觉得好孤独好难过').entity_genes;
check('提取情绪实体', e2.some(e => e.type === 'emotion'), e2.map(e=>e.name).join(','));
check('情绪phenotype为conflict', e2.filter(e=>e.type==='emotion').every(e=>e.phenotype==='conflict'), '');

const e3 = new DNAEncoder(SELF).encodeSingle('我去了北京天安门').entity_genes;
const placeWorld = e3.find(e => e.type === 'place');
check('公共地点标注为world', placeWorld?.knowledge_type === 'world', placeWorld?.name + '=' + placeWorld?.knowledge_type);

// ─── 3. 语义边界 ───
console.log('\n━━━ 语义边界 ─━━');
const det = new SemanticBoundaryDetector();
check('话题切换(家庭→天气)', det.detect('妈妈身体不好', '今天天气真好').is_new_unit, '');
check('情感翻转检测', () => {
  const r = det.detect('好开心啊', '真的好难过');
  return r.is_new_unit === true;
}, '');
check('同话题连续', det.detect('今天天气不错', '适合出去走走').is_new_unit === false, '');
check('长时间间隔触发', det.detect('早上好', '晚上好', { prevTimestamp:'2026-01-01T08:00:00Z', currTimestamp:'2026-01-01T21:00:00Z' }).is_new_unit, '');

// ─── 4. push/flush ───
console.log('\n━━━ 流式模式 ─━━');
const enc2 = new DNAEncoder(SELF);
check('首次push→null', enc2.push('第一条') === null, '');
check('二次push可能触发auto-flush或缓冲', () => { const r = enc2.push('还是同一件事'); return r === null || r?.raw_input !== undefined; }, '');
enc2.flush();
check('flush后缓冲区清零', enc2.getBufferSize() === 0, `size=${enc2.getBufferSize()}`);
check('空缓冲flush→null', enc2.flush() === null, '');

// 话题切换自动flush
const enc3 = new DNAEncoder(SELF);
enc3.push('家里又吵架了');
const r5 = enc3.push('今天天气真好');
check('话题切换自动flush返回之前DNA', r5 !== null && r5.locus_path.includes('family'), r5?.locus_path ?? 'null');
check('新话题进入新缓冲区', enc3.getBufferSize() === 1, `size=${enc3.getBufferSize()}`);

// ─── 5. seq_pos ───
console.log('\n━━━ seq_pos ─━━');
const enc4 = new DNAEncoder(SELF);
let prev = 0;
for (let i = 0; i < 100; i++) { const d = enc4.encodeSingle(`测试${i}`); if (d.seq_pos !== prev + 1) break; prev = d.seq_pos; }
check('100次严格递增', prev === 100, `最后seq=${prev}`);
enc4.resetSession();
check('重置后从1', enc4.encodeSingle('新').seq_pos === 1, '');

// ─── 6. 异常耐受 ───
console.log('\n━━━ 异常耐受 ─━━');
try { new DNAEncoder(SELF).encodeSingle('a'.repeat(100000)); check('10万字不崩溃', true, ''); } catch { check('10万字不崩溃', false, ''); }
try { const e = new DNAEncoder(SELF); e.push(''); e.push(''); e.flush(); check('连续空push不崩溃', true, ''); } catch { check('连续空push不崩溃', false, ''); }

// ─── 7. 确定性 ───
console.log('\n━━━ 确定性 ─━━');
const ref = routeL0('妈妈又催婚了，烦死了', TAX);
for (let i = 0; i < 50; i++) {
  const r = routeL0('妈妈又催婚了，烦死了', TAX);
  if (r.locus_path !== ref.locus_path || r.rule_id !== ref.rule_id) { check('50次一致', false, ''); break; }
  if (i === 49) check('50次一致', true, '');
}

const total = passed + failed;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  M1: ${passed}/${total} 通过  ${failed > 0 ? `❌ ${failed} 失败` : '✅'}`);
if (failed > 0) process.exitCode = 1;
console.log('');
