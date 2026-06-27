/** 运维与安全性审计（15项） */
import type { CheckResult } from '../types.js';
import { passed, failed, error, clock, apiGet } from '../helpers.js';
import { queryCount } from '../db.js';


const MODULE = 'ops' as const;

export async function checkOpsAll(): Promise<CheckResult[]> {
  return Promise.all([
    checkBackend(),
    checkMemoryUsage(),
    checkHealthAPI(),
    checkBackup(),
    checkConversationHistory(),
    checkFGNodeCount(),
    checkBlackDiamondCap(),
    checkNoteExpiry(),
    checkKnowledgeHealth(),
    checkTTSService(),
    checkIsTestData(),
    checkCompaction(),
    checkThreeLayerLink(),
    checkFrontendService(),
    checkEnvConfig(),
  ]);
}

// 32. 后端服务
async function checkBackend(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/status');
    return d.status === 'running'
      ? passed('ops_32', '后端服务', MODULE, `运行中: ${d.version}`, { status: d.status }, t.stop())
      : failed('ops_32', '后端服务', MODULE, `后端状态异常: ${d.status}`, { status: d.status }, t.stop());
  } catch (e) { return error('ops_32', '后端服务', MODULE, e, t.stop()); }
}

// 33. 内存使用
async function checkMemoryUsage(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/health');
    const mem = d.memory?.heapUsedMB || 0;
    return mem < 1024
      ? passed('ops_33', '内存使用', MODULE, `heapUsed ${mem}MB (阈值1024MB)`, { heapUsedMB: mem }, t.stop())
      : failed('ops_33', '内存使用', MODULE, `内存使用 ${mem}MB 超过阈值`, { heapUsedMB: mem }, t.stop());
  } catch (e) { return error('ops_33', '内存使用', MODULE, e, t.stop()); }
}

// 34. 健康巡检
async function checkHealthAPI(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/health');
    return d.status
      ? passed('ops_34', '健康巡检API', MODULE, `健康状态: ${d.status}`, { status: d.status }, t.stop())
      : failed('ops_34', '健康巡检API', MODULE, `健康检查无状态`, {}, t.stop());
  } catch (e) { return error('ops_34', '健康巡检API', MODULE, e, t.stop()); }
}

// 35. 备份
async function checkBackup(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/family/self-check');
    const backup = d?.backup;
    if (backup && backup.backupCount > 0) {
      return passed('ops_35', '统一备份', MODULE, `备份${backup.backupCount}个, 成功率${backup.backupSuccessRate}`, backup, t.stop());
    }
    return failed('ops_35', '统一备份', MODULE, `备份状态不可用`, { backup }, t.stop());
  } catch (e) { return error('ops_35', '统一备份', MODULE, e, t.stop()); }
}

