/**
 * RelationshipExtractor — 人际关系图谱提取器
 *
 * 设计理念（来自鸿艺）：
 *   - 人名是核心索引，不是关系词。
 *   - 只有纯家庭关系（爸爸/妈妈/老婆/老公等）需要精确映射。
 *   - 其他所有人只记"认识的人"，关键是把上下文保存下来：
 *     职业、特点、在哪认识的、当时说了什么——统统记为模糊备注。
 *   - 后续对话提到同一个人时，不断追加补充。
 */
import { FAMILY_GRAPH_MIGRATION } from '../../config/family-graph-migration.js';
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';

/** 家庭关系词（精确映射）— 非家庭的统统归为"认识的人" */
export const FAMILY_MAP: Record<string, string> = {
  '老公': '配偶', '老婆': '配偶', '妻子': '配偶', '丈夫': '配偶',
  '男朋友': '恋人', '女朋友': '恋人', '男友': '恋人', '女友': '恋人',
  '爸爸': '父亲', '父亲': '父亲', '爹': '父亲', '爸': '父亲',
  '妈妈': '母亲', '母亲': '母亲', '娘': '母亲', '妈': '母亲',
  '儿子': '儿子', '女儿': '女儿', '孩子': '子女',
  '哥哥': '兄弟', '弟弟': '兄弟', '哥': '兄弟',
  '姐': '姐妹', '妹妹': '姐妹', '姐姐': '姐妹',
  '爷爷': '祖父', '奶奶': '祖母', '姥爷': '祖父', '姥姥': '祖母',
  '公公': '公婆', '婆婆': '公婆',
  '岳父': '岳父母', '岳母': '岳父母',
};

export interface DetectedRelationship {
  personName: string;
  relation: string;      // 认识的人 | 父亲 | 配偶 | ...
  rawRelation: string;   // 原文中的关系词
  context: string;       // 上下文（用于备注）
  /** FIX-3: 关联的另一个人物（"X是Y的Z"中的Y） */
  relatedTo?: string;
}

/** 常见姓氏前300 */
const SURNAMES = new Set(
  '赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公'
);

/** 判断是否为可识别的人名 */
function isName(text: string): boolean {
  if (text.length < 2 || text.length > 3) return false;
  // "阿X" — 口语称呼（阿珍、阿强、阿花），不要求"阿"在姓氏表中
  if (text.length === 2 && text[0] === '阿' && /[一-龥]/.test(text[1]) && !TRAILING_STOP.has(text[1])) return true;
  // "老X" / "小X" — 口语称呼，放宽小X不要求后缀为姓（老李、小王、小芳、小美）
  if (text.length === 2 && (text[0] === '老' || text[0] === '小') && /[一-龥]/.test(text[1]) && !TRAILING_STOP.has(text[1])) return true;
  // 姓氏+名（张中山、熊梓铭）— 首字为300常见姓氏
  return SURNAMES.has(text[0]);
}

/** 检查提取的"名字"是否长词的一部分（防止"车载"误判为姓"车"）
 *  🔴 仅检查后字：前字检查导致"另外徐诗雨"的"外"误拦截。
 *    常见语法词（是/说/和/的等）可跟在人名后，不视为复合词。
 *    如"熊勇是我的"→"是"跟在人名后→不拦截 ✓
 *    "车载空气净化器"→"气"跟在"车载空"后→拦截 ✓
 */
function isCompoundWordPart(name: string, fullText: string): boolean {
  const GRAMMAR_WORDS = new Set('是说和的了在也都就来还要会能不很太把被让给对用从向跟与有没做走来看听等呢吗啊吧着过到比');
  const idx = fullText.indexOf(name);
  if (idx < 0) return false;
  const afterIdx = idx + name.length;
  // 只检查后字：如果是中文且不是常见语法词 → 可能是复合词，拦截
  if (afterIdx < fullText.length) {
    const nextChar = fullText[afterIdx];
    if (/[一-龥]/.test(nextChar) && !GRAMMAR_WORDS.has(nextChar)) return true;
  }
  return false;
}

/** 名字后紧跟这些字说明不是名字的完整部分 */
const TRAILING_STOP = new Set('昨今明去来也和就都在这那而已了过');

