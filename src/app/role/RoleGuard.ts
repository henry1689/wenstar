/**
 * RoleGuard — 输出角色校验器
 *
 * LLM 输出后二次校验内容与当前角色的匹配度。
 * 匹配度 < 0.5 触发重生成，最多 2 次。
 * 2 次失败降级 secretary 安全角色。
 */
import type { RoleType } from './RoleClassifier.js';

// ─── 各角色的禁止词模式 ───
const FORBIDDEN_PATTERNS: Record<string, RegExp[]> = {
  secretary: [
    /喘|腿|腰|蹭|抱|贴|吻|亲|摸|操|干|射|舔|咬|吸/,
    /想你了|好想你|抱抱|亲亲|想要|好想要|要你/,
    /吃醋|撒娇|撩|性感|诱惑/,
  ],
  strategist: [
    /喘|腿|腰|蹭|抱|贴|吻|亲|摸|操|干/,
    /想你了|好想你|抱抱|想要|要你/,
    /撒娇|吃醋|性感|诱惑/,
  ],
  recaller: [
    /应该|可能|大概|也许|说不定|我记得.*好像|我猜|估计/,
  ],
  counselor: [
    /操|干|射|舔|咬|吸|插|顶/,
  ],
  lover: [
    // 🔴 "操"作为口头禅/感叹词 → 禁止（句首/句中+标点后；不拦"操你""操死"等动词短语）
    /^操[。！…，、：；\s]/,
    /[。！…，、：；\s……]操[。！…，、：；\s……]/,
  ],
};

// ─── 各角色的强制包含词 ───
const REQUIRED_PATTERNS: Record<string, RegExp[]> = {
  recaller: [
    /没听你提过|没跟我说过|不知道|不记得|不太清楚|我记得|你跟我说过|你以前说|你之前说/,
  ],
};

export interface GuardResult {
  passed: boolean;
  confidence: number;
  reason: string;
  retryCount: number;
}

/**
 * 校验 LLM 输出与当前角色的匹配度
 */
export function validateRoleOutput(
  reply: string,
  role: RoleType,
  retryCount: number = 0,
): GuardResult {
  if (!reply) {
    return { passed: false, confidence: 0, reason: 'empty_reply', retryCount };
  }

  // 检查禁止词
  const forbidden = FORBIDDEN_PATTERNS[role] || [];
  for (const pattern of forbidden) {
    if (pattern.test(reply)) {
      const confidence = Math.max(0.1, 1 - retryCount * 0.3);
      return {
        passed: false,
        confidence,
        reason: `forbidden_pattern: ${pattern.source}`,
        retryCount,
      };
    }
  }

  // recaller 强制检查"没说过"类短语
  const required = REQUIRED_PATTERNS[role] || [];
  if (required.length > 0) {
    const hasAny = required.some(p => p.test(reply));
    if (!hasAny) {
      return {
        passed: false,
        confidence: 0.4,
        reason: 'missing_required_pattern',
        retryCount,
      };
    }
  }

  return { passed: true, confidence: 1, reason: 'ok', retryCount };
}

/**
 * 获取降级后的安全角色
 */

/**
 * (P2) 对话组一致性校验：检查回复是否与同话题历史矛盾
 * @param reply 生成回复
 * @param historyText 同话题历史对话组文本
 * @returns 是否通过校验
 */
export function checkConsistency(reply: string, historyText?: string): { passed: boolean; reason?: string } {
  if (!historyText || historyText.length < 10) return { passed: true };

  // 提取回复中明确表态的内容
  const assertions: string[] = [];
  const patterns = [/我[不]?(喜欢|讨厌|爱|恨|觉得|认为|记得|不记得|知道|不知道|想|不想|要|不要|会|不会|可以|不可以|应该|不应该)/gi];
  for (const p of patterns) {
    const m = reply.match(p);
    if (m) assertions.push(m[0].toLowerCase());
  }

  if (assertions.length === 0) return { passed: true };

  // 检查历史中是否有矛盾的断言
  const history = historyText.toLowerCase();
  for (const a of assertions) {
    // 如果现在说"喜欢"但历史说"不喜欢"等
    if (a.includes('不') && history.includes(a.replace('不', ''))) {
      return { passed: false, reason: '与历史观点矛盾: ' + a };
    }
    if (!a.includes('不') && history.includes(a.slice(0, a.indexOf('不') + 1) + '不')) {
      return { passed: false, reason: '与历史观点矛盾: ' + a };
    }
  }
  return { passed: true };
}

export function getFallbackRole(originalRole: RoleType): RoleType {
  return 'secretary';
}
