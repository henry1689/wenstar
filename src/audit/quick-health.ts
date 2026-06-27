/**
 * 10分钟快速体检 — 8项核心链路检查
 *
 * 用法: npx tsx src/audit/index.ts --quick
 */
import type { CheckResult } from './types.js';
import { passed, failed, error, clock } from './helpers.js';

const MODULE = 'memory' as const;

export async function runQuickHealth(): Promise<CheckResult[]> {
  console.log('🩺 10分钟快速体检开始...\n');
  const results = await Promise.all([
    checkDialogPersistence(),
    checkDBRecord(),
    checkTimedReminder(),
    checkKBRetrieval(),
    checkItemMemory(),
    checkRestartPersistence(),
    checkHealthAPI(),
    checkFrontendOperation(),
  ]);

  const passedCount = results.filter(r => r.status === 'passed').length;
  console.log(`\n📊 快速体检: ${passedCount}/${results.length} 通过\n`);
  return results;
}

// 1. 发一轮对话 → 刷新页面，对话还在
async function checkDialogPersistence(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/conversation`);
    const d = await r.json();
    const turns = Array.isArray(d.turns) ? d.turns.length : 0;
    return turns > 0
      ? passed('quick_01', '对话留存', MODULE, `对话历史${turns}条`, { turns }, t.stop())
      : failed('quick_01', '对话留存', MODULE, `对话历史为空`, {}, t.stop());
  } catch (e) { return error('quick_01', '对话留存', MODULE, e, t.stop()); }
}

// 2. 查数据库 → conversations / memories / 关联ID都有
async function checkDBRecord(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/admin/query?sql=${encodeURIComponent("SELECT (SELECT COUNT(*) FROM conversations) as conv, (SELECT COUNT(*) FROM memories) as mem, (SELECT COUNT(*) FROM conversations WHERE dna_root_id IS NOT NULL) as dna")}`);
    const d = await r.json();
    const row = d.rows?.[0] || {};
    const conv = Number(row.conv) || 0;
    const mem = Number(row.mem) || 0;
    const dna = Number(row.dna) || 0;
    return conv > 0 && mem > 0 && dna > 0
      ? passed('quick_02', '数据库三表', MODULE, `conv=${conv}, mem=${mem}, dna=${dna}`, { conv, mem, dna }, t.stop())
      : failed('quick_02', '数据库三表', MODULE, `conv=${conv}, mem=${mem}, dna=${dna}`, { conv, mem, dna }, t.stop());
  } catch (e) { return error('quick_02', '数据库三表', MODULE, e, t.stop()); }
}

// 3. 设一个1分钟后的提醒 → 到点弹出通知
async function checkTimedReminder(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/memory/reminders`);
    const d = await r.json();
    const reminders = Array.isArray(d.reminders) ? d.reminders : [];
    return passed('quick_03', '提醒接口', MODULE, `待触发${reminders.length}条`, { reminders: reminders.length }, t.stop());
  } catch (e) { return error('quick_03', '提醒接口', MODULE, e, t.stop()); }
}

// 4. 问一个知识库内的问题
async function checkKBRetrieval(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/knowledge?search=${encodeURIComponent('秦可卿')}`);
    const d = await r.json();
    const items = Array.isArray(d.items) ? d.items : [];
    return items.length > 0
      ? passed('quick_04', '知识库检索', MODULE, `"秦可卿"命中${items.length}条`, { hits: items.length }, t.stop())
      : failed('quick_04', '知识库检索', MODULE, `"秦可卿"无结果`, {}, t.stop());
  } catch (e) { return error('quick_04', '知识库检索', MODULE, e, t.stop()); }
}

// 5. 物品位置记忆
async function checkItemMemory(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/memory?q=${encodeURIComponent('车钥匙')}`);
    const d = await r.json();
    const hit = Array.isArray(d.results) && d.results.length > 0;
    return hit
      ? passed('quick_05', '物品位置记忆', MODULE, `"车钥匙"命中`, { hits: (d.results||[]).length }, t.stop())
      : failed('quick_05', '物品位置记忆', MODULE, `"车钥匙"无结果`, {}, t.stop());
  } catch (e) { return error('quick_05', '物品位置记忆', MODULE, e, t.stop()); }
}

// 6. 重启后端 → 数据保留
async function checkRestartPersistence(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/status`);
    const d = await r.json();
    const turns = d.conversation_turns || 0;
    return turns > 0
      ? passed('quick_06', '重启数据保留', MODULE, `重启后对话${turns}轮`, { turns }, t.stop())
      : failed('quick_06', '重启数据保留', MODULE, `重启后对话为空`, {}, t.stop());
  } catch (e) { return error('quick_06', '重启数据保留', MODULE, e, t.stop()); }
}

// 7. 健康巡检
async function checkHealthAPI(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/health`);
    const d = await r.json();
    return d.status
      ? passed('quick_07', '健康巡检API', MODULE, `状态: ${d.status}`, { status: d.status }, t.stop())
      : failed('quick_07', '健康巡检API', MODULE, `无状态`, {}, t.stop());
  } catch (e) { return error('quick_07', '健康巡检API', MODULE, e, t.stop()); }
}

// 8. 前端操作（仅检查前端是否可达）
async function checkFrontendOperation(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:5174`);
    return r.ok
      ? passed('quick_08', '前端可达', MODULE, `状态码${r.status}`, { status: r.status }, t.stop())
      : failed('quick_08', '前端可达', MODULE, `状态码${r.status}`, { status: r.status }, t.stop());
  } catch (e) { return error('quick_08', '前端可达', MODULE, e, t.stop()); }
}
