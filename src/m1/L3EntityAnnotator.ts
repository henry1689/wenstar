/**
 * L3EntityAnnotator — 实体基因槽标注器
 *
 * 使用 FMM（正向最大匹配）分词 + 规则匹配提取实体。
 * 最小语义单位原则：禁止单字子串匹配，防止中文多字误报。
 *
 * Ref: ARCH.md §3.1 L3 实体基因槽
 * Ref: ARCH.md §4.2 编码时 entity_genes 标注 phenotype / knowledge_type
 * Ref: 设计意图宣言 §4 AI自我模型四大支柱
 */
import type {
  EntityGene,
  EntityType,
  PhenotypeLabel,
  L3AnnotationResult,
  SelfModelV1,
} from './types/dna.js';

// ──────────────────────────────────────────────
// 实体规则
// ──────────────────────────────────────────────

/**
 * 实体提取规则：带规范化名称的匹配规则
 * 每条规则在 FMM 分词后的 token 中进行匹配（不是子串匹配）。
 */
interface NormalizedEntityRule {
  name: string;
  type: EntityType;
  /** 匹配关键词（FMM 词典据此构建，单字仅保留"我"） */
  patterns: string[];
}

const ENTITY_EXTRACTION_RULES: NormalizedEntityRule[] = [
  // ── Self ──
  { name: '我', type: 'self', patterns: ['我'] },

  // ── Person — 亲属关系 ──
  { name: '妈妈', type: 'person', patterns: ['妈妈'] },
  { name: '爸爸', type: 'person', patterns: ['爸爸'] },
  { name: '母亲', type: 'person', patterns: ['母亲'] },
  { name: '父亲', type: 'person', patterns: ['父亲'] },
  { name: '爷爷', type: 'person', patterns: ['爷爷'] },
  { name: '奶奶', type: 'person', patterns: ['奶奶'] },
  { name: '外公', type: 'person', patterns: ['外公'] },
  { name: '外婆', type: 'person', patterns: ['外婆'] },
  { name: '哥哥', type: 'person', patterns: ['哥哥'] },
  { name: '弟弟', type: 'person', patterns: ['弟弟'] },
  { name: '姐姐', type: 'person', patterns: ['姐姐'] },
  { name: '妹妹', type: 'person', patterns: ['妹妹'] },
  { name: '老公', type: 'person', patterns: ['老公'] },
  { name: '老婆', type: 'person', patterns: ['老婆'] },
  { name: '男朋友', type: 'person', patterns: ['男朋友'] },
  { name: '女朋友', type: 'person', patterns: ['女朋友'] },
  { name: '亲戚', type: 'person', patterns: ['亲戚'] },
  { name: '姑姑', type: 'person', patterns: ['姑姑'] },
  { name: '舅舅', type: 'person', patterns: ['舅舅'] },
  { name: '阿姨', type: 'person', patterns: ['阿姨'] },
  { name: '叔叔', type: 'person', patterns: ['叔叔'] },
  { name: '朋友', type: 'person', patterns: ['朋友', '好友'] },
  { name: '同事', type: 'person', patterns: ['同事'] },
  { name: '同学', type: 'person', patterns: ['同学'] },
  { name: '室友', type: 'person', patterns: ['室友'] },
  { name: '老板', type: 'person', patterns: ['老板', '上司', '领导'] },

  // ── Emotion ──
  { name: '开心', type: 'emotion', patterns: ['开心'] },
  { name: '快乐', type: 'emotion', patterns: ['快乐'] },
  { name: '幸福', type: 'emotion', patterns: ['幸福'] },
  { name: '感动', type: 'emotion', patterns: ['感动'] },
  { name: '兴奋', type: 'emotion', patterns: ['兴奋'] },
  { name: '满足', type: 'emotion', patterns: ['满足'] },
  { name: '难过', type: 'emotion', patterns: ['难过'] },
  { name: '伤心', type: 'emotion', patterns: ['伤心'] },
  { name: '痛苦', type: 'emotion', patterns: ['痛苦'] },
  { name: '焦虑', type: 'emotion', patterns: ['焦虑'] },
  { name: '抑郁', type: 'emotion', patterns: ['抑郁'] },
  { name: '孤独', type: 'emotion', patterns: ['孤独'] },
  { name: '失落', type: 'emotion', patterns: ['失落'] },
  { name: '崩溃', type: 'emotion', patterns: ['崩溃'] },
  { name: '愤怒', type: 'emotion', patterns: ['愤怒', '生气'] },
  { name: '烦躁', type: 'emotion', patterns: ['烦躁'] },
  { name: '害怕', type: 'emotion', patterns: ['害怕'] },
  { name: '紧张', type: 'emotion', patterns: ['紧张'] },
  { name: '喜欢', type: 'emotion', patterns: ['喜欢'] },

  // ── Event ──
  { name: '结婚', type: 'event', patterns: ['结婚'] },
  { name: '工作', type: 'event', patterns: ['工作', '上班'] },
  { name: '考试', type: 'event', patterns: ['考试', '面试'] },
  { name: '搬家', type: 'event', patterns: ['搬家'] },
  { name: '旅行', type: 'event', patterns: ['旅行', '旅游'] },
  { name: '聚会', type: 'event', patterns: ['聚会'] },
  { name: '吵架', type: 'event', patterns: ['吵架', '争吵'] },
  { name: '分手', type: 'event', patterns: ['分手'] },
  { name: '约会', type: 'event', patterns: ['约会'] },
  { name: '加班', type: 'event', patterns: ['加班'] },

  // ── Place ──
  { name: '公司', type: 'place', patterns: ['公司', '办公室'] },
  { name: "北京", type: "place", patterns: ["北京"] },
  { name: "上海", type: "place", patterns: ["上海"] },
  { name: "深圳", type: "place", patterns: ["深圳"] },

  // ── Object ──
  { name: '礼物', type: 'object', patterns: ['礼物'] },
  { name: '宠物', type: 'object', patterns: ['猫', '狗', '宠物'] },
  { name: '压力', type: 'event', patterns: ['压力', '压力大'] },
  { name: '失眠', type: 'event', patterns: ['失眠', '睡不好', '睡不着'] },
  { name: '跑步', type: 'object', patterns: ['跑步', '晨跑', '夜跑'] },
  { name: '散步', type: 'object', patterns: ['散步', '遛弯', '走走'] },
  { name: '咖啡', type: 'object', patterns: ['咖啡', '喝咖啡'] },

  // ── 情绪/状态型 event ──
  { name: '累', type: 'emotion', patterns: ['好累', '太累了', '累坏了'] },

  // ── Hobby / Creativity ──
  { name: '画画', type: 'object', patterns: ['画画', '画国画', '画山水', '画人物', '绘画', '作画'] },
  { name: '国画', type: 'object', patterns: ['国画', '水墨画', '工笔', '写意'] },
  { name: '摄影', type: 'object', patterns: ['摄影', '拍照', '相机'] },
  { name: '音乐', type: 'object', patterns: ['音乐', '弹琴', '吉他', '钢琴', '唱歌'] },
  { name: '运动', type: 'object', patterns: ['运动', '跑步', '健身', '游泳', '打球', '篮球', '足球'] },
  { name: '游戏', type: 'object', patterns: ['游戏', '打游戏', '玩'] },
  { name: '烹饪', type: 'object', patterns: ['烹饪', '做饭', '做菜', '厨艺', '烘焙'] },
];

