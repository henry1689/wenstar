/**
 * ImageParser — 图片摄入情感标签滤镜
 *
 * 基于 OCR 提取文本的关键词规则匹配，纯规则计算，零 AI。
 * 对图片内容自动标记情感/场景标签，写入 MD 笔记的 topic_tags。
 */

/** 预设情感标签规则（命中任意关键词即叠加对应标签） */
const TAG_RULES: Array<{ keywords: RegExp; tags: string[] }> = [
  {
    keywords: /美食|菜品|餐厅|好吃|吃饭|探店|甜点|奶茶|外卖|烹饪|厨房|厨艺|菜谱/,
    tags: ['#美食', '#分享欲', '#日常碎片'],
  },
  {
    keywords: /风景|旅行|海边|山顶|想去|景区|日落|雪山|大海|沙滩|日出|山水|旅游|出游/,
    tags: ['#想去的地方', '#旅行憧憬'],
  },
  {
    keywords: /工作|方案|会议|代码|文档|报表|需求|评审|项目|方案|设计稿|原型|流程图|架构/,
    tags: ['#工作资料', '#技术沉淀'],
  },
  {
    keywords: /家人|家庭|宝宝|孩子|父母|全家|聚会|团圆|生日|纪念日/,
    tags: ['#家庭记忆', '#温馨时刻'],
  },
  {
    keywords: /运动|健身|跑步|瑜伽|锻炼|骑行|游泳|打球/,
    tags: ['#运动健康', '#生活日常'],
  },
  {
    keywords: /阅读|读书|书|学习|课程|笔记|知识|培训|考试/,
    tags: ['#学习成长', '#知识积累'],
  },
];

/** 兜底标签 — 无文字或未命中任何关键词时使用 */
const DEFAULT_TAGS = ['#生活记录'];

/**
 * 基于 OCR 文本分析图片内容，返回匹配的情感/场景标签
 * @param ocrText OCR 提取的文本内容（可能为空字符串）
 * @returns 匹配的标签数组
 */
export function analyzeImageTags(ocrText: string): string[] {
  if (!ocrText || ocrText.trim().length === 0) {
    return [...DEFAULT_TAGS];
  }

  const matchedTags: Set<string> = new Set();
  for (const rule of TAG_RULES) {
    if (rule.keywords.test(ocrText)) {
      for (const tag of rule.tags) {
        matchedTags.add(tag);
      }
    }
  }

  if (matchedTags.size === 0) {
    return [...DEFAULT_TAGS];
  }

  return [...matchedTags];
}
