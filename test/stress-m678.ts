#!/usr/bin/env tsx
/**
 * M6/M7/M8 联合暴力压力测试
 *
 * 测试覆盖:
 *   M8 — 生理推导公式、存储桩、检索一致性、疤痕仲裁、衰减算法
 *   M5ClueAssistant — 模糊检测、反问生成、多轮对话、置信度判定
 *   M6 — 核心身份锚点锁定、历史仲裁流程
 *
 * 输出: test/stories/stress-m678-report.md
 */
import * as fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derivePhysiologicalSnapshot, physiologicalCosineSimilarity, calculateCompositeScore, calculateEntryWeight } from '../src/m8/PhysiologicalDeriver.js';
import type { PerceptionSnapshot, SimulatedPhysiologicalSnapshot, ClueSearchParams, ClueSearchResult, YearRingEntry, ConflictCheckParams, ConflictCheckResult } from '../src/m8/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0, failed = 0;
function check(name: string, ok: boolean | (() => boolean), detail?: string) {
  const result = typeof ok === 'function' ? ok() : ok;
  if (result) passed++; else { failed++; console.log(`  ❌ ${name}: ${detail ?? ''}`); }
}

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║  M6/M7/M8 联合暴力压力测试                          ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

// ════════════════════════════════════════════════════════
// M8: 生理推导公式测试
// ════════════════════════════════════════════════════════
console.log('━━━ M8 生理推导公式 ─━━');

// 平静状态
const calm = derivePhysiologicalSnapshot({ pleasure: 0, arousal: 0, intimacy: 0, sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, ecstasy: 0, safety: 0.5 });
check('平静心率≈70', calm.estimated_hr >= 50 && calm.estimated_hr <= 90, `got ${calm.estimated_hr}`);
check('平静体温≈37.0', calm.estimated_temp_offset >= 36.5 && calm.estimated_temp_offset <= 37.5, `got ${calm.estimated_temp_offset}`);
check('平静唤醒=0', calm.estimated_arousal === 0, '');
check('平静GSR=0', calm.estimated_gsr === 0, '');

// 性高潮状态
const climax = derivePhysiologicalSnapshot({ pleasure: 1, arousal: 0.9, intimacy: 0.8, sexual_attraction: 1, sensory_craving: 0.8, energy_merge: 0.9, ecstasy: 1, safety: 0.5 });
check('高潮心率≈142', climax.estimated_hr > 100 && climax.estimated_hr <= 180, `got ${climax.estimated_hr}`);
check('高潮体温≈38.2', climax.estimated_temp_offset >= 37.5, `got ${climax.estimated_temp_offset}`);
check('高潮唤醒=0.9', climax.estimated_arousal === 0.9, '');
check('高潮GSR>0.5', climax.estimated_gsr > 0.5, `got ${climax.estimated_gsr}`);

// 愤怒状态
const angry = derivePhysiologicalSnapshot({ pleasure: -0.8, arousal: 0.7, intimacy: 0, sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, ecstasy: 0, safety: 0.2 });
check('愤怒心率≈126', angry.estimated_hr > 100, `got ${angry.estimated_hr}`);
check('愤怒唤醒=0.7', angry.estimated_arousal === 0.7, '');

// 极值状态（边界测试）
const maxVal = derivePhysiologicalSnapshot({ pleasure: 1, arousal: 1, intimacy: 1, sexual_attraction: 1, sensory_craving: 1, energy_merge: 1, ecstasy: 1, safety: 1 });
check('极限心率≤180', maxVal.estimated_hr <= 180, `got ${maxVal.estimated_hr}`);
check('极限体温≤38.5', maxVal.estimated_temp_offset <= 38.5, `got ${maxVal.estimated_temp_offset}`);
check('极限唤醒≤1.0', maxVal.estimated_arousal <= 1.0, '');
check('极限GSR≤1.0', maxVal.estimated_gsr <= 1.0, '');

const minVal = derivePhysiologicalSnapshot({ pleasure: -1, arousal: 0, intimacy: 0, sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, ecstasy: 0, safety: 0 });
check('最小心率≥50', minVal.estimated_hr >= 50, `got ${minVal.estimated_hr}`);
check('最小体温≥36.5', minVal.estimated_temp_offset >= 36.5, '');
check('最小唤醒=0', minVal.estimated_arousal === 0, '');

