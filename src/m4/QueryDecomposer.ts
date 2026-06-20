/**
 * QueryDecomposer — 复杂查询分解
 *
 * 将"为什么我最近总是失眠"这样的复杂问题拆成多个子查询，
 * 分别检索后合并结果。
 *
 * 规则驱动（零 LLM），通过因果/转折/枚举关键词识别子意图。
 */
export interface DecomposedQuery {
  original: string;
  subQueries: string[];
  intent: 'causal' | 'comparison' | 'enumeration' | 'simple';
}

/** 因果连词 — 前后通常代表两个子意图 */
const CAUSAL_PATTERNS = [
  /为什么(.+?)(?:却|但|可是|不过|仍然|还是)(.+)/,
  /为什么(.+?)(?:因为|由于)(.+)/,
  /(.+?)导致(.+?)/,
  /(.+?)引起(.+?)/,
  /(.+?)造成(.+?)/,
  /(.+?)所以(.+?)/,
  /为什么(.+)/,
];

/** 并列/枚举分隔符 */
const ENUM_SEPARATORS = /[,，、和与及\s]+/;

/** 转折词 — 拆分点 */
const CONTRAST_WORDS = ['但', '但是', '可是', '然而', '不过', '却'];

/**
 * 拆解用户查询为子查询列表
 */
export function decompose(query: string): DecomposedQuery {
  const trimmed = query.trim();
  if (!trimmed) return { original: query, subQueries: [], intent: 'simple' };

  // 尝试因果模式
  for (const pattern of CAUSAL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;

    // 提取子句
    const parts = match.slice(1).filter(Boolean).map(s => s.trim());
    if (parts.length >= 2) {
      return {
        original: trimmed,
        subQueries: [...new Set(parts)],
        intent: 'causal',
      };
    }
    if (parts.length === 1) {
      return {
        original: trimmed,
        subQueries: [trimmed, parts[0]],
        intent: 'causal',
      };
    }
  }

  // 转折词拆分
  for (const cw of CONTRAST_WORDS) {
    const idx = trimmed.indexOf(cw);
    if (idx > 0) {
      const before = trimmed.substring(0, idx).trim();
      const after = trimmed.substring(idx + cw.length).trim();
      if (before.length > 2 && after.length > 2) {
        return {
          original: trimmed,
          subQueries: [before, after],
          intent: 'comparison',
        };
      }
    }
  }

  // 枚举拆分（逗号分隔的多意图）
  // 枚举拆分（逗号分隔、和与及连接的多意图）
  if (/[和与及而且]/.test(trimmed) && trimmed.length > 6) {
    // 检测 X和Y, X与Y, X及Y 模式（问句中拆分）
    const enumMatch = trimmed.match(/^(.{2,10})[和与及](.{2,40})$/) || trimmed.match(/^(.{2,15})而且(.{2,40})$/) || trimmed.match(/^(.{2,15})而且(.{2,40})$/);
    if (enumMatch) {
      const parts = [enumMatch[1].trim(), enumMatch[2].trim()].filter(Boolean);
      if (parts.length >= 2) {
        return {
          original: trimmed,
          subQueries: parts,
          intent: 'enumeration',
        };
      }
    }
  }

  if (trimmed.includes('、') || trimmed.includes('，') || trimmed.includes(',')) {
    const parts = trimmed.split(ENUM_SEPARATORS).filter(s => s.length >= 2);
    if (parts.length >= 2) {
      return {
        original: trimmed,
        subQueries: parts,
        intent: 'enumeration',
      };
    }
  }

  return { original: trimmed, subQueries: [trimmed], intent: 'simple' };
}

/**
 * 将子查询结果合并去重
 */
export function mergeDecomposedResults<T extends { record: { id: string } }>(
  resultsPerQuery: T[][],
  topN: number,
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];

  // 交替合并（保持多样性）
  let maxLen = Math.max(...resultsPerQuery.map(r => r.length));
  for (let i = 0; i < maxLen && merged.length < topN; i++) {
    for (const results of resultsPerQuery) {
      if (i < results.length && !seen.has(results[i].record.id)) {
        seen.add(results[i].record.id);
        merged.push(results[i]);
        if (merged.length >= topN) break;
      }
    }
  }

  return merged;
}