// 已删除的单字规则（因 FMM 匹配后仍会产生单字误报）：
// - '家'(place) — 国家/大家/专家 误报
// - '花'(object) — 花园/花生/花费 误报
// - '书'(object) — 书店/书法/秘书 误报

// ──────────────────────────────────────────────
// 中文正向最大匹配分词器
// ──────────────────────────────────────────────

/**
 * 正向最大匹配 (FMM) 中文分词器
 *
 * 词典基于 ENTITY_EXTRACTION_RULES 的 pattern 自动构建。
 * 以最长匹配优先原则确保复合词被整体识别。
 */
class ChineseSegmenter {
  private dict: string[] = [];
  private maxLen = 0;

  constructor(rules: NormalizedEntityRule[]) {
    const allPatterns = rules.flatMap(r => r.patterns);
    const unique = [...new Set(allPatterns)];
    // 按长度降序排列（FMM 核心 — 最长词优先）
    this.dict = unique.sort((a, b) => b.length - a.length || a.localeCompare(b));
    this.maxLen = Math.max(...this.dict.map(s => s.length), 1);
  }

  /**
   * 正向最大匹配分词
   * 从文本开头开始，每次尝试匹配词典中最长的词。
   */
  segment(text: string): string[] {
    const tokens: string[] = [];
    let i = 0;
    while (i < text.length) {
      let matched = false;
      const lookahead = Math.min(this.maxLen, text.length - i);
      for (let len = lookahead; len >= 1; len--) {
        const candidate = text.substring(i, i + len);
        if (this.dict.includes(candidate)) {
          tokens.push(candidate);
          i += len;
          matched = true;
          break;
        }
      }
      if (!matched) {
        // 未匹配的单字直接作为原子 token 加入
        // 后续实体提取时，非"我"的单字 token 不会被匹配为实体
        tokens.push(text[i]);
        i++;
      }
    }
    return tokens;
  }
}

// ──────────────────────────────────────────────
// 情感极性词表
// ──────────────────────────────────────────────

/**
 * 情感极性词表，用于 phenotype 标注
 */
export const POSITIVE_WORDS = new Set([
  '开心', '快乐', '幸福', '感动', '兴奋', '满足', '温暖',
  '甜蜜', '美好', '爱', '喜欢', '棒', '成功', '顺利',
  '感恩', '感谢', '珍惜',
]);

export const NEGATIVE_WORDS = new Set([
  '难过', '伤心', '痛苦', '绝望', '焦虑', '抑郁', '孤独',
  '失落', '崩溃', '无助', '生气', '愤怒', '烦躁', '郁闷',
  '讨厌', '恶心', '害怕', '恐惧', '担心', '紧张', '不安',
  '烦', '累', '难', '差', '糟', '失败', '压力',
]);

