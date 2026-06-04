// Ref: 架构决策备忘录 v1.3 — "最小语义单位"边界检测
// Ref: ARCH.md §2.2 树叶（具体实例）— 最小语义单位的存储粒度

/**
 * L0 路由用的话题领域关键词
 * 用于检测话题是否发生切换
 * Ref: L0Router.ts 关键词规则库（子集）
 */
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  family: ['妈妈', '妈', '爸', '爸爸', '父亲', '家', '家庭', '家人', '亲戚',
    '结婚', '催婚', '唠叨', '吵架', '温暖', '想念', '回家', '父母'],
  work: ['工作', '上班', '公司', '加班', '老板', '同事', '项目', '会议',
    '开会', '出差', '辞职', '升职', '加薪', '压力', '996', '面试', 'offer'],
  emotion_negative: ['难过', '伤心', '痛苦', '绝望', '焦虑', '抑郁', '孤独',
    '失落', '崩溃', '无助', '生气', '愤怒', '烦躁', '郁闷', '讨厌', '害怕', '紧张'],
  emotion_positive: ['开心', '快乐', '幸福', '感动', '兴奋', '满足', '温暖',
    '甜蜜', '美好', '爱', '喜欢', '感恩'],
  daily: ['天气', '吃饭', '睡觉', '出去', '走走', '散步', '运动', '电影',
    '音乐', '书', '猫', '狗', '宠物', '游戏', '购物',
    '画画', '画', '国画', '绘画', '摄影', '拍照', '唱歌', '吉他'],
};

/**
 * 情感极性关键词
 */
const POSITIVE_WORDS = new Set([
  '开心', '快乐', '幸福', '感动', '兴奋', '满足', '温暖',
  '甜蜜', '美好', '爱', '喜欢', '棒', '成功', '顺利',
]);

const NEGATIVE_WORDS = new Set([
  '难过', '伤心', '痛苦', '绝望', '焦虑', '抑郁', '孤独',
  '失落', '崩溃', '无助', '生气', '愤怒', '烦躁', '郁闷',
  '讨厌', '害怕', '恐惧', '紧张', '不安',
]);

export interface BoundaryResult {
  /** 是否开始新的语义单位 */
  is_new_unit: boolean;
  /** 边界类型 */
  boundary_type: 'topic_shift' | 'emotion_flip' | 'time_gap' | 'continue';
  /** 置信度 0~1 */
  confidence: number;
}

/**
 * 语义边界检测器
 *
 * 使用三条轻量规则判定两条相邻话语是否属于同一个"最小语义单位"：
 * 1. 时间间隔 > 30 分钟 → 新单位
 * 2. 话题领域切换 → 新单位
 * 3. 情感极性翻转 → 新单位
 * 4. 默认 → 继续当前单位
 *
 * Ref: 架构决策备忘录 v1.3 — 叶子节点（书页）存储粒度
 */
export class SemanticBoundaryDetector {
  /**
   * 检测两条连续话语之间的语义边界
   *
   * @param prevUtterance 前一条话语
   * @param currUtterance 当前话语
   * @param options 可选参数（时间戳）
   * @returns 边界检测结果
   */
  detect(
    prevUtterance: string,
    currUtterance: string,
    options?: {
      prevTimestamp?: string;
      currTimestamp?: string;
    }
  ): BoundaryResult {
    // ── 规则1: 时间间隔检测 ──
    if (options?.prevTimestamp && options?.currTimestamp) {
      const gap = this.calcTimeGapMs(options.prevTimestamp, options.currTimestamp);
      if (gap > 30 * 60 * 1000) {
        // 间隔超过30分钟
        return { is_new_unit: true, boundary_type: 'time_gap', confidence: 0.95 };
      }
    }

    // ── 规则2: 话题检测 ──
    const prevDomains = this.extractDomains(prevUtterance);
    const currDomains = this.extractDomains(currUtterance);

    // 两端都有明确领域且不共享任何领域 → 话题切换
    if (prevDomains.length > 0 && currDomains.length > 0) {
      const hasOverlap = currDomains.some((d) => prevDomains.includes(d));
      if (!hasOverlap) {
        // 完全没有重叠领域 → 强烈的话题切换信号
        return { is_new_unit: true, boundary_type: 'topic_shift', confidence: 0.85 };
      }
    }

    // 一端有明确领域、另一端无任何领域 → 检查词重叠率
    if (prevDomains.length === 0 || currDomains.length === 0) {
      const overlap = this.charOverlap(prevUtterance, currUtterance);
      if (overlap < 0.15) {
        return { is_new_unit: true, boundary_type: 'topic_shift', confidence: 0.6 };
      }
    }

    // ── 规则3: 情感极性翻转检测 ──
    const prevEmotion = this.detectEmotionPolarity(prevUtterance);
    const currEmotion = this.detectEmotionPolarity(currUtterance);

    if (prevEmotion !== 'neutral' && currEmotion !== 'neutral' && prevEmotion !== currEmotion) {
      return { is_new_unit: true, boundary_type: 'emotion_flip', confidence: 0.75 };
    }

    // ── 默认: 属于同一语义单位 ──
    return { is_new_unit: false, boundary_type: 'continue', confidence: 0.9 };
  }

  /**
   * 计算两个ISO8601字符串的时间间隔（毫秒）
   */
  private calcTimeGapMs(t1: string, t2: string): number {
    try {
      const d1 = new Date(t1).getTime();
      const d2 = new Date(t2).getTime();
      if (isNaN(d1) || isNaN(d2)) return 0;
      return Math.abs(d2 - d1);
    } catch (err) {
      console.warn('[SBD] 时间解析失败:', err);
      return 0;
    }
  }

  /**
   * 提取文本匹配的领域列表
   */
  private extractDomains(text: string): string[] {
    const matched: string[] = [];
    const lowerText = text.toLowerCase();

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      const matches = keywords.some((kw) => lowerText.includes(kw));
      if (matches) matched.push(domain);
    }

    return matched;
  }

  /**
   * 检测文本的情感极性
   */
  private detectEmotionPolarity(text: string): 'positive' | 'negative' | 'neutral' {
    let posCount = 0;
    let negCount = 0;

    for (const w of POSITIVE_WORDS) {
      if (text.includes(w)) posCount++;
    }
    for (const w of NEGATIVE_WORDS) {
      if (text.includes(w)) negCount++;
    }

    if (posCount > 0 && negCount === 0) return 'positive';
    if (negCount > 0 && posCount === 0) return 'negative';
    return 'neutral'; // 都有或都没有
  }

  /**
   * 计算两个字符串的字符级重叠率（Jaccard相似度）
   * 用于判断没有明确话题领域的文本之间是否有连续性
   */
  private charOverlap(a: string, b: string): number {
    const setA = new Set(a);
    const setB = new Set(b);
    if (setA.size === 0 || setB.size === 0) return 0;

    const intersection = new Set([...setA].filter((c) => setB.has(c)));
    const union = new Set([...setA, ...setB]);

    return intersection.size / union.size;
  }
}
