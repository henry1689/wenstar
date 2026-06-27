/**
 * VaultManager — 三库管理器 · 景幻仙姑
 *
 * 管理三个记忆库的全生命周期：
 *   砂金库 (Alluvial)  — 原始对话历史，可压缩
 *   金库   (Gold)      — 24D情感记忆，日常检索
 *   黑钻库 (BlackDiamond) — 精选歌单，永恒珍藏
 *
 * 景幻仙姑的职责：
 *   - 巡检三库健康状态
 *   - 从金库→黑钻库提炼
 *   - 响应管理员指令
 *   - 生成健康报告
 */
import type { FusionStorageAdapter } from '../../m2/FusionStorageAdapter.js';
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';
import type { ConversationTurn } from '../../m5/types/index.js';

// ─── 类型定义 ───

export interface AlluvialEntry {
  /** 对话轮次文本摘要 */
  content: string;
  role: 'user' | 'assistant';
  timestamp?: string;
}

export interface GoldEntry {
  id: string;
  summary: string;
  calcium_level: number;
  effective_strength: number;
  recall_count: number;
  emotion_tag?: string;
  created_at: string;
}

export interface BlackDiamondEntry {
  id: string;
  summary: string;
  emotion_tag: string | null;
  source_id: string | null;
  calcium_level: number;
  recall_count: number;
  tags: string[];
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface VaultReport {
  timestamp: string;
  alluvial: { total: number; oldestAgeHours: number; compressible: boolean; compressedAt: string | null };
  gold: { total: number; avgStrength: number; highCalciumCount: number; topTags: string[] };
  blackDiamond: { total: number; recentEntries: string[] };
  overall: string;
  trends?: {
    gold_growth_7d: number;
    promote_count_7d: number;
    avg_strength_change: number;
    health_score: number;
    health_status: string;
    narrative: string;
  };
  alerts?: string[];
}

// ─── 操作日志 ───

/** 记录三库操作（景幻仙姑审计日志） */
export function logVaultOperation(
  sqlite: SQLiteAdapter,
  operation: string,
  sourceType?: string,
  sourceId?: string,
  targetId?: string,
  detail?: string,
): void {
  const id = 'vl_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
  sqlite.writeRaw(
    'INSERT INTO vault_log (id, operation, source_type, source_id, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, operation, sourceType || null, sourceId || null, targetId || null, detail || null, new Date().toISOString(),
  );
}

/** 获取操作日志 */
export function getVaultLog(sqlite: SQLiteAdapter, limit = 20): any[] {
  return sqlite.queryAll('SELECT * FROM vault_log ORDER BY created_at DESC LIMIT ?', [limit]);
}

// ─── 黑钻库数据访问 ───

/** 列出黑钻库所有条目 */
export function listBlackDiamonds(sqlite: SQLiteAdapter, limit = 20, offset = 0): BlackDiamondEntry[] {
  const rows = sqlite.queryAll(
    'SELECT * FROM black_diamond ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
  return rows.map(rowToBlackDiamond);
}

/** 按ID查黑钻条目 */
export function getBlackDiamond(sqlite: SQLiteAdapter, id: string): BlackDiamondEntry | null {
  const rows = sqlite.queryAll('SELECT * FROM black_diamond WHERE id = ? LIMIT 1', [id]);
  return rows.length > 0 ? rowToBlackDiamond(rows[0]) : null;
}

/** 新增黑钻条目 */
export function addBlackDiamond(
  sqlite: SQLiteAdapter,
  params: {
    summary: string;
    emotion_tag?: string;
    source_id?: string;
    calcium_level?: number;
    tags?: string[];
    notes?: string;
    emotion_vector?: string;
  },
): BlackDiamondEntry {
  const id = `bd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const tags = params.tags || [];
  // 黑钻上限 200 条：超出时淘汰钙化分最低的
  try {
    const total = (sqlite.queryAll('SELECT COUNT(*) as cnt FROM black_diamond') as any[])?.[0]?.cnt || 0;
    if (total >= 200) {
      const lowest = sqlite.queryAll('SELECT id, calcium_level FROM black_diamond ORDER BY CAST(calcium_level AS REAL) ASC, created_at ASC LIMIT 1') as any[];
      if (lowest.length > 0) {
        const demotedId = lowest[0].id;
        sqlite.writeRaw('UPDATE memories SET promoted_to_diamond = 0 WHERE id = (SELECT source_id FROM black_diamond WHERE id = ?)', [demotedId]);
        sqlite.writeRaw('DELETE FROM black_diamond WHERE id = ?', [demotedId]);
        console.log('[Vault] 黑钻超出上限(200)，降级: ' + demotedId);
      }
    }
  } catch (_) { /* 上限检测不阻塞晋升 */ }
  // P3: mark as promoted in memories table
  sqlite.writeRaw(`UPDATE memories SET promoted_to_diamond = 1 WHERE id = ?`, [params.source_id]);
  sqlite.writeRaw(
    `INSERT INTO black_diamond (id, summary, emotion_tag, source_id, calcium_level, recall_count, tags, notes, created_at, updated_at, emotion_vector)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id,
    params.summary,
    params.emotion_tag || null,
    params.source_id || null,
    params.calcium_level ?? 1,
    JSON.stringify(tags),
    params.notes || '',
    params.emotion_vector || null,
    now,
    now,
  );
  return getBlackDiamond(sqlite, id)!;
}

/** 更新黑钻条目 */
export function updateBlackDiamond(
  sqlite: SQLiteAdapter,
  id: string,
  params: { summary?: string; emotion_tag?: string; tags?: string[]; notes?: string },
): boolean {
  const existing = getBlackDiamond(sqlite, id);
  if (!existing) return false;
  const now = new Date().toISOString();
  sqlite.writeRaw(
    `UPDATE black_diamond SET summary=?, emotion_tag=?, tags=?, notes=?, updated_at=? WHERE id=?`,
    params.summary ?? existing.summary,
    params.emotion_tag ?? existing.emotion_tag,
    JSON.stringify(params.tags ?? existing.tags),
    params.notes ?? existing.notes,
    now,
    id,
  );
  return true;
}

/** 删除黑钻条目 */
export function deleteBlackDiamond(sqlite: SQLiteAdapter, id: string): boolean {
  const existing = getBlackDiamond(sqlite, id);
  if (!existing) return false;
  sqlite.writeRaw('DELETE FROM black_diamond WHERE id = ?', [id]);
  return true;
}

/** 搜索黑钻库 */
const KNOWN_EMOTION_TAGS = ["中性","平静","快乐","思念","委屈","焦虑","不安","恐惧","愤怒","沮丧","愧疚","无奈","麻木","怀念","空虚","爱意","满足","幸福","惊喜","感动","温馨","欲望","渴望","占有","依赖","期待","慵懒","倾诉","失落","矛盾","释然","警惕","共鸣","嫉妒","疏离","包容","温馨","感动","幸福","疲惫"];

export function searchBlackDiamonds(sqlite: SQLiteAdapter, keyword: string, limit = 10): BlackDiamondEntry[] {
  // P4: Fast path - exact emotion_tag match (uses idx_black_diamond_emotion index)
  const tagMatch = KNOWN_EMOTION_TAGS.find(t => keyword.includes(t));
  if (tagMatch) {
    const rows = sqlite.queryAll(
      `SELECT * FROM black_diamond WHERE emotion_tag = ? ORDER BY created_at DESC LIMIT ?`,
      [tagMatch, limit],
    );
    if (rows.length > 0) return rows.map(rowToBlackDiamond);
  }

  // Fallback: LIKE scan (existing behavior)
  const rows = sqlite.queryAll(
    `SELECT * FROM black_diamond WHERE summary LIKE ? OR emotion_tag LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT ?`,
    [`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, limit],
  );
  return rows.map(rowToBlackDiamond);
}

// ─── 金库（memories表）访问 ───

/** 金库概况 */
export function getGoldSummary(sqlite: SQLiteAdapter): { total: number; avgStrength: number; highCalcium: number } {
  const rows = sqlite.queryAll(
    `SELECT COUNT(*) as total, AVG(effective_strength) as avgStr, SUM(CASE WHEN calcium_level >= 2 THEN 1 ELSE 0 END) as highCal
     FROM memories`,
  );
  const r = rows[0] || { total: 0, avgStr: 0, highCal: 0 };
  return {
    total: Number(r.total) || 0,
    avgStrength: Number(r.avgStr) || 0,
    highCalcium: Number(r.highCal) || 0,
  };
}

/** 金库最近条目 */
export function listGoldRecent(sqlite: SQLiteAdapter, limit = 10): GoldEntry[] {
  const rows = sqlite.queryAll(
    `SELECT id, raw_input, calcium_level, effective_strength, recall_count, created_at, scar_type
     FROM memories ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r: any) => ({
    id: r.id as string,
    summary: (r.raw_input as string).substring(0, 80),
    calcium_level: r.calcium_level as number,
    effective_strength: r.effective_strength as number,
    recall_count: r.recall_count as number,
    emotion_tag: (r.scar_type as string) || undefined,
    created_at: r.created_at as string,
  }));
}

// ─── 砂金库（对话历史）访问 ───

/** 砂金库概况 */
export function getAlluvialSummary(
  conversationHistory: ConversationTurn[],
  maxSize: number,
): { total: number; oldestAgeHours: number; compressible: boolean } {
  let oldestAge = 0;
  for (const t of conversationHistory) {
    if (t.timestamp) {
      const age = (Date.now() - new Date(t.timestamp).getTime()) / 3600000;
      if (age > oldestAge) oldestAge = age;
    }
  }
  return {
    total: conversationHistory.length,
    oldestAgeHours: Math.round(oldestAge),
    compressible: conversationHistory.length > maxSize,
  };
}

// ─── 提炼（金库→黑钻库） ───

/**
 * 从金库提炼到黑钻库
 * 钙质≥2 + (recall≥3 或 钙质==3 或 landmark) → 提炼
 */
export function promoteToBlackDiamond(sqlite: SQLiteAdapter, memoryId: string): BlackDiamondEntry | null {
  // 去重：检查是否已存在
  const existing = sqlite.queryAll(
    `SELECT id FROM black_diamond WHERE source_id = ? LIMIT 1`,
    [memoryId],
  );
  if (existing.length > 0) {
    console.log(`[Vault] 跳过重复提炼: ${memoryId}`);
    return null;
  }

  const rows = sqlite.queryAll(
    `SELECT id, raw_input, calcium_level, recall_count, is_landmark, scar_type, narrative_tag, perception_json
     FROM memories WHERE id = ? LIMIT 1`,
    [memoryId],
  );
  if (rows.length === 0) return null;
  const mem = rows[0] as any;
  const rawInput = (mem.raw_input as string) || '';
  const emotionTag = (mem.scar_type as string) || (mem.narrative_tag as string) || '中性';
  // P1: 提炼日志
  logVaultOperation(sqlite, 'promote', 'gold', memoryId, undefined, `提炼至黑钻: ${rawInput.substring(0, 30)}`);
  const tags = ['gold_提炼', emotionTag];
  if (mem.is_landmark === 1) tags.push('地标');
  const emotionVec = (mem as any).perception_json || null;

  return addBlackDiamond(sqlite, {
    summary: rawInput.length > 200 ? rawInput.substring(0, 200) + '…' : rawInput,
    emotion_tag: emotionTag,
    source_id: memoryId,
    calcium_level: mem.calcium_level as number,
    tags,
    notes: `自动提炼于 ${new Date().toISOString()}`,
    emotion_vector: emotionVec,
  });
}

/** 批量自动提炼：扫描金库中符合条件但尚未提炼的记忆 */
export function autoPromoteCandidates(sqlite: SQLiteAdapter, limit = 5): BlackDiamondEntry[] {
  // 获取已提炼的 source_id（去重）
  const alreadyPromoted = new Set(
    (sqlite.queryAll('SELECT source_id FROM black_diamond WHERE source_id IS NOT NULL') as any[])
      .map((r: any) => r.source_id as string)
      .filter(Boolean),
  );

  const candidates = sqlite.queryAll(
    `SELECT id, raw_input, calcium_level, recall_count, is_landmark, scar_type, narrative_tag
     FROM memories
     WHERE (calcium_level >= 2 AND (recall_count >= 1 OR is_landmark = 1)) OR (calcium_level >= 3)
     ORDER BY calcium_level DESC, recall_count DESC
     LIMIT ?`,
    [limit],
  ) as any[];

  const results: BlackDiamondEntry[] = [];
  for (const mem of candidates) {
    if (alreadyPromoted.has(mem.id as string)) continue;
    const entry = promoteToBlackDiamond(sqlite, mem.id as string);
    if (entry) results.push(entry);
  }
  return results;
}

/**
 * S2-2: 金库→黑钻晋升（新规格）
 * 条件: calcium_score >= 4.5 或 recall_count >= 5
 */
export function autoPromoteCandidatesV2(sqlite: SQLiteAdapter, limit = 5): BlackDiamondEntry[] {
  const alreadyPromoted = new Set(
    (sqlite.queryAll('SELECT source_id FROM black_diamond WHERE source_id IS NOT NULL') as any[])
      .map((r: any) => r.source_id as string)
      .filter(Boolean),
  );

  const candidates = sqlite.queryAll(
    `SELECT id, raw_input, calcium_score, recall_count, narrative_tag, dna_root_id
     FROM memories
     WHERE (calcium_score >= 4.5 OR recall_count >= 5) AND is_promoted = 0
     ORDER BY calcium_score DESC, recall_count DESC
     LIMIT ?`,
    [limit],
  ) as any[];

  const results: BlackDiamondEntry[] = [];
  for (const mem of candidates) {
    if (alreadyPromoted.has(mem.id as string)) continue;
    const entry = promoteToBlackDiamond(sqlite, mem.id as string);
    if (entry) {
      sqlite.writeRaw('UPDATE memories SET is_promoted = 1 WHERE id = ?', [mem.id]);
      results.push(entry);
    }
  }
  return results;
}

/**
 * S2-2: 召回钙化分增长（每次 +0.2，上限 10）
 */
export function applyRecallIncrement(sqlite: SQLiteAdapter, memoryId: string): void {
  sqlite.writeRaw(
    `UPDATE memories SET calcium_score = ROUND(MIN(10, COALESCE(calcium_score, 0) + 0.2), 1),
     recall_count = COALESCE(recall_count, 0) + 1,
     last_recalled_at = datetime('now','localtime')
     WHERE id = ?`,
    [memoryId]
  );
}

// ─── P2: 批量操作 + 导出 ───

/** 批量删除黑钻（核心安全防护：core_safety > 0.7 需二次确认） */
export function batchDeleteDiamonds(sqlite: SQLiteAdapter, ids: string[]): { deleted: number; protected_: string[] } {
  const protected_: string[] = [];
  let deleted = 0;
  for (const id of ids) {
    // 核心记忆防护
    const mem = sqlite.queryAll('SELECT raw_input, calcium_score FROM memories WHERE id = (SELECT source_id FROM black_diamond WHERE id = ? LIMIT 1)', [id]);
    const isCore = mem.length > 0 && /结婚|救命|重要|第一[次个]|生日|纪念/.test((mem[0] as any)?.raw_input || '') && (mem[0] as any)?.calcium_score > 0.7;
    if (isCore) { protected_.push(id); continue; }
    const ok = deleteBlackDiamond(sqlite, id);
    if (ok) deleted++;
  }
  logVaultOperation(sqlite, 'batch_delete', 'black_diamond', undefined, undefined, `批量删除 ${deleted} 条, ${protected_.length} 条受保护`);
  return { deleted, protected_ };
}

/** 导出黑钻库 */
export function exportDiamonds(sqlite: SQLiteAdapter, format: 'json' | 'csv' = 'json'): string {
  const items = listBlackDiamonds(sqlite, 1000);
  if (format === 'csv') {
    const header = 'id,summary,emotion_tag,calcium_level,recall_count,created_at\n';
    const rows = items.map(function(i) {
      return [i.id, '"' + (i.summary || '').replace(/"/g, '""') + '"', i.emotion_tag || '', i.calcium_level, i.recall_count, i.created_at].join(',');
    }).join('\n');
    return header + rows;
  }
  return JSON.stringify(items, null, 2);
}

// ─── P3: 砂金库操作 ───

/** 压缩砂金库（标记旧数据可清理） */
export function compactAlluvial(sqlite: SQLiteAdapter, cutoffDays = 30): number {
  const cutoff = new Date(Date.now() - cutoffDays * 86400000).toISOString();
  const old = sqlite.queryAll('SELECT COUNT(*) as cnt FROM conversations WHERE timestamp < ? AND is_summary = 0', [cutoff]);
  const count = Number((old[0] as any)?.cnt || 0);
  if (count > 0) {
    sqlite.writeRaw('UPDATE conversations SET is_summary = 1 WHERE timestamp < ? AND is_summary = 0', [cutoff]);
    logVaultOperation(sqlite, 'compact', 'alluvial', undefined, undefined, `压缩 ${count} 条超过 ${cutoffDays} 天的砂金库对话`);
  }
  return count;
}

// ─── 景幻仙姑 · 三库健康报告 ───

/**
 * 生成三库健康报告（人类可读）
 */
export function generateVaultReport(
  sqlite: SQLiteAdapter,
  conversationHistory: ConversationTurn[],
  compressionThreshold: number,
  lastCompaction: string | null,
): VaultReport {
  const goldSummary = getGoldSummary(sqlite);
  const alluvialSummary = getAlluvialSummary(conversationHistory, compressionThreshold);
  const diamonds = listBlackDiamonds(sqlite, 5);

  // P4: 趋势数据
  const gold7d = sqlite.queryAll("SELECT COUNT(*) as cnt FROM memories WHERE created_at > datetime('now', '-7 days')");
  const promote7d = sqlite.queryAll("SELECT COUNT(*) as cnt FROM vault_log WHERE operation = 'promote' AND created_at > datetime('now', '-7 days')");
  const avgStr7d = sqlite.queryAll("SELECT AVG(effective_strength) as avg FROM memories WHERE created_at > datetime('now', '-7 days')");
  const goldGrowth7d = Number((gold7d[0] as any)?.cnt || 0);
  const promoteCount7d = Number((promote7d[0] as any)?.cnt || 0);
  const avgStrengthChange = Number((avgStr7d[0] as any)?.avg || 0);

  const healthScore = goldSummary.total > 0 ? Math.min(1, goldSummary.avgStrength * goldSummary.total / 10) : 0;
  const healthStatus = healthScore > 0.6 ? '繁茂' : healthScore > 0.3 ? '稳定' : '休耕期';

  // 预警 + 记忆韧性提示
  const alerts: string[] = [];
  if (goldSummary.total === 0) alerts.push('金库为空');
  if (goldSummary.avgStrength < 0.2) alerts.push('当前金库强度偏低，但人类记忆本就有模糊性——正如老照片会褪色，珍贵的褶皱反而更真实');
  if (goldGrowth7d === 0 && promoteCount7d === 0 && goldSummary.total > 0) alerts.push('7天无新记忆, 记忆森林进入休耕期');

  const overallStatus =
    goldSummary.total > 0 && goldSummary.avgStrength > 0.1
      ? '健康'
      : goldSummary.total === 0
        ? '金库空（新系统）'
        : '注意（金库强度偏低）';

  const narrativeMemories = sqlite.queryAll("SELECT raw_input FROM memories WHERE calcium_score > 0.6 ORDER BY created_at DESC LIMIT 3");
  const narrative = `记忆森林正在自然演替：新芽（7日新增金库）：${goldGrowth7d} 条 | 老树（保留黑钻）：${promoteCount7d} 颗 | 当前生态健康度：${healthStatus}`;

  return {
    timestamp: new Date().toISOString(),
    trends: { gold_growth_7d: goldGrowth7d, promote_count_7d: promoteCount7d, avg_strength_change: Math.round(avgStrengthChange * 100) / 100, health_score: Math.round(healthScore * 100) / 100, health_status: healthStatus, narrative },
    alerts,
    alluvial: {
      total: alluvialSummary.total,
      oldestAgeHours: alluvialSummary.oldestAgeHours,
      compressible: alluvialSummary.compressible,
      compressedAt: lastCompaction,
    },
    gold: {
      total: goldSummary.total,
      avgStrength: Math.round(goldSummary.avgStrength * 100) / 100,
      highCalciumCount: goldSummary.highCalcium,
      topTags: [],
    },
    blackDiamond: {
      total: diamonds.length,
      recentEntries: diamonds.slice(0, 5).map((d) => d.summary.substring(0, 40)),
    },
    overall: overallStatus,
  };
}

// ─── 辅助 ───

function rowToBlackDiamond(row: any): BlackDiamondEntry {
  return {
    id: row.id as string,
    summary: row.summary as string,
    emotion_tag: row.emotion_tag as string | null,
    source_id: row.source_id as string | null,
    calcium_level: row.calcium_level as number,
    recall_count: row.recall_count as number,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags as string[] || []),
    notes: row.notes as string || '',
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}
