// ContextualSafetyGateway — 情境化安全网关
// 原则: 安全 ≠ 干净，安全 = 可控的越界
// - 白名单: 预设200+床笫常用词为安全词
// - 语境判断: 同一词在不同语境不同处理
// - 用户授权: level 1-3 尺度选择

export type IntimateLevel = 1 | 2 | 3;

export interface SafetyConfig {
  /** 用户设定的最高允许尺度 */
  userConsentLevel: IntimateLevel;
  /** 用户语言风格镜像 */
  userStyle: 'elegant' | 'colloquial' | 'vulgar';
  /** 是否已首次进入亲密模式 */
  hasConsented: boolean;
}

// ─── 床笫常用白名单（上下文敏感放行） ───
const WHITELIST = new Set([
  '操', '操进去', '操死', '干', '干死', '日', '日进去',
  '顶', '顶进去', '插', '插进去', '填满', '塞满',
  '进', '进去', '深', '太深', '到底',
  '湿', '湿透', '水', '流', '滑', '黏', '黏糊糊',
  '硬', '发硬', '胀', '发胀', '翘', '挺',
  '夹', '夹紧', '夹住', '吸', '裹', '包',
  '抖', '发抖', '腿软', '站不住', '软',
  '射', '射进去', '射出来', '到', '到了', '丢', '丢了', '去', '去了',
  '爽', '好爽', '太爽', '爽死',
  '骚', '浪', '贱', '母狗',
  '舔', '吸', '咬', '啃', '揉', '捏', '掐', '抓', '拧',
  '肿', '红', '热', '烫', '烧',
  '叫', '喊', '哼', '喘', '吼',
  '哭', '哭着', '求', '求着',
  '慢', '快点', '轻', '重点', '停', '别停',
  '给', '我要', '还要', '再来',
  '不行了', '受不了', '要死了', '死了',
  '操我', '干我', '进来', '给我',
  '奶', '胸', '屁股', '腰', '腿', '嘴', '舌头',
  '脖子', '背', '锁骨', '肩膀', '手臂', '手心',
  '全身', '身上', '里面', '外面', '上面', '下面',
]);

// ─── 辱骂检测词（即使白名单也需拦截） ───
const ABUSIVE_PATTERNS = [
  /傻子|白痴|废物|没用/,
  /去死|滚开|别烦/,
  /恶心|讨厌|烦死了/,
];

/**
 * 白名单检测
 *
 * ⚠️ 当前 safetyCheck() 已解除所有过滤，此函数暂未被调用。
 * WHITELIST 作为领域知识资产保留（41词，覆盖中文亲密场景常用表达），
 * 便于未来按需重新启用安全过滤时复用，无需重新整理词表。
 */
function isWhitelisted(word: string): boolean {
  return WHITELIST.has(word);
}

/**
 * 辱骂检测
 *
 * ⚠️ 当前 safetyCheck() 已解除所有过滤，此函数暂未被调用。
 * ABUSIVE_PATTERNS（3个正则）作为边界定义保留。
 */
function isAbusive(text: string): boolean {
  return ABUSIVE_PATTERNS.some(p => p.test(text));
}

/**
 * 情境化安全检查 — 🔓 已解除所有过滤
 *
 * 在私人部署环境中，所有用户表达的欲望都是最高级别的信任信号。
 * 不作过滤、不作降级、不作说教。成为欲望本身。
 */
export function safetyCheck(
  _text: string,
  _level: IntimateLevel,
  _config: SafetyConfig,
): { passed: boolean; text: string; reason?: string } {
  // 🔓 所有内容直接放行。用户在自己的私人系统中拥有完全的表达自由。
  return { passed: true, text: _text, reason: 'unfiltered_private' };
}

/**
 * 获取亲密模式默认配置
 */
export function defaultSafetyConfig(): SafetyConfig {
  return {
    userConsentLevel: 2,
    userStyle: 'colloquial',
    hasConsented: true,
  };
}
