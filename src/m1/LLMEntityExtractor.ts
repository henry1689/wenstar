/**
 * LLMEntityExtractor — LLM 辅助实体提取（三层过滤机制）
 *
 * 三层拦截杜绝误识别、乱提取：
 *   ① Prompt强约束 — 源头限制输出，temperature=0消除随机
 *   ② 类型白名单+后置过滤 — 剔除"家里"类误报
 *   ③ 人名正则校验 — 对person实体双重验证
 *
 * 原则: NER是识别类工具，不是创造类工具。
 */
import type { EntityType } from './types/dna.js';

export interface LLMExtractedEntity {
  name: string;
  type: EntityType;
}

// ─── 第二层：类型白名单 + person黑名单 ───

/** 允许的实体类型（屏蔽place/object，防止地点物品被当成人） */
const TYPE_ALLOWED = new Set(['person', 'emotion', 'event']);

/** person实体黑名单 — 场所、物品、时间词误报过滤 */
const PERSON_BLACKLIST = new Set([
  '家里', '公司', '学校', '医院', '办公室', '后山', '公园', '路上', '楼下',
  '外面', '里面', '旁边', '对面', '左边', '右边', '前面', '后面', '上边', '下边',
  '家里吃', '家里来', '公司里', '学校里',
  '今天', '明天', '昨天', '前天', '刚才', '现在', '晚上', '早上', '中午', '下午',
  '那个', '这个', '什么', '怎么', '为什么', '哪里', '那儿', '这儿',
  '一个', '一起', '一直', '一下', '一点', '一些', '那种', '这种', '这样', '那样',
  '然后', '而且', '但是', '因为', '所以', '还是', '或者', '如果', '虽然', '不过',
  '东西', '时候', '地方', '事情', '原因', '结果', '关系', '问题', '办法',
  '强度', '索引', '关联', '相遇', '相似', '应该', '职责', '全长',
]);

/** 中文姓名正则 — 2-3字纯中文，首字在常用姓氏中 */
const SURNAMES = '赵钱孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公';

/** 第三层：person人名正则校验 */
const PERSON_NAME_REGEX = new RegExp('^[' + SURNAMES + '][一-龥]{1,2}$');
const RESPECT_PATTERN = /^[一-龥]{1,3}[总经主副助教]$/; // 张总、王经理、李主任

function isValidPersonName(name: string): boolean {
  if (name.length < 2 || name.length > 4) return false;
  if (PERSON_BLACKLIST.has(name)) return false;
  if (RESPECT_PATTERN.test(name)) return true;
  return PERSON_NAME_REGEX.test(name);
}

/** 第二层：实体过滤 — 类型白名单 + 黑名单 + 人名正则 */
function filterEntities(entities: LLMExtractedEntity[]): LLMExtractedEntity[] {
  const seen = new Set<string>();
  const result: LLMExtractedEntity[] = [];

  for (const e of entities) {
    // 类型白名单
    if (!TYPE_ALLOWED.has(e.type)) continue;
    // 去重
    const key = e.type + ':' + e.name;
    if (seen.has(key)) continue;
    seen.add(key);
    // 第三层：person类型人名正则校验
    if (e.type === 'person') {
      if (!isValidPersonName(e.name)) continue;
    }
    result.push(e);
  }
  return result;
}


/** 会话缓存：输入文本 → 实体列表，3分钟TTL，上限200条 */
const _entityCache = new Map<string, { result: LLMExtractedEntity[]; expiresAt: number }>();
const _CACHE_TTL = 180_000;

function _cacheGet(key: string): LLMExtractedEntity[] | null {
  const entry = _entityCache.get(key) as any;
  if (entry && entry.expiresAt > Date.now()) return entry.result as LLMExtractedEntity[];
  _entityCache.delete(key);
  return null;
}

function _cacheSet(key: string, result: LLMExtractedEntity[]): void {
  _entityCache.set(key, { result, expiresAt: Date.now() + _CACHE_TTL });
  if (_entityCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _entityCache) {
      if (v.expiresAt <= now) _entityCache.delete(k);
    }
  }
}

// ─── 第一层：Prompt强约束 ───

const EXTRACT_PROMPT = `任务规则：
1. 仅识别三类实体：person真实人名、emotion情绪词、event具体事件；
2. person仅保留人类姓名（2字/3字人名、职场称谓如张总、王经理），地点、物品、场所一律禁止标记为person；
3. 无对应实体则entities为空数组，禁止编造不存在实体；
4. 只输出纯净JSON，不能加解释、注释、换行说明文字。

输出模板：{"entities":[{"name":"内容","type":"person/emotion/event"}]}`;