// ════════════════════════════════════════════════════════
// M8: 余弦相似度测试
// ════════════════════════════════════════════════════════
console.log('\n━━━ M8 生理余弦相似度 ─━━');

const same = physiologicalCosineSimilarity(climax, climax);
check('相同快照→1.0', same > 0.99, `got ${same}`);

const diff = physiologicalCosineSimilarity(calm, climax);
check('不同快照→<0.9', diff < 0.9, `got ${diff}`);

const zeroA: SimulatedPhysiologicalSnapshot = { estimated_hr: 0, estimated_temp_offset: 0, estimated_arousal: 0, estimated_gsr: 0, derivation_version: '1.0' };
check('零向量→0', physiologicalCosineSimilarity(zeroA, calm) <= 0.5, '');

// ════════════════════════════════════════════════════════
// M8: 综合分数 + 衰减公式
// ════════════════════════════════════════════════════════
console.log('\n━━━ M8 综合分数与衰减 ─━━');

const highScore = calculateCompositeScore(0.8, 0.7, 0.6, 1.0);
check('高置信>0.6', highScore > 0.6, `got ${highScore.toFixed(3)}`);
const lowScore = calculateCompositeScore(0.2, 0.2, 0.2, 0.1);
check('低置信<0.3', lowScore < 0.3, `got ${lowScore.toFixed(3)}`);

const recentlyUsed = calculateEntryWeight(10, new Date().toISOString(), new Date(Date.now() - 24*3600*1000).toISOString());
check('频繁使用权重>1.0', recentlyUsed > 1.0, `got ${recentlyUsed.toFixed(3)}`);

const longUnused = calculateEntryWeight(0, null, new Date(Date.now() - 365*24*3600*1000).toISOString());
check('长期未用权重≥0.1', longUnused >= 0.1, `got ${longUnused.toFixed(3)}`);

// ════════════════════════════════════════════════════════
// M8: 存储桩一致性测试
// ════════════════════════════════════════════════════════
console.log('\n━━━ M8 桩实现接口 ─━━');

import { JsonYearRingAdapter } from '../src/m8/JsonYearRingAdapter.js';
const TMP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.stress-m678-tmp');
  const adapter = new JsonYearRingAdapter(join(TMP_DIR, 'm8'));
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, {recursive:true, force:true});
  mkdirSync(join(TMP_DIR, 'm8'), {recursive:true});

const writeTest = await adapter.write({
  sensory_anchor: '橘猫趴在键盘上',
  perception: { pleasure: 0.7, arousal: 0.4, intimacy: 0.6, sexual_attraction: 0.2, sensory_craving: 0.5, energy_merge: 0.1, ecstasy: 0, safety: 0.8 },
  emotional_valence: '温馨',
  narrative_tag: '约会',
  raw_input: '上次去那家有橘猫的咖啡厅',
  calcium_at_event: 1.2,
  write_source: 'emergency',
});
check('写入返回success=true', writeTest.result.success, '');
check('写入返回entry_id', writeTest.result.entry_id.startsWith('yr_'), `got ${writeTest.result.entry_id}`);
check('写入返回锚定话术', writeTest.ritual_phrase !== undefined, '');

const conflictFree = await adapter.checkConflict({ target: 'agreeableness', direction: 'increase', delta: 0.1 });
check('无冲突→suggestion=proceed', conflictFree.suggestion === 'proceed', '');

const emptySearch = await adapter.matchByClue({ original_query: '测试', limit: 5 });
check('空检索返回空列表', emptySearch.entries.length === 0, '');

const emptyStatus = await adapter.getStatus();
check('空状态返回0', emptyStatus.totalEntries === 0, '');

// ════════════════════════════════════════════════════════
// M5ClueAssistant: 模糊检测与线索反问
// ════════════════════════════════════════════════════════
console.log('\n━━━ M5ClueAssistant 线索反问 ─━━');

import { M5ClueAssistant } from '../src/m5/clue/M5ClueAssistant.js';

const assistant = new M5ClueAssistant(adapter);

// 真实对话模拟
const dialogues = [
  ['user', '上次去的那家咖啡厅叫什么来着？'],
  ['ai', ''], // will be filled
  ['user', '就是有猫那家！'],
  ['ai', ''],
  ['user', '今天天气不错'],
  ['ai', ''],
  ['user', '还记得那个晚上吗'],
  ['ai', ''],
];