/** 从文本开头提取一个名字（取2-3字，去掉尾停用字） */
function extractName(raw: string): string | null {
  if (raw.length === 0) return null;
  const candidate = raw.substring(0, 3);
  if (candidate.length < 2) return null;

  // 先试3个字（前提是第三个字不是停用字）
  if (candidate.length === 3 && !TRAILING_STOP.has(candidate[2]) && isName(candidate)) return candidate;
  // 试前2个字
  const two = candidate.substring(0, 2);
  if (isName(two)) return two;

  return null;
}

/** 取名字附近 60 字左右的上下文用于备注 */
function extractContext(text: string, name: string): string {
  const idx = text.indexOf(name);
  if (idx < 0) return text.substring(0, 80);
  const start = Math.max(0, idx - 20);
  const end = Math.min(text.length, idx + name.length + 40);
  return text.substring(start, end).trim();
}

/** 判断某个词是否为纯家庭关系词 */
export function isFamilyWord(word: string): boolean {
  return word in FAMILY_MAP;
}

/** 根据上下文推荐可能的社交关系选项（用于生成反问 — 玉瑶不清楚时主动询问） */
export function guessRelationOptions(context: string): string[] {
  const workHints = /开会|项目|方案|合同|客户|老板|公司|加班|汇报|同事|领导/;
  const socialHints = /吃饭|聚会|朋友|喝酒|唱歌|逛街|聊|玩|约/;
  const eduHints = /同学|老师|学校|上课|毕业|培训|学习/;
  const medHints = /医生|医院|看病|治疗|手术/;

  if (workHints.test(context)) return ['同事', '客户', '老板'];
  if (socialHints.test(context)) return ['朋友', '同事', '合伙人'];
  if (eduHints.test(context)) return ['同学', '老师', '同事'];
  if (medHints.test(context)) return ['医生', '朋友'];
  return ['同事', '朋友', '客户'];
}

/**
 * 从文本中检测人物提及。
 *
 * 策略：人名检测 → 判断关系 → 存上下文
 * - 家庭关系（爸爸/老婆等）：精准映射
 * - 其他所有人：统一 "认识的人"，上下文字段就是备注
 */