// ──────────────────────────────────────────────
// 实体提取器（基于 FMM 分词）
// ──────────────────────────────────────────────

/**
 * 基于 FMM 分词的命名实体识别器
 *
 * 匹配方式：对输入文本做 FMM 分词 → 检查 token 是否匹配规则中的 pattern
 * 与旧版差异：旧版用 text.includes(pattern) 做子串匹配，
 * 单字规则会在"国家"→"家"、"花园"→"花"等场景产生大量误报。
 * 新版基于 token 的精确匹配彻底消除此问题。
 */
class TokenBasedEntityExtractor {
  private segmenter: ChineseSegmenter;
  private rules: NormalizedEntityRule[];

  constructor(rules: NormalizedEntityRule[]) {
    this.rules = rules;
    this.segmenter = new ChineseSegmenter(rules);
  }

  extract(text: string): Array<{ name: string; type: EntityType; allele: string }> {
    const found: Array<{ name: string; type: EntityType; allele: string }> = [];
    const seen = new Set<string>();

    // FMM 分词
    const tokens = this.segmenter.segment(text.toLowerCase());

    for (const rule of this.rules) {
      // 检查 token 列表中是否有任意 pattern 匹配
      const matchedPattern = rule.patterns.find((pat) =>
        tokens.includes(pat.toLowerCase())
      );

      if (matchedPattern) {
        const dedupKey = `${rule.type}:${rule.name}`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          found.push({
            name: rule.name,
            type: rule.type,
            allele: matchedPattern,
          });
        }
      }
    }

    return found;
  }
}

// ──────────────────────────────────────────────
// L3 实体标注器
// ──────────────────────────────────────────────

/**
 * L3 实体标注器
 *
 * 使用规则驱动的方式完成：
 * 1. NER 实体提取（FMM 分词 + 关键词模式匹配）
 * 2. phenotype 标注（基于情感极性 + 自我模型比对）
 * 3. knowledge_type 分类（默认private，特定类型映射到family/world）
 *
 * Ref: ARCH.md §3.1 L3 实体基因槽
 * Ref: 架构决策备忘录 v1.1 — 禁止LLM介入
 */
export class L3EntityAnnotator {
  private extractor = new TokenBasedEntityExtractor(ENTITY_EXTRACTION_RULES);

  /**
   * 判断实体的 phenotype（对自我模型的影响方向）
   */
  private determinePhenotype(
    entityName: string,
    entityType: EntityType,
    context: string,
    selfModel: SelfModelV1
  ): PhenotypeLabel {
    if (entityType === 'self') {
      const hasStrongNegative = [...NEGATIVE_WORDS].some((w) => context.includes(w));
      const hasStrongPositive = [...POSITIVE_WORDS].some((w) => context.includes(w));
      if (hasStrongNegative && !hasStrongPositive) return 'conflict';
      if (hasStrongPositive && !hasStrongNegative) return 'enhance';
      return 'neutral';
    }

    const contextLower = context.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;

    for (const word of POSITIVE_WORDS) {
      if (contextLower.includes(word)) positiveCount++;
    }
    for (const word of NEGATIVE_WORDS) {
      if (contextLower.includes(word)) negativeCount++;
    }

    if (positiveCount > negativeCount) return 'enhance';
    if (negativeCount > positiveCount) return 'conflict';

    for (const boundary of selfModel.boundaries) {
      if (contextLower.includes(boundary.toLowerCase())) {
        return 'conflict';
      }
    }

    return 'neutral';
  }

  /**
   * 确定 knowledge_type（知识源类型）
   */
  private determineKnowledgeType(entityType: EntityType, entityName: string): 'private' | 'family' | 'world' {
    if (entityType === 'person') {
      const familyKeywords = [
        '妈妈', '母亲', '爸', '爸爸', '父亲',
        '爷爷', '奶奶', '外公', '外婆',
        '哥哥', '弟弟', '姐姐', '妹妹',
        '老公', '老婆', '丈夫', '妻子',
        '姑姑', '舅舅', '阿姨', '叔叔',
        '家庭', '家人', '亲戚',
      ];
      if (familyKeywords.some((kw) => entityName.includes(kw))) {
        return 'family';
      }
    }

    if (entityType === 'place') {
      const worldPlaces = ['北京', '上海', '深圳', '广州', '杭州', '中国', '美国'];
      if (worldPlaces.includes(entityName)) {
        return 'world';
      }
    }

    return 'private';
  }

  /**
   * 对输入文本进行L3实体标注
   */
  annotate(
    text: string,
    context: string,
    selfModel: SelfModelV1
  ): L3AnnotationResult {
    const entities = this.extractor.extract(text);
    const fullContext = `${text} ${context}`;

    const entityGenes: EntityGene[] = entities.map((entity) => ({
      name: entity.name,
      type: entity.type,
      allele: entity.allele,
      phenotype: this.determinePhenotype(entity.name, entity.type, fullContext, selfModel),
      knowledge_type: this.determineKnowledgeType(entity.type, entity.name),
    }));

    return { entity_genes: entityGenes };
  }
}