// 36. 对话历史API
async function checkConversationHistory(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:3000/api/conversation`);
    const d = await r.json();
    const turns = Array.isArray(d.turns) ? d.turns : [];
    return turns.length > 0
      ? passed('ops_36', '对话历史API', MODULE, `返回${turns.length}条`, { turns: turns.length }, t.stop())
      : failed('ops_36', '对话历史API', MODULE, `对话历史为空`, {}, t.stop());
  } catch (e) { return error('ops_36', '对话历史API', MODULE, e, t.stop()); }
}

// 37. FG节点数
async function checkFGNodeCount(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/family/self-check');
    const nodes = d?.fg?.personCount || 0;
    return passed('ops_37', 'FG节点数', MODULE, `${nodes}个节点`, { nodes }, t.stop());
  } catch (e) { return error('ops_37', 'FG节点数', MODULE, e, t.stop()); }
}

// 38. 黑钻上限
async function checkBlackDiamondCap(): Promise<CheckResult> {
  const t = clock();
  try {
    const cnt = await queryCount("SELECT COUNT(*) as c FROM black_diamond");
    return cnt <= 200
      ? passed('ops_38', '黑钻上限', MODULE, `${cnt}条(上限200条)`, { count: cnt }, t.stop())
      : failed('ops_38', '黑钻上限', MODULE, `黑钻${cnt}条超出200上限`, { count: cnt }, t.stop());
  } catch (e) { return error('ops_38', '黑钻上限', MODULE, e, t.stop()); }
}

// 39. 记事记忆过期
async function checkNoteExpiry(): Promise<CheckResult> {
  const t = clock();
  try {
    const expired = await queryCount("SELECT COUNT(*) as c FROM memories WHERE memory_type='note' AND is_valid=0");
    return passed('ops_39', '记事记忆过期', MODULE, `失效标记${expired}条`, { expired }, t.stop());
  } catch (e) { return error('ops_39', '记事记忆过期', MODULE, e, t.stop()); }
}

// 40. 知识库健康
async function checkKnowledgeHealth(): Promise<CheckResult> {
  const t = clock();
  try {
    const d = await apiGet('/api/knowledge/health');
    return d.totalItems > 0
      ? passed('ops_40', '知识库健康', MODULE, `${d.totalItems}条目, ${d.embeddingRatio}%嵌入`, { items: d.totalItems, pct: d.embeddingRatio }, t.stop())
      : failed('ops_40', '知识库健康', MODULE, `知识库为空`, {}, t.stop());
  } catch (e) { return error('ops_40', '知识库健康', MODULE, e, t.stop()); }
}

// 41. TTS服务
async function checkTTSService(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:8765/health`);
    const d = await r.json();
    return d.status === 'ok'
      ? passed('ops_41', 'TTS服务', MODULE, `端口8765正常`, {}, t.stop())
      : failed('ops_41', 'TTS服务', MODULE, `TTS状态异常`, {}, t.stop());
  } catch (e) { return error('ops_41', 'TTS服务', MODULE, e, t.stop()); }
}

// 42. 测试数据隔离
async function checkIsTestData(): Promise<CheckResult> {
  const t = clock();
  try {
    const testConv = await queryCount("SELECT COUNT(*) as c FROM conversations WHERE is_test=1");
    return passed('ops_42', '测试数据隔离', MODULE, `测试标记对话${testConv}条`, { testConv }, t.stop());
  } catch (e) { return error('ops_42', '测试数据隔离', MODULE, e, t.stop()); }
}

// 43. 压缩标记
async function checkCompaction(): Promise<CheckResult> {
  const t = clock();
  try {
    const compacted = await queryCount("SELECT COUNT(*) as c FROM conversations WHERE is_compacted=1");
    return passed('ops_43', '压缩标记', MODULE, `已压缩${compacted}条`, { compacted }, t.stop());
  } catch (e) { return error('ops_43', '压缩标记', MODULE, e, t.stop()); }
}

// 44. 三段关联
async function checkThreeLayerLink(): Promise<CheckResult> {
  const t = clock();
  try {
    const withDna = await queryCount("SELECT COUNT(*) as c FROM conversations WHERE dna_root_id IS NOT NULL");
    const total = await queryCount("SELECT COUNT(*) as c FROM conversations");
    const pct = total > 0 ? Math.round(withDna / total * 100) : 0;
    return passed('ops_44', '三段DNA关联', MODULE, `${withDna}/${total}(${pct}%)`, { withDna, total, pct }, t.stop());
  } catch (e) { return error('ops_44', '三段DNA关联', MODULE, e, t.stop()); }
}

// 45. 前端可达
async function checkFrontendService(): Promise<CheckResult> {
  const t = clock();
  try {
    const r = await fetch(`http://localhost:5174`);
    return r.ok
      ? passed('ops_45', '前端服务', MODULE, `端口5174响应${r.status}`, { status: r.status }, t.stop())
      : failed('ops_45', '前端服务', MODULE, `前端返回${r.status}`, {}, t.stop());
  } catch (e) { return error('ops_45', '前端服务', MODULE, e, t.stop()); }
}

// 46. 环境变量
async function checkEnvConfig(): Promise<CheckResult> {
  const t = clock();
  try {
    const hasKey = !!process.env.DEEPSEEK_API_KEY;
    return passed('ops_46', '环境变量', MODULE, hasKey ? 'DEEPSEEK_API_KEY已配置' : '未配置DEEPSEEK_API_KEY', { hasKey }, t.stop());
  } catch (e) { return error('ops_46', '环境变量', MODULE, e, t.stop()); }
}
