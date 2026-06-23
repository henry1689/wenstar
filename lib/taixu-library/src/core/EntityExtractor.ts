/**
 * EntityExtractor — 实体提取（纯规则引擎）
 *
 * FMM 分词 + 规则匹配，与主程序 L3EntityAnnotator 逻辑一致。
 * 零外部依赖，不调用 LLM。
 */

export interface ExtractedEntity {
  name: string;
  type: 'person' | 'place' | 'event' | 'concept' | 'object';
  confidence: number;
}

interface EntityRule {
  pattern: RegExp;
  type: ExtractedEntity['type'];
  confidence: number;
}

// 常用中文姓氏（百家姓前 200）
const SURNAME_CHARS = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄麴家封羿储靳汲邴糜松井段富巫乌焦巴弓牧隗谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

const SURNAME_REGEX = new RegExp(`(?:[${SURNAME_CHARS}][一-鿿]{1,2})(?=[一-鿿\\s，。！？、,.!?\\n]|$)`, 'g');
const SURNAME_WITH_PREFIX_REGEX = new RegExp(`(?:老|小|阿)([${SURNAME_CHARS}])`, 'g');

const DEFAULT_RULES: EntityRule[] = [
  // 中文人名: 常见姓氏 + 1-2 字名
  { pattern: SURNAME_REGEX, type: 'person' as const, confidence: 0.8 },
  // 带称谓的人名: 老/小/阿+姓
  { pattern: SURNAME_WITH_PREFIX_REGEX, type: 'person' as const, confidence: 0.7 },
  // 地名: XX市/省/县/区/路
  { pattern: /(?:[一-鿿]{2,}(?:市|省|县|区|镇|乡|村|路|街|大道|胡同|巷|里|弄|花园|苑|大厦|广场|公园))/g, type: 'place' as const, confidence: 0.6 },
  // 事件: XX事件/事故/会议/活动
  { pattern: /(?:[一-鿿]{2,}(?:事件|事故|会议|活动|大会|仪式|典礼|行动|计划|方案))/g, type: 'event' as const, confidence: 0.5 },
  // 概念: 常见抽象名词
  { pattern: /(?:人工智能|机器学习|区块链|元宇宙|量子计算|云计算|大数据|物联网|5G|AI|算法|程序|代码|软件|硬件|网络|安全|加密|数字|智能|生态|系统|平台|模型|数据|信息|知识|理论|原理|法则|定律|效应)/g, type: 'concept' as const, confidence: 0.4 },
  // 书籍/作品名: 《》或「」
  { pattern: /[《「『]([一-鿿\w]{2,})[》」』]/g, type: 'concept' as const, confidence: 0.5 },
];

export class EntityExtractor {
  private rules: EntityRule[];

  constructor(rulesConfig?: EntityRule[]) {
    this.rules = rulesConfig ?? DEFAULT_RULES;
  }

  extract(text: string): ExtractedEntity[] {
    const entities: ExtractedEntity[] = [];
    const seenKeys = new Set<string>();

    for (const rule of this.rules) {
      const matches = text.matchAll(rule.pattern);
      for (const match of matches) {
        const name = match[0] || match[1] || '';
        if (!name || name.length < 2) continue;
        const key = `${rule.type}:${name}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        entities.push({ name, type: rule.type, confidence: rule.confidence });
      }
    }

    return entities;
  }

  /** 提取人名（快捷方法） */
  extractPersons(text: string): string[] {
    return this.extract(text)
      .filter(e => e.type === 'person')
      .map(e => e.name);
  }
}
