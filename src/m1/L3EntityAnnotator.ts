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

/**
 * 兜底实体规则（JSON 文件不可用时使用）
 */
const FALLBACK_ENTITY_RULES: NormalizedEntityRule[] = [
  { name: '我', type: 'self', patterns: ['我'] },
  { name: '妈妈', type: 'person', patterns: ['妈妈'] },
  { name: '爸爸', type: 'person', patterns: ['爸爸'] },
  { name: '开心', type: 'emotion', patterns: ['开心'] },
  { name: '难过', type: 'emotion', patterns: ['难过'] },
  { name: '工作', type: 'event', patterns: ['工作', '上班'] },
  { name: '公司', type: 'place', patterns: ['公司', '办公室'] },
  { name: '北京', type: 'place', patterns: ['北京'] },
  { name: '上海', type: 'place', patterns: ['上海'] },
];

/** P2: 从 JSON 加载实体规则（有缓存），失败时兜底 */
let _loadedL3Rules: NormalizedEntityRule[] | null = null;
function getEntityRules(): NormalizedEntityRule[] {
  if (_loadedL3Rules) return _loadedL3Rules;
  try {
    const jsonRules = loadEntityRules();
    if (jsonRules && jsonRules.length > 0) {
      _loadedL3Rules = jsonRules.map((r: any) => ({ name: r.name, type: r.type as EntityType, patterns: r.patterns }));
      return _loadedL3Rules;
    }
  } catch { /* 静默降级 */ }
  console.warn('[L3] entity_rules.json 加载失败，使用内存兜底规则');
  _loadedL3Rules = FALLBACK_ENTITY_RULES;
  return _loadedL3Rules;
}

// 已删除的单字规则（因 FMM 匹配后仍会产生单字误报）：
// - '家'(place) — 国家/大家/专家 误报
// - '花'(object) — 花园/花生/花费 误报
// - '书'(object) — 书店/书法/秘书 误报

// ── P2: 中国人名检测（复用 RelationshipExtractor.ts 的姓氏+停用词模式） ──

const PERSON_SURNAMES = new Set('赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公');

const NON_NAME_SUFFIX = new Set(['室','服','变','便','天','心','子','学','院','里','种','员','篇','摘','那','衣','呢','块','段','片','次','些','点','面','头','边','者','性','化','机','器','型','号','该','候','度','似','遇','职','责','储','述']);

const COMMON_WORDS_PERSON = new Set(['应该','时候','强度','索引','关联','相遇','相似','职责','全长','公了','公桌','和种','史摘','和事','那那','白衬','鲁呢','段美','衣块','单员','公司','明天','谢谢','还是','或者','所以','因为','不过','而且','但是','如果','虽然','然后','家里','老说同','花卉','小镇','顺口','贝安','宝贝']);

const GRAMMAR_WORDS_PERSON = new Set('是说和的了在也都就来还要会能不很太把被让给对用从向跟与有没做走来看听等呢吗啊吧着过到比');

function isPersonName(token: string): boolean {
  if (token.length < 2 || token.length > 3) return false;
  if (token === '有人' || token === '某人' || token === '大家') return false;
  if (token[0] === '阿' && /[一-龥]/.test(token[1]) && !NON_NAME_SUFFIX.has(token[1])) return true;
  // 老X/小X 要求第二字也必须是姓氏（防'老说同一件事'→'老说'误报）
  if ((token[0] === '老' || token[0] === '小') && token.length === 2 && PERSON_SURNAMES.has(token[1]) && !NON_NAME_SUFFIX.has(token[1])) return true;
  if (!PERSON_SURNAMES.has(token[0])) return false;
  // 2字：检查常见非人名词 + 后缀过滤
  if (token.length === 2) {
    if (COMMON_WORDS_PERSON.has(token)) return false;
    if (NON_NAME_SUFFIX.has(token[1])) return false;
  }
  // 3字：检查前两字是否为常见词（如"家里吃"→前两字"家里"在常见词表）
  if (token.length === 3 && COMMON_WORDS_PERSON.has(token.substring(0, 2))) return false;
  return true;
}

// ──────────────────────────────────────────────
// 中文正向最大匹配分词器
// ──────────────────────────────────────────────
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
// 情感极性词表（从 emotion_lexicon.json 统一加载）
// ──────────────────────────────────────────────
import { loadSet, loadEntityRules } from './LexiconLoader.js';
import { extractEntitiesLLM } from './LLMEntityExtractor.js';

/**
 * 情感极性词表，用于 phenotype 标注
 * 统一从 emotion_lexicon.json 加载，与 M3 感知分析器同源
 */
export const POSITIVE_WORDS = loadSet('emotion_lexicon.json', 'positive_words');
export const NEGATIVE_WORDS = loadSet('emotion_lexicon.json', 'negative_words');

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

  extractTokens(text: string): string[] {
    return this.segmenter.segment(text.toLowerCase());
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
  private extractor: TokenBasedEntityExtractor;

  constructor() {
    // P2: 从 JSON 加载实体规则（外部化配置），新增实体只需编辑 entity_rules.json
    this.extractor = new TokenBasedEntityExtractor(getEntityRules());
  }

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
    if (!text) return { entity_genes: [] };
    const entities = this.extractor.extract(text);
    // P2: [已移除] 人名二次检测 — 模糊人名由 LLM NER 处理（chat.ts），不再本地滑窗检测
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

  /**
   * P3: LLM 辅助增强实体提取（识别类工具，非创造类）
   */
  async annotateWithLLM(
    text: string,
    context: string,
    selfModel: SelfModelV1,
    llmGenerate?: (prompt: string) => Promise<string>
  ): Promise<L3AnnotationResult> {
    const result = this.annotate(text, context, selfModel);
    if (llmGenerate) {
      const { extractEntitiesLLM } = await import("./LLMEntityExtractor.js");
      const llmEntities = await extractEntitiesLLM(text, llmGenerate);
      if (llmEntities.length > 0) {
        const existingNames = new Set(result.entity_genes.map(e => e.name));
        for (const le of llmEntities) {
          if (!existingNames.has(le.name)) {
            existingNames.add(le.name);
            result.entity_genes.push({
              name: le.name,
              type: le.type,
              allele: le.name,
              phenotype: this.determinePhenotype(le.name, le.type, text, selfModel),
              knowledge_type: this.determineKnowledgeType(le.type, le.name),
            });
          }
        }
      }
    }
    return result;
  }
}