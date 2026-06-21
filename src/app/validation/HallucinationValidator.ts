/**
 * HallucinationValidator — P0-3 规则化幻觉校验器
 *
 * 在 LLM 回复生成后、返回前执行：
 *   1. 正则提取回复中提及的人物名
 *   2. 对照 FamilyGraph 已知人员名单
 *   3. 不在名单中的 → 写入 hallucination_log 表
 *
 * 零 LLM 调用，零延迟增加，纯正则 + 图谱查询。
 * 不拦截任何正常回复（只打日志不替换内容）。
 * 日志供 P3-b MemorySelfReview 自省模块分析。
 */

/** 一条校验结果 */
export interface ValidationResult {
  /** 是否有疑似编造 */
  hasViolation: boolean;
  /** 疑似编造的人名列表 */
  hallucinatedNames: string[];
  /** 严重程度 */
  severity: 'none' | 'low' | 'medium' | 'high';
}

/**
 * 从文本中提取中文人名（2-4 个中文字符）
 * 优先匹配「X」格式，再匹配普通提及
 */
function extractPersonNames(text: string): string[] {
  const names = new Set<string>();
  // 匹配「X」引号格式（最可靠）
  const quotedMatches = text.matchAll(/[「「""]([一-龥]{2,4})[」」""]/g);
  for (const m of quotedMatches) {
    names.add(m[1]);
  }
  // 匹配 "我没听你提过" 前面的名字（LLM 常用话术）
  const unheardMatches = text.matchAll(/([一-龥]{2,4})[，,]\s*这个我没听你提过/g);
  for (const m of unheardMatches) {
    if (m[1].length >= 2 && m[1].length <= 4) names.add(m[1]);
  }
  // 匹配 "你说的是X吗" "你提X干嘛" "我记得X" 等句式中的人名
  const mentionPatterns = [/你说的是([一-龥]{2,4})[吗嘛]/, /你提([一-龥]{2,4})[干干嘛]/, /我记得([一-龥]{2,4})[，,。.？！!]/, /你说([一-龥]{2,4})[呀吗]/];
  for (const pattern of mentionPatterns) {
    const matches = text.matchAll(pattern);
    for (const m of matches) {
      if (m[1].length >= 2 && m[1].length <= 4) names.add(m[1]);
    }
  }
  return Array.from(names);
}

/**
 * 检查回复中是否有疑似编造的人名
 * @param reply LLM 生成的回复文本
 * @param knownNames FamilyGraph 已知人员名单
 * @returns 校验结果
 */
export function validateReply(reply: string, knownNames: string[], userMessage?: string): ValidationResult {
  if (!reply) return { hasViolation: false, hallucinatedNames: [], severity: 'none' };

  const mentionedNames = extractPersonNames(reply);
  if (mentionedNames.length === 0) {
    return { hasViolation: false, hallucinatedNames: [], severity: 'none' };
  }

  // 不校验的标准称谓（不是具体人名）
  const SKIP_WORDS = new Set(['妈妈', '爸爸', '老公', '老婆', '儿子', '女儿', '爷爷', '奶奶', '外公', '外婆', '哥哥', '姐姐', '弟弟', '妹妹']);

  // 排除用户自己在当前消息中提到的名字（用户第一次提的新名字不应算幻觉）
  const userMessageNames = userMessage ? extractPersonNames(userMessage) : [];

  const unknownNames = mentionedNames.filter(
    n => !knownNames.includes(n) && !SKIP_WORDS.has(n) && n !== '鸿艺' && n !== '玉瑶' && !userMessageNames.includes(n)
  );

  if (unknownNames.length === 0) {
    return { hasViolation: false, hallucinatedNames: [], severity: 'none' };
  }

  // 判断严重程度
  const severity: 'low' | 'medium' | 'high' =
    unknownNames.length >= 3 ? 'high'
    : unknownNames.length >= 2 ? 'medium'
    : 'low';

  return {
    hasViolation: true,
    hallucinatedNames: unknownNames,
    severity,
  };
}

/**
 * 写入幻觉日志
 */
export function writeHallucinationLog(
  sqlite: any,
  reply: string,
  result: ValidationResult,
  knownNames: string[],
): void {
  if (!result.hasViolation) return;
  try {
    sqlite.writeRaw(
      `INSERT INTO hallucination_log (reply_hash, reply_preview, hallucinated_names, known_names, severity, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        simpleHash(reply),
        reply.substring(0, 100),
        result.hallucinatedNames.join(','),
        knownNames.join(',').substring(0, 200),
        result.severity,
        new Date().toISOString(),
      ],
    );
    console.log(`[Validator] ⚠️ 存疑人名: ${result.hallucinatedNames.join(', ')} (${result.severity})`);
  } catch (err) {
    console.warn('[Validator] 写日志失败:', err);
  }
}

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}
