/**
 * EntityValidator — 实体校验器（可配置）
 *
 * 家族图谱写入前统一校验实体有效性：
 * - 实体校验：过滤噪音词
 * - 关系校验：只允许预定义关系类型
 * - 去重校验：已存在只更新不重复创建
 */

// 噪音词黑名单（长度≥2 但无实际语义的词汇，从图谱中观察到的脏数据提炼）
const NOISE_WORDS = new Set([
  '那么快','平常我','和姐姐','周都去','方便现','老院','家人们','段很好',
  '左右','周二','周都','陈斌','方的','时你','管你','老想','单员','女儿',
  '简称嘛','小学','平常人','小镇','阴历','农历','周说','金库','项目在',
  '水彩画','从前','厉害','时我我','那一刻','那年','老婆','老公','妈妈',
  '爸爸','奶奶','爷爷','姐姐','妹妹','弟弟','哥哥',
  '公公','婆婆','岳父','岳母','外公','外婆',
  '应该','时候','强度','索引','关联','相遇','相似','职责','这里','那里',
]);

/** 常见中文姓氏（前300） */
const SURNAMES = new Set(
  '赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐'
);

// 预定义关系类型白名单
export const ALLOWED_RELATIONS = new Set([
  // 家族边
  'mother_of','father_of','parent_of','child_of','spouse_of','sibling_of',
  'grandfather_of','grandmother_of','grandchild_of',
  // 社交边
  'colleague_of','classmate_of','friend_of','client_of','boss_of',
  'subordinate_of','partner_of','neighbor_of','teacher_of','student_of',
  'doctor_of','consultant_of','acquaintance_of',
  // 特征边
  'has_trait','lives_in',
]);

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export const EntityValidationRules = {
  /** 最小字符数 */
  minLength: 2,
  /** 最大字符数 */
  maxLength: 5,
  /** 噪音词黑名单 */
  noiseWords: NOISE_WORDS,
  /** 关系类型白名单 */
  allowedRelations: ALLOWED_RELATIONS,
  /** 是否要求姓氏检测（人名必须含常见姓氏） */
  requireSurname: true,
};

/**
 * 校验人物实体名称是否有效
 */
export function validatePersonName(name: string): ValidationResult {
  if (!name || name.length < EntityValidationRules.minLength) {
    return { valid: false, reason: '长度不足' };
  }
  if (name.length > EntityValidationRules.maxLength) {
    return { valid: false, reason: '长度超过上限' };
  }
  if (EntityValidationRules.noiseWords.has(name)) {
    return { valid: false, reason: '噪音词' };
  }
  if (EntityValidationRules.requireSurname) {
    // 2字名必须含姓氏 | 3字名首字必须含姓氏
    const hasSurname = SURNAMES.has(name[0]);
    if (!hasSurname) {
      return { valid: false, reason: '无常见姓氏' };
    }
  }
  return { valid: true };
}

/**
 * 校验关系类型是否在预定义白名单中
 */
export function validateRelationType(relation: string): ValidationResult {
  if (!relation) return { valid: false, reason: '关系为空' };
  if (ALLOWED_RELATIONS.has(relation)) return { valid: true };
  // 允许中文关系类型（如"认识的人""同事""朋友"等）
  if (/^[一-鿿]{2,4}$/.test(relation)) return { valid: true };
  return { valid: false, reason: `非法关系类型: ${relation}` };
}
