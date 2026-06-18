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
  },
): BlackDiamondEntry {
  const id = `bd_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
  const now = new Date().toISOString();
  const tags = params.tags || [];
  sqlite.writeRaw(
    `INSERT INTO black_diamond (id, summary, emotion_tag, source_id, calcium_level, recall_count, tags, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id,
    params.summary,
    params.emotion_tag || null,
    params.source_id || null,
    params.calcium_level ?? 1,
    JSON.stringify(tags),
    params.notes || '',
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
export function searchBlackDiamonds(sqlite: SQLiteAdapter, keyword: string, limit = 10): BlackDiamondEntry[] {
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
    `SELECT id, raw_input, calcium_level, recall_count, is_landmark, scar_type, narrative_tag
     FROM memories WHERE id = ? LIMIT 1`,
    [memoryId],
  );
  if (rows.length === 0) return null;
  const mem = rows[0] as any;
  const rawInput = (mem.raw_input as string) || '';
  const emotionTag = (mem.scar_type as string) || (mem.narrative_tag as string) || '中性';
  const tags = ['gold_提炼', emotionTag];
  if (mem.is_landmark === 1) tags.push('地标');

  return addBlackDiamond(sqlite, {
    summary: rawInput.length > 200 ? rawInput.substring(0, 200) + '…' : rawInput,
    emotion_tag: emotionTag,
    source_id: memoryId,
    calcium_level: mem.calcium_level as number,
    tags,
    notes: `自动提炼于 ${new Date().toISOString()}`,
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
     WHERE calcium_level >= 2 AND (recall_count >= 3 OR calcium_level >= 3 OR is_landmark = 1)
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

  const overallStatus =
    goldSummary.total > 0 && goldSummary.avgStrength > 0.1
      ? '健康'
      : goldSummary.total === 0
        ? '金库空（新系统）'
        : '注意（金库强度偏低）';

  return {
    timestamp: new Date().toISOString(),
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