export function extractRelations(text: string): DetectedRelationship[] {
  const results: DetectedRelationship[] = [];
  const seen = new Set<string>();

  // ── 1. 显式介绍模式: "XXX是我的YYY" / "XXX是我朋友/同事/部下" ──
  //    "林土锋是我的部下"、"张中山是我的客户"、"老王是我同事"
  //    如果 YYY 是家庭关系词 → 精确；否则 → 认识的人
  const explicitIntro = text.match(/([一-龥]{2,3})是我的?([一-龥]{2,4})/);
  if (explicitIntro) {
    const name = explicitIntro[1];
    const relationWord = explicitIntro[2];
    if (isName(name) && !seen.has(name)) {
      seen.add(name);
      const relation = isFamilyWord(relationWord) ? FAMILY_MAP[relationWord] : '认识的人';
      results.push({
        personName: name,
        relation,
        rawRelation: relationWord,
        context: extractContext(text, name),
      });
    }
  }

  // ── 2. 前置介词模式: "和XXX一起/开会"、"跟XXX"、"找XXX"、"约XXX" ──
  //    "和张中山一起开会"、"找老李聊了聊"
  const prepPattern = text.match(/(?:和|跟|找|约|陪|帮|替|对|向)([一-龥老小]{2,3})(?:一起|开会|吃饭|聊|说|谈|商量|讨论|见面|合作|打了|做了|去了)?/);
  if (prepPattern) {
    const name = prepPattern[1];
    if (isName(name) && !seen.has(name)) {
      seen.add(name);
      results.push({
        personName: name,
        relation: '其他',
        rawRelation: '',
        context: extractContext(text, name),
      });
    }
  }

  // ── 3. 介绍/提及模式: "有个同事叫XXX"、"有一位XXX"、"叫XXX的"、"那个XXX" ──
  const introPattern = text.match(/(?:叫|有位|有一位|有一个|认识一个|有个|那个|这位|这位叫|我们[公司组团队][的]?)([一-龥老小]{2,3})[的]?/);
  if (introPattern) {
    const name = introPattern[1];
    if (isName(name) && !seen.has(name)) {
      seen.add(name);
      results.push({
        personName: name,
        relation: '其他',
        rawRelation: '',
        context: extractContext(text, name),
      });
    }
  }

  // ── 4. "XXX这个人" 模式 ──
  const thisPerson = text.match(/([一-龥老小]{2,3})这个人/);
  if (thisPerson) {
    const name = thisPerson[1];
    if (isName(name) && !seen.has(name)) {
      seen.add(name);
      results.push({
        personName: name,
        relation: '其他',
        rawRelation: '',
        context: extractContext(text, name),
      });
    }
  }

  // ── 5. "XXX说/认为/提到"（中置信度，可能是引述） ──
  const sayPattern = text.match(/([一-龥老小]{2,3})(?:说|认为|提到|告诉我|跟我|建议|主张|反驳|同意|反对)了?/);
  if (sayPattern) {
    const name = sayPattern[1];
    // 排除对话中的"你说""我说""有人说"等
    if (isName(name) && !seen.has(name) && name !== '有人' && name !== '某人' && name !== '大家') {
      seen.add(name);
      results.push({
        personName: name,
        relation: '其他',
        rawRelation: '',
        context: extractContext(text, name),
      });
    }
  }

  // ── 6. 老/小前缀的其他形式（如果前5步都没覆盖到） ──
  //    单独出现的"老李""小王"等
  const laoPattern = text.match(/(?:老|小)([一-龥])/g);
  if (laoPattern) {
    for (const match of laoPattern) {
      if (!seen.has(match) && isName(match)) {
        seen.add(match);
        results.push({
          personName: match,
          relation: '认识的人',
          rawRelation: '',
          context: extractContext(text, match),
        });
      }
    }
  }

  // ── 7. "遇到了XXX" / "见到了XXX" / "碰见了XXX" / "认识了一个XXX" ──
  //    "遇到了张中山"、"认识了一个老李"
  const meetPattern = text.match(/(?:遇到了|见到了|碰见了|遇见了|认识了|认识了一个|碰到|遇到|见到)([一-龥老小]{2,3})/);
  if (meetPattern) {
    const name = meetPattern[1];
    if (isName(name) && !seen.has(name)) {
      seen.add(name);
      results.push({
        personName: name,
        relation: '其他',
        rawRelation: '',
        context: extractContext(text, name),
      });
    }
  }

  // ── 8. "XXX这人" / "XXX这个人" — 描述定锚 ──
  const descPattern = text.match(/([一-龥老小]{2,3})(?:这人|这个人|那个人|那人)/);
  if (descPattern) {
    const name = descPattern[1];
    if (isName(name) && !seen.has(name)) {
      seen.add(name);
      results.push({
        personName: name,
        relation: '其他',
        rawRelation: '',
        context: extractContext(text, name),
      });
    }
  }

  // ── 9. 家庭前缀模式: "我妈" / "我爸" / "我哥" / "我姐" — 精确映射
  const familyPrefix = text.match(/我(妈|爸|哥|姐|弟|妹|儿子|女儿|老公|老婆|爷爷|奶奶|姥姥|姥爷|公公|婆婆|岳父|岳母)/);
  if (familyPrefix) {
    const relWord = familyPrefix[1];
    const mappedRel = FAMILY_MAP[relWord] || '';
    if (mappedRel) {
      if (!seen.has(relWord)) {
        seen.add(relWord);
        results.push({
          personName: relWord,
          relation: mappedRel,
          rawRelation: relWord,
          context: extractContext(text, relWord),
        });
      }
    }
  }

  // ── 10. FIX-3: "X是Y的Z" 三元组模式 ──
  //    "熊梓铭是熊勇的儿子" → {subject:熊梓铭, relation:child_of, object:熊勇}
  //    "王全芬是熊勇的老婆" → {subject:王全芬, relation:spouse_of, object:熊勇}
  //    "熊梓铭和熊梓玥是熊勇的孩子" → 拆为两组
  // 先拆 "A和B是C的D" 为两个子句
  const ternaryParts = text.match(/^([一-龥]{2,3})和([一-龥]{2,3})是([一-龥]{2,3})的([一-龥]{2,4})$/);
  if (ternaryParts) {
    const subjectA = ternaryParts[1], subjectB = ternaryParts[2];
    const object = ternaryParts[3], relWord = ternaryParts[4];
    const mappedRel = FAMILY_MAP[relWord] || '';
    if (mappedRel && isName(subjectA) && isName(subjectB) && isName(object)) {
      if (!seen.has(subjectA)) { seen.add(subjectA);
        results.push({ personName: subjectA, relation: mappedRel, rawRelation: relWord, context: text, relatedTo: object }); }
      if (!seen.has(subjectB)) { seen.add(subjectB);
        results.push({ personName: subjectB, relation: mappedRel, rawRelation: relWord, context: text, relatedTo: object }); }
    }
  } else {
    // 单条 "X是Y的Z"
    const singleTernary = text.match(/([一-龥]{2,3})是([一-龥]{2,3})的([一-龥]{2,4})/);
    if (singleTernary) {
      const subject = singleTernary[1], object = singleTernary[2], relWord = singleTernary[3];
      const mappedRel = FAMILY_MAP[relWord] || '';
      if (mappedRel && isName(subject) && isName(object) && !seen.has(subject)) {
        seen.add(subject);
        results.push({ personName: subject, relation: mappedRel, rawRelation: relWord, context: text, relatedTo: object });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 过滤：排除所有长词误匹配（如"车载空气净化器"中的"车载空"）
  // ═══════════════════════════════════════════════════════════════
  return results.filter(r => !isCompoundWordPart(r.personName, text));
}

export function storeRelations(sqlite: any, relations: DetectedRelationship[], sourceMessage: string, familyGraph?: any): number {
  let stored = 0;
  const now = new Date().toISOString();

  for (const rel of relations) {
    try {
      // ── FIX-4: 如果包含 relatedTo，先写入 person→person 关系 ──
      if (rel.relatedTo) {
        // 保证 relatedTo 实体存在
        sqlite.writeRaw(`INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)`, rel.relatedTo, 'person');
        // 创建 person→person 的 entity_relations 边
        const srcRows = sqlite.queryAll(`SELECT id FROM entities WHERE name = ? AND type = ?`, [rel.personName, 'person']);
        const tgtRows = sqlite.queryAll(`SELECT id FROM entities WHERE name = ? AND type = ?`, [rel.relatedTo, 'person']);
        if (srcRows.length > 0 && tgtRows.length > 0) {
          sqlite.writeRaw(
            `INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET strength = MIN(5.0, excluded.strength + 0.1), updated_at = excluded.updated_at`,
            srcRows[0].id, tgtRows[0].id, rel.relation, 0.9, now
          );
        }
        stored++;
        continue; // 跳过下方的"我"边——relatedTo 优先为人物之间建立关系
      }

      // 保证实体存在
              // (FG-迁移) 双写主库
        if (familyGraph && FAMILY_GRAPH_MIGRATION.writeMode !== 'shadow') {
          try { familyGraph.integrateSocialRelation(rel.personName, rel.relation, sourceMessage).catch(() => {}); } catch {}
        }
        sqlite.writeRaw(`INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)`, rel.personName, 'person');
      sqlite.writeRaw(`INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)`, '我', 'self');

      // 实体关系
      const aRows = sqlite.queryAll(`SELECT id FROM entities WHERE name = ? AND type = ?`, ['我', 'self']);
      const bRows = sqlite.queryAll(`SELECT id FROM entities WHERE name = ? AND type = ?`, [rel.personName, 'person']);
      if (aRows.length > 0 && bRows.length > 0) {
        sqlite.writeRaw(
          `INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET strength = MIN(5.0, excluded.strength + 0.1), updated_at = excluded.updated_at`,
          aRows[0].id, bRows[0].id, rel.relation, 0.8, now
        );
      }

      // 人物信息统一存储在 FamilyGraph，不再写入 knowledge_base
      stored++;
    } catch (err) {
      console.warn('[Relation] 图谱写入失败:', err);
    }
  }
  return stored;
}
