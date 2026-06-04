/**
 * RelationshipExtractor — 人际关系图谱提取器
 *
 * 从聊天文本中检测人际关系描述，自动提取并存储到知识库。
 * 同时写入 SQLite entity_relations 表，支持图谱遍历。
 */
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';

/** 中文关系词映射表 */
const RELATION_MAP: Record<string, string> = {
  '朋友': '朋友', '哥们': '朋友', '兄弟': '朋友', '闺蜜': '朋友',
  '同事': '同事', '同学': '同学', '同窗': '同学',
  '老板': '老板', '上司': '上司', '领导': '领导',
  '老公': '配偶', '老婆': '配偶', '妻子': '配偶', '丈夫': '配偶',
  '男朋友': '恋人', '女朋友': '恋人', '男友': '恋人', '女友': '恋人',
  '爸爸': '父亲', '父亲': '父亲', '爹': '父亲',
  '妈妈': '母亲', '母亲': '母亲', '娘': '母亲',
  '儿子': '儿子', '女儿': '女儿', '孩子': '子女',
  '哥哥': '兄弟', '弟弟': '兄弟', '姐': '姐妹', '妹妹': '姐妹',
  '爷爷': '祖父', '奶奶': '祖母',
  '老师': '老师', '师父': '师父',
  '邻居': '邻居', '房东': '房东', '室友': '室友',
  '合伙人': '合伙人', '搭档': '搭档',
};

export interface DetectedRelationship {
  personName: string;
  relation: string;
  rawRelation: string;
  context: string;
}

/** 常见姓氏前300 */
const SURNAMES = new Set(
  '赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公'
);

function isName(text: string): boolean {
  return text.length >= 2 && text.length <= 3 && SURNAMES.has(text[0]);
}

/** 名字后紧跟这些字说明不是名字的完整部分 */
const TRAILING_STOP = new Set('昨今明去来也和就都在这那而已了过');

/** 提取名字的核心逻辑：取前2-3个字，去掉末尾停用字 */
function extractName(raw: string): string | null {
  if (raw.length === 0) return null;
  // 取最多3个字
  const candidate = raw.substring(0, 3);
  if (candidate.length < 2) return null;

  // 先试3个字（前提是第三个字不是停用字）
  if (candidate.length === 3 && !TRAILING_STOP.has(candidate[2]) && isName(candidate)) return candidate;

  // 试前2个字
  const two = candidate.substring(0, 2);
  if (isName(two)) return two;

  return null;
}

export function extractRelations(text: string): DetectedRelationship[] {
  const results: DetectedRelationship[] = [];
  const seen = new Set<string>();

  for (const [relWord, stdRelation] of Object.entries(RELATION_MAP)) {
    let idx = 0;
    while ((idx = text.indexOf(relWord, idx)) >= 0) {
      // 模式A: "XXX是我朋友" / "王建国是我老板" / "张明是我同事"
      const beforeText = text.slice(Math.max(0, idx - 5), idx);
      const beforeMatch = beforeText.match(/([一-龥]{2,3})是我$/);
      if (beforeMatch) {
        const name = beforeMatch[1];
        if (!seen.has(`${name}:${stdRelation}`) && isName(name)) {
          seen.add(`${name}:${stdRelation}`);
          results.push({ personName: name, relation: stdRelation, rawRelation: relWord, context: text.slice(Math.max(0, idx - 10), idx + relWord.length + 5) });
          idx++;
          continue;
        }
      }

      // 模式B: "我朋友XXX" / "我同事XXX"
      const afterText = text.slice(idx + relWord.length);
      // "叫"或"是"是可选的连接词
      const afterClean = afterText.replace(/^(叫|是)/, '');
      const name = extractName(afterClean);
      if (name && !seen.has(`${name}:${stdRelation}`)) {
        seen.add(`${name}:${stdRelation}`);
        results.push({ personName: name, relation: stdRelation, rawRelation: relWord, context: text.slice(Math.max(0, idx - 3), idx + relWord.length + name.length + 3) });
      }

      idx++;
    }
  }

  return results;
}

export function storeRelations(sqlite: any, relations: DetectedRelationship[], sourceMessage: string): number {
  let stored = 0;
  const now = new Date().toISOString();

  for (const rel of relations) {
    try {
      sqlite.writeRaw(`INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)`, rel.personName, 'person');
      sqlite.writeRaw(`INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)`, '我', 'self');
      const aRows = sqlite.queryAll(`SELECT id FROM entities WHERE name = ? AND type = ?`, ['我', 'self']);
      const bRows = sqlite.queryAll(`SELECT id FROM entities WHERE name = ? AND type = ?`, [rel.personName, 'person']);
      if (aRows.length > 0 && bRows.length > 0) {
        sqlite.writeRaw(`INSERT OR REPLACE INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (?, ?, ?, ?, ?)`, aRows[0].id, bRows[0].id, rel.relation, 0.8, now);
      }
    } catch (err) { console.warn('[Relation] 图谱写入失败:', err); }

    try {
      const id = `rel_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
      sqlite.writeRaw(`INSERT INTO knowledge_base (id, title, content, source_type, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        id, `人际关系: ${rel.personName}`, `${rel.personName} 是我的${rel.rawRelation}。${sourceMessage}`, 'relation',
        JSON.stringify([`relation:${rel.relation}`, `person:${rel.personName}`]), now, now);
      stored++;
    } catch (err) { console.warn('[Relation] 知识库写入失败:', err); }
  }
  return stored;
}
