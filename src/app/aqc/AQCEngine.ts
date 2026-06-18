/**
 * AQCEngine — AQC 质检引擎（砂金质检员 + 金库质检员）
 *
 * 职责：独立于现有流程之外，只做标记和记录，不拦截、不修改、不阻塞。
 *   - SandQC（砂金质检员）: 每小时扫描最新对话，记录高质量对话
 *   - GoldQC（金库质检员）: 每小时扫描金库记忆，标记高质量记忆
 *
 * 设计铁律：
 *   ① 零改动现有代码路径
 *   ② 不修改任何现有数据
 *   ③ 所有结果写入独立的 aqc_records 表
 */
import type { ConversationTurn } from '../../m5/types/index.js';
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';
import { promoteToBlackDiamond } from '../vault/VaultManager.js';

// ═══════════════════════════════════════════════════════════════
// SandQC — 砂金质检员
// 扫描最新对话，标记高质量内容
// ═══════════════════════════════════════════════════════════════

export interface SandQCResult {
  scanned: number;
  approved: number;
  pending: number;
}

/**
 * 砂金质检员 — 每小时运行
 *
 * 审核标准（满足任一即可标记）：
 *   1. 消息长度 > 30 字（有实际内容）
 *   2. 含非自我实体（提到他人/地点/事件）
 *   3. 含强烈情感词
 */
export function runSandQC(
  sqlite: SQLiteAdapter,
  conversationHistory: ConversationTurn[],
  limit = 30,
): SandQCResult {
  const recentTurns = conversationHistory.slice(-limit);
  let scanned = 0;
  let approved = 0;
  let pending = 0;

  // 情感词表（轻度）
  const emotionWords = /难过|开心|伤心|生气|愤怒|感动|温暖|焦虑|紧张|担心|期待|失望|幸福|辛苦|累|烦|怕|爱|恨|想|念|喜欢|讨厌|后悔/;

  for (const turn of recentTurns) {
    if (turn.role !== 'user') continue;
    const text = turn.content || '';
    if (text.length < 4) continue;

    scanned++;
    const snippet = text.substring(0, 80);
    let score = 0;

    // 标准1：长度 > 10 字（有基本内容，门槛放低）
    if (text.length > 10) score += 0.3;
    // 标准2：含非自我实体
    if (/妈妈|爸爸|老婆|老公|朋友|同事|客户|公司|工作|项目|家/.test(text)) score += 0.3;
    // 标准3：含情感词
    if (emotionWords.test(text)) score += 0.3;
    // 标准4：含任何实体或人名（来自 extractRelations 的产物）
    if (text.length > 5 && /[一-龥]{2,3}说|和[一-龥]{2,3}|找[一-龥]{2,3}/.test(text)) score += 0.2;

    const status = score >= 0.2 ? 'approved' : 'pending';

    // 写入 aqc_records（去重：用内容前 40 字符做 ID，同内容只记录一次）
    const now = new Date().toISOString();
    const contentKey = snippet.replace(/[^一-龥a-zA-Z0-9]/g, '').substring(0, 40);
    const id = `aqc_sand_${contentKey}_${now.substring(0, 10)}`;

    try {
      sqlite.writeRaw(
        `INSERT OR IGNORE INTO aqc_records (id, source_type, source_id, content_snippet, calcium_level, entity_count, score, status, created_at, evaluated_at)
         VALUES (?, 'sand', ?, ?, 0, 0, ?, ?, ?, ?)`,
        id, contentKey, snippet, score, status, now, now,
      );
    } catch { /* 重复跳过 */ }

    if (status === 'approved') approved++;
    else pending++;
  }

  return { scanned, approved, pending };
}

// ═══════════════════════════════════════════════════════════════
// GoldQC — 金库质检员
// 扫描金库（M2 memories 表），标记高质量记忆
// ═══════════════════════════════════════════════════════════════

export interface GoldQCResult {
  scanned: number;
  approved: number;
  rejected: number;
}

/**
 * 金库质检员 — 每小时运行
 *
 * 审核标准：
 *   1. recall_count ≥ 3（被多次回忆）
 *   2. calcium_level ≥ 2（高钙质）
 *   3. is_landmark = 1（已被标记为地标）
 *   满足任一即 approved，都不满足则 rejected。
 */
export function runGoldQC(sqlite: SQLiteAdapter, limit = 50): GoldQCResult {
  let scanned = 0;
  let approved = 0;
  let rejected = 0;
  const now = new Date().toISOString();

  try {
    const rows = sqlite.queryAll(
      `SELECT id, raw_input, calcium_level, recall_count, is_landmark, effective_strength
       FROM memories ORDER BY created_at DESC LIMIT ?`,
      [limit],
    ) as any[];

    for (const row of rows) {
      scanned++;
      const calcium = row.calcium_level ?? 0;
      const recall = row.recall_count ?? 0;
      const landmark = row.is_landmark ?? 0;
      const strength = row.effective_strength ?? 0;

      let score = 0;
      if (recall >= 3) score += 0.4;
      if (calcium >= 2) score += 0.3;
      if (landmark === 1) score += 0.3;
      if (strength > 0.5) score += 0.2;

      const status = score >= 0.15 ? 'approved' : 'rejected';
      const snippet = (row.raw_input || '').substring(0, 80);

      const id = `aqc_gold_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;

      try {
        sqlite.writeRaw(
          `INSERT OR IGNORE INTO aqc_records (id, source_type, source_id, content_snippet, calcium_level, entity_count, recall_count, score, status, created_at, evaluated_at)
           VALUES (?, 'gold', ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          id, row.id, snippet, calcium, recall, score, status, now, now,
        );
      } catch { /* 跳过 */ }

      if (status === 'approved') {
        approved++;
        try {
          
          const r = promoteToBlackDiamond(sqlite, row.id); if (r) console.log("[GoldQC] 提升到黑钻:", row.id);
        } catch { /* 提升失败不影响质检 */ }
      } else rejected++;
    }
  } catch (err) {
    console.warn('[GoldQC] 扫描失败:', err);
  }

  return { scanned, approved, rejected };
}

// ═══════════════════════════════════════════════════════════════
// 质检报告
// ═══════════════════════════════════════════════════════════════

export interface AQCReport {
  sand: { pending: number; approved: number; lastRun: string | null };
  gold: { pending: number; approved: number; rejected: number; lastRun: string | null };
}

export function getAQCReport(sqlite: SQLiteAdapter): AQCReport {
  const getCount = (sourceType: string, status: string): number => {
    const rows = sqlite.queryAll(
      `SELECT COUNT(*) as cnt FROM aqc_records WHERE source_type = ? AND status = ?`,
      [sourceType, status],
    );
    return (rows[0] as any)?.cnt ?? 0;
  };

  const getLastRun = (sourceType: string): string | null => {
    const rows = sqlite.queryAll(
      `SELECT evaluated_at FROM aqc_records WHERE source_type = ? AND evaluated_at IS NOT NULL ORDER BY evaluated_at DESC LIMIT 1`,
      [sourceType],
    );
    return (rows[0] as any)?.evaluated_at ?? null;
  };

  return {
    sand: {
      pending: getCount('sand', 'pending'),
      approved: getCount('sand', 'approved'),
      lastRun: getLastRun('sand'),
    },
    gold: {
      pending: getCount('gold', 'pending'),
      approved: getCount('gold', 'approved'),
      rejected: getCount('gold', 'rejected'),
      lastRun: getLastRun('gold'),
    },
  };
}
