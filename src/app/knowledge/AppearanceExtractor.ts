/**
 * AppearanceExtractor — 外貌描述提取器
 *
 * 从用户消息中检测外貌描述，提取关键信息。
 * 纯规则驱动（零 LLM），正则匹配外貌特征词汇。
 *
 * 输出格式：
 *   "个子不高，皮肤白白的，圆脸，笑起来有酒窝，扎马尾"
 */
export interface AppearanceEntry {
  personName: string;
  description: string;
}

// ─── 外貌特征关键词库 ───
const APPEARANCE_WORDS = [
  // 身高体型
  '高', '矮', '瘦', '胖', '苗条', '纤细', '丰满', '匀称', '结实',
  // 面部
  '圆脸', '方脸', '瓜子脸', '鹅蛋脸', '娃娃脸', '大眼', '小眼', '双眼皮', '单眼皮',
  '高鼻梁', '酒窝', '眉毛', '睫毛', '皮肤', '白', '黑', '黄', '红润', '痘痘',
  // 发型
  '长发', '短发', '卷发', '直发', '马尾', '丸子头', '刘海', '染', '黑发', '黄发',
  // 整体
  '漂亮', '好看', '帅气', '可爱', '清秀', '美', '丑', '年轻', '显老',
  // 身体部位
  '胸', '奶子', '屁股', '腿', '腰', '肩', '手', '脚', '背', '臀',
  '大', '小', '翘', '细', '粗', '长', '短',
  // 穿着风格
  '工作服', '制服', '裙', '裤', '高跟鞋', '平底鞋',
];

const APPEARANCE_PATTERN = new RegExp(APPEARANCE_WORDS.join('|'));

/**
 * 检测消息是否包含外貌描述
 */
export function hasAppearanceDescription(text: string): boolean {
  return APPEARANCE_PATTERN.test(text);
}

/**
 * 从消息中提取外貌描述片段
 * 返回外貌相关的子句（去除不相关的部分）
 */
export function extractAppearanceFragments(text: string): string {
  if (!text) return '';

  // 按句子分割
  const sentences = text.split(/[，,。.！!？?；;]/);
  const relevant: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 2) continue;
    // 包含外貌词 → 保留
    if (APPEARANCE_PATTERN.test(trimmed)) {
      relevant.push(trimmed);
    }
  }

  return relevant.join('，');
}

/**
 * 从用户消息中提取某人物的外貌描述
 * @param message 用户消息全文
 * @param personName 人物名
 * @returns 外貌描述文本，若无则返回空字符串
 */
export function extractAppearanceForPerson(message: string, personName: string): string {
  if (!message || !personName) return '';

  // 如果消息中没提到这个人，不提取
  if (!message.includes(personName)) return '';

  // 提取外貌相关片段
  const fragments = extractAppearanceFragments(message);
  if (!fragments) return '';

  // 仅保留包含外貌特征的句子
  return fragments;
}

/**
 * 合并新的外貌描述到旧描述中（去重，追加新特征）
 */
export function mergeAppearance(existing: string | undefined | null, newDesc: string): string {
  if (!newDesc) return existing || '';
  if (!existing) return newDesc;

  // 简单去重：新描述中有的旧描述没有的词才追加
  const existingWords = new Set(existing.split(/[，,、\s]+/));
  const newParts: string[] = [];

  for (const part of newDesc.split(/[，,]/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // 检查这个特征是否已在旧描述中
    const isNew = !Array.from(existingWords).some(w => trimmed.includes(w) || w.includes(trimmed));
    if (isNew) {
      newParts.push(trimmed);
      trimmed.split(/[，,、\s]+/).forEach(w => existingWords.add(w));
    }
  }

  if (newParts.length === 0) return existing;
  return existing + '，' + newParts.join('，');
}