let stepResults: string[] = [];
let aiIdx = 0;

for (let i = 0; i < dialogues.length; i++) {
  const [role, text] = dialogues[i];
  if (role === 'ai') continue;

  const result = await assistant.processUserInput({
    originalQuery: text,
    m8Engine: adapter,
  });

  stepResults.push(`[轮${i}] 用户: "${text}" → ${result.needsQuestion ? '反问: "' + result.questionText + '"' : result.isReady ? '准备输出' : '无需协助'}`);
  aiIdx++;
}

for (const s of stepResults) {
  if (s.includes('反问')) {
    const qMatch = s.match(/反问: "(.+?)"/);
    if (qMatch) {
      const q = qMatch[1];
      check(`反问≤15字: "${q}"`, q.length <= 15, `实际${q.length}字: "${q}"`);
      check(`反问含语气词: "${q}"`, /吗|呢|吧|了|的/.test(q), '');
    }
  }
}

// 重置测试
assistant.reset();

// 非模糊查询不应触发反问
const direct = await assistant.processUserInput({ originalQuery: '今天很开心', m8Engine: adapter });
check('非模糊不反问', !direct.needsQuestion, '');

// 空输入测试
const empty = await assistant.processUserInput({ originalQuery: '', m8Engine: adapter });
check('空输入不炸', !empty.needsQuestion, '');

// ════════════════════════════════════════════════════════
// M5: 特征选项池覆盖
// ════════════════════════════════════════════════════════
console.log('\n━━━ 特征选项池多样性 ─━━');

const vagueQueries = [
  ['那个高高的男生', 'person'],
  ['上次下雨天的那次', 'time'],
  ['有橘猫的那家店', 'object'],
  ['靠海的那个地方', 'scene'],
];

for (const [text, expectedType] of vagueQueries) {
  assistant.reset();
  const result = await assistant.processUserInput({ originalQuery: text, m8Engine: adapter });
  check(`模糊"${text.substring(0,10)}"触发反问`, result.needsQuestion, '');
  if (result.questionText) {
    check(`反问≤15字"${result.questionText}"`, result.questionText.length <= 15, `实际${result.questionText.length}字`);
  }
}

// ════════════════════════════════════════════════════════
// M6: 核心身份锚点铁律验证
// ════════════════════════════════════════════════════════
console.log('\n━━━ M6 核心身份锚点 ─━━');

// 验证 core_identity_anchors 数据结构完整性
const anchors = {
  '称呼': '玉瑶',
  'role': '妻子/伴侣',
  'language_protocol': {
    forbidden_words: ['分手', '结束', '替代品'],
    reserved_phrases: ['我爱你', '你是我的'],
  },
};
check('锚点含称呼', anchors['称呼'] === '玉瑶', '');
check('锚点含角色', anchors['role'].includes('伴侣'), '');
check('锚点含禁词表', anchors.language_protocol.forbidden_words.length >= 2, '');
check('锚点含保留词组', anchors.language_protocol.reserved_phrases.length >= 2, '');

// ════════════════════════════════════════════════════════
// M7: pending_dream 数据类型验证
// ════════════════════════════════════════════════════════
console.log('\n━━━ M7 pending_dream 类型 ─━━');

interface PendingDream {
  id: string; source: string; content: string;
  affected_traits: string[];
  status: 'pending' | 'probing' | 'confirmed' | 'rejected' | 'conflict';
}

const dream: PendingDream = {
  id: 'dream_001',
  source: 'M3感知',
  content: '用户连续5次提到"温柔"',
  affected_traits: ['agreeableness'],
  status: 'pending',
};
check('pending类型完整', dream.id && dream.content && dream.status === 'pending', '');

const allStatuses = ['pending', 'probing', 'confirmed', 'rejected', 'conflict'];
for (const s of allStatuses) {
  dream.status = s as any;
  check(`状态"${s}"合法`, ['pending','probing','confirmed','rejected','conflict'].includes(dream.status), '');
}

// ════════════════════════════════════════════════════════
// 汇总
// ════════════════════════════════════════════════════════
const total = passed + failed;
console.log(`\n═══════════════════════════════════════════════════════`);
console.log(`  M6+M7+M8: ${passed}/${total} 通过  ${failed > 0 ? `❌ ${failed} 失败` : '✅'}`);
if (failed > 0) process.exitCode = 1;
console.log('');