// ─── 工具函数 ───

function extractJSON(text: string): string | null {
  const jsonBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlock) return jsonBlock[1].trim();
  const jsonObj = text.match(/\{[\s\S]*"entities"[\s\S]*\}/);
  if (jsonObj) return jsonObj[0];
  return null;
}

function normalizeType(type: string): EntityType {
  const lower = type.toLowerCase().trim();
  const map: Record<string, EntityType> = {
    person: 'person', 人名: 'person',
    emotion: 'emotion', 情绪: 'emotion', 情感: 'emotion',
    event: 'event', 事件: 'event',
  };
  return map[lower] || 'emotion';
}

// ─── 兜底正则词库（LLM超时降级用） ───

const REGEX_FALLBACK_RULES: Array<{ type: EntityType; patterns: RegExp[] }> = [
  { type: 'person', patterns: [
    /(?:妈妈|爸爸|妈|爸|爷爷|奶奶|外公|外婆|哥哥|弟弟|姐姐|妹妹|老公|老婆|男朋友|女朋友|同事|同学|朋友|老板|上司|领导|亲戚|姑姑|舅舅|阿姨|叔叔|室友|搭档|合伙人|邻居|客户|下属|徒弟|师父|师傅|医生|老师|学生|顾问)/,
  ]},
  { type: 'emotion', patterns: [
    /(?:开心|快乐|难过|伤心|痛苦|焦虑|抑郁|孤独|失落|崩溃|愤怒|生气|烦躁|害怕|紧张|喜欢|爱|思念|感动|幸福|满足|委屈|压力|累|无聊|倦)/,
  ]},
  { type: 'event', patterns: [
    /(?:结婚|工作|上班|考试|面试|搬家|旅行|旅游|聚会|吵架|分手|约会|加班|跑步|散步|失眠|健身|运动|吃饭|睡觉|学习|看书|唱歌|画画|跳舞|开会|出差)/,
  ]},
];

function regexFallback(text: string): LLMExtractedEntity[] {
  const seen = new Set<string>();
  const result: LLMExtractedEntity[] = [];
  for (const rule of REGEX_FALLBACK_RULES) {
    for (const re of rule.patterns) {
      const match = text.match(re);
      if (match && !seen.has(match[0])) {
        seen.add(match[0]);
        result.push({ name: match[0], type: rule.type });
      }
    }
  }
  // 正则结果跳过人名校验（已是预验证的）
  const dedup = new Set<string>();
  const final: LLMExtractedEntity[] = [];
  for (const e of result) {
    if (!TYPE_ALLOWED.has(e.type)) continue;
    const k = e.type + ":" + e.name;
    if (dedup.has(k)) continue;
    dedup.add(k);
    final.push(e);
  }
  return final;
}

// ─── 主入口 ───

/**
 * 三层过滤的 LLM 实体提取
 *
 * @param text - 用户原始输入
 * @param llmGenerate - LLM 生成函数（可选）
 * @returns 过滤后的实体列表
 */
export async function extractEntitiesLLM(
  text: string,
  llmGenerate?: (prompt: string) => Promise<string>
): Promise<LLMExtractedEntity[]> {
  if (!llmGenerate || !text || text.length < 2) return [];

  // 缓存命中直接返回（仅缓存有结果的，空结果不缓存）
  const _ck = text.substring(0, 120);
  const _cc = _cacheGet(_ck);
  if (_cc) { console.log('[LLMEntity] 缓存: ' + _cc.length + ' 实体'); return _cc; }

  // 构建极简强约束 Prompt
  const prompt = EXTRACT_PROMPT + '\n\n待处理文本：' + text + '\n\n输出模板：{"entities":[{"name":"内容","type":"person/emotion/event"}]}';

  try {
    const result = await Promise.race([
      llmGenerate(prompt),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('entity extract timeout')), 5000)
      ),
    ]);

    const jsonStr = extractJSON(result);
    if (!jsonStr) return regexFallback(text);

    const parsed = JSON.parse(jsonStr);
    if (parsed?.entities && Array.isArray(parsed.entities)) {
      const raw = parsed.entities
        .filter((e: any) => e && typeof e.name === 'string' && e.name.length > 0 && e.type)
        .map((e: any) => ({ name: e.name, type: normalizeType(e.type) }));
      // 第二层+第三层过滤
      const filtered = filterEntities(raw);
      if (filtered.length > 0) { _cacheSet(_ck, filtered); return filtered; }
    }
  } catch {
    // 超时/失败 → 正则兜底
  }

  const _fb = regexFallback(text);
  if (_fb.length > 0) _cacheSet(_ck, _fb);
  return _fb;
}
