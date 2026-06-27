/** 核心记忆体系审计（11项） */
import type { CheckResult } from '../types.js';
import { passed, failed, error, clock, apiGet } from '../helpers.js';
import { queryCount } from '../db.js';

const MODULE = 'memory' as const;

export async function checkMemoryAll(): Promise<CheckResult[]> {
  return Promise.all([
    checkThreeLayerStorage(),
    checkSandGoldPersistence(),
    checkStructuredMemory(),
    checkBlackDiamond(),
    checkThreeSegmentLink(),
    checkMemoryFlow(),
    checkNoteSubsystem(),
    checkItemLocation(),
    checkImportantFact(),
    checkTimedReminder(),
    checkPersonImportance(),
  ]);
}

async function checkThreeLayerStorage(): Promise<CheckResult> {
  const t = clock();
  try {
    const [conv, mem, bd] = await Promise.all([
      queryCount("SELECT COUNT(*) as c FROM conversations"),
      queryCount("SELECT COUNT(*) as c FROM memories"),
      queryCount("SELECT COUNT(*) as c FROM black_diamond"),
    ]);
    return conv > 0 && mem > 0 && bd > 0
      ? passed('memory_01', '三库分层存储', MODULE, `三表均存在: conv=${conv}, mem=${mem}, bd=${bd}`, { conv, mem, bd }, t.stop())
      : failed('memory_01', '三库分层存储', MODULE, `conv=${conv}, mem=${mem}, bd=${bd}`, { conv, mem, bd }, t.stop());
  } catch (e) { return error('memory_01', '三库分层存储', MODULE, e, t.stop()); }
}

async function checkSandGoldPersistence(): Promise<CheckResult> {
  const t = clock();
  try {
    const [total, compacted] = await Promise.all([
      queryCount("SELECT COUNT(*) as c FROM conversations"),
      queryCount("SELECT COUNT(*) as c FROM conversations WHERE is_compacted=1"),
    ]);
    return passed('memory_02', '砂金库永久留存', MODULE, `总计${total}条, 已压缩${compacted}条`, { total, compacted }, t.stop());
  } catch (e) { return error('memory_02', '砂金库永久留存', MODULE, e, t.stop()); }
}

async function checkStructuredMemory(): Promise<CheckResult> {
  const t = clock();
  try {
    const mem = await queryCount("SELECT COUNT(*) as c FROM memories");
    const withCa = await queryCount("SELECT COUNT(*) as c FROM memories WHERE calcium_score > 0");
    return mem > 0
      ? passed('memory_03', '金库结构化记忆', MODULE, `memories共${mem}条, 有钙化分${withCa}条`, { mem, withCa }, t.stop())
      : failed('memory_03', '金库结构化记忆', MODULE, `memories表为空`, { mem }, t.stop());
  } catch (e) { return error('memory_03', '金库结构化记忆', MODULE, e, t.stop()); }
}

async function checkBlackDiamond(): Promise<CheckResult> {
  const t = clock();
  try {
    const cnt = await queryCount("SELECT COUNT(*) as c FROM black_diamond");
    return cnt > 0
      ? passed('memory_04', '黑钻永久记忆', MODULE, `黑钻${cnt}条`, { bd: cnt }, t.stop())
      : failed('memory_04', '黑钻永久记忆', MODULE, `black_diamond表为空`, { bd: cnt }, t.stop());
  } catch (e) { return error('memory_04', '黑钻永久记忆', MODULE, e, t.stop()); }
}

async function checkThreeSegmentLink(): Promise<CheckResult> {
  const t = clock();
  try {
    const [withDna, total] = await Promise.all([
      queryCount("SELECT COUNT(*) as c FROM conversations WHERE dna_root_id IS NOT NULL"),
      queryCount("SELECT COUNT(*) as c FROM conversations"),
    ]);
    const pct = total > 0 ? Math.round(withDna / total * 100) : 0;
    return pct > 80
      ? passed('memory_05', '三段式关联', MODULE, `DNA关联率${pct}%(${withDna}/${total})`, { dnaRate: pct, withDna, total }, t.stop())
      : failed('memory_05', '三段式关联', MODULE, `DNA关联率仅${pct}%`, { dnaRate: pct, withDna, total }, t.stop());
  } catch (e) { return error('memory_05', '三段式关联', MODULE, e, t.stop()); }
}

async function checkMemoryFlow(): Promise<CheckResult> {
  const t = clock();
  try {
    const [mem, bd] = await Promise.all([
      queryCount("SELECT COUNT(*) as c FROM memories"),
      queryCount("SELECT COUNT(*) as c FROM black_diamond"),
    ]);
    return mem > 0 && bd > 0
      ? passed('memory_06', '记忆自动流转', MODULE, `金库${mem}条→黑钻${bd}条`, { mem, bd }, t.stop())
      : failed('memory_06', '记忆自动流转', MODULE, `mem=${mem}, bd=${bd}`, { mem, bd }, t.stop());
  } catch (e) { return error('memory_06', '记忆自动流转', MODULE, e, t.stop()); }
}

async function checkNoteSubsystem(): Promise<CheckResult> {
  const t = clock();
  try {
    const notes = await queryCount("SELECT COUNT(*) as c FROM memories WHERE memory_type='note'");
    return passed('memory_07', '记事记忆子系统', MODULE, `记事${notes}条`, { notes }, t.stop());
  } catch (e) { return error('memory_07', '记事记忆子系统', MODULE, e, t.stop()); }
}

async function checkItemLocation(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/memory?q=${encodeURIComponent('车钥匙')}`);
    const d = await r.json();
    const hit = Array.isArray(d.results) && d.results.length > 0;
    return hit
      ? passed('memory_08', '物品位置记忆', MODULE, `搜索"车钥匙"命中${d.results.length}条`, { hits: d.results.length }, t.stop())
      : failed('memory_08', '物品位置记忆', MODULE, `搜索"车钥匙"无结果`, { hits: 0 }, t.stop());
  } catch (e) { return error('memory_08', '物品位置记忆', MODULE, e, t.stop()); }
}

async function checkImportantFact(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/memory?q=${encodeURIComponent('张经理')}`);
    const d = await r.json();
    const hit = Array.isArray(d.results) && d.results.length > 0;
    return hit
      ? passed('memory_09', '重要事实记忆', MODULE, `搜索"张经理"命中${d.results.length}条`, { hits: d.results.length }, t.stop())
      : failed('memory_09', '重要事实记忆', MODULE, `搜索"张经理"无结果`, { hits: 0 }, t.stop());
  } catch (e) { return error('memory_09', '重要事实记忆', MODULE, e, t.stop()); }
}

async function checkTimedReminder(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/memory/reminders`);
    const d = await r.json();
    const reminders = Array.isArray(d.reminders) ? d.reminders : [];
    return passed('memory_10', '定时提醒', MODULE, `待触发${reminders.length}条`, { pending: reminders.length }, t.stop());
  } catch (e) { return error('memory_10', '定时提醒', MODULE, e, t.stop()); }
}

async function checkPersonImportance(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/family/self-check');
    const nodes = d?.fg?.personCount || 0;
    return nodes > 0
      ? passed('memory_11', '人物重要度', MODULE, `FG共${nodes}个节点`, { personCount: nodes }, t.stop())
      : failed('memory_11', '人物重要度', MODULE, `FG无节点`, { personCount: 0 }, t.stop());
  } catch (e) { return error('memory_11', '人物重要度', MODULE, e, t.stop()); }
}
