/**
 * RoleClassifier — 话题分类器（规则驱动，零 LLM）
 *
 * 根据用户消息 + M3 24D 感知 + 实体，将当前对话分类到 5 个角色之一。
 * 规则命中即返回，优先级从高到低。
 *
 * 输出：{ role: RoleType, confidence: number, rule: string }
 */
import type { Perception24D } from '../../m3/types/perception.js';
import type { EntityGene } from '../../m1/types/dna.js';

export type RoleType = 'secretary' | 'lover' | 'counselor' | 'strategist' | 'recaller';

export interface RoleDecision {
  role: RoleType;
  confidence: number;
  rule: string;
}

export interface RoleClassifierInput {
  message: string;
  perception: Perception24D;
  entities: EntityGene[];
  /** 上一轮角色（用于连续性） */
  previousRole?: RoleType;
  /** 连续亲密消息计数（用于工作→亲密切换防误判） */
  consecutiveIntimateCount: number;
}

// ─── 工作关键词（38+ 技术词） ───
const WORK_KEYWORDS = /工作|项目|客户|会议|方案|报告|公司|合同|预算|数据|分析|策略|设计|电机|采购|成本|温升|版本|产品|技术|报价|订单|生产|测试|样品|图纸|规格|性能|参数|工程|研发|工艺|质量|供应商|业务|跟单|交货|协调|对接|审核|审批|流程/;

// ─── 亲密关键词 ───
const INTIMATE_KEYWORDS = /想你了|抱我|吻我|亲我|摸我|操我|干我|要你|想要|好想要|想你|抱抱|亲亲|回来|睡不着|怀里|怀里|搂|贴|蹭|吻|亲|抱|摸|爱|你/;

// ─── 人物查询关键词 ───
const RECALL_KEYWORDS = /记得.*吗|还记得|你记不记得|是不是.*那个|那个.*叫什么|是什么人|长什么样|还记.*吗|有印象吗/;

// ─── 商业分析关键词 ───
const STRATEGY_KEYWORDS = /分析|建议|方案|策略|评估|对比|趋势|风险|成本|收益|ROI|市场|竞争力|优势|劣势|SWOT|数据|报告|总结|归纳|梳理|盘点/;

/**
 * 分类器主入口
 * 规则命中即返回，优先级从高到低。
 */
export function classify(input: RoleClassifierInput): RoleDecision {
  const { message, perception, entities, previousRole, consecutiveIntimateCount } = input;
  const p = perception;

  // ① 角色扮演检测（最高优先级）
  if (/扮演|模仿|演/.test(message)) {
    return { role: 'recaller', confidence: 0.9, rule: 'roleplay_detected' };
  }

  // ② 人物查询检测
  const hasPersonEntity = entities.some(g => g.type === 'person' && g.name !== '我' && g.name.length > 1);
  if (RECALL_KEYWORDS.test(message) && hasPersonEntity) {
    return { role: 'recaller', confidence: 0.85, rule: 'person_query' };
  }

  // ③ 工作检测（技术词 + factual>0.4 + intimacy<0.3）
  const isWork = WORK_KEYWORDS.test(message) || p.factual > 0.4;
  const isLowIntimacy = p.intimacy < 0.3;
  if (isWork && isLowIntimacy) {
    // 检测是否包含商业分析关键词
    if (STRATEGY_KEYWORDS.test(message)) {
      return { role: 'strategist', confidence: 0.8, rule: 'business_analysis' };
    }
    return { role: 'secretary', confidence: 0.85, rule: 'work_keywords' };
  }

  // ④ 亲密检测
  const isIntimate = p.intimacy > 0.3 || p.sexual_attraction > 0.2 || INTIMATE_KEYWORDS.test(message);
  if (isIntimate) {
    // 工作→亲密：需连续 2 条才切换（防误判）
    if (previousRole === 'secretary' || previousRole === 'strategist') {
      if (consecutiveIntimateCount < 2) {
        return { role: previousRole || 'secretary', confidence: 0.5, rule: 'intimate_pending_2nd' };
      }
    }
    return { role: 'lover', confidence: 0.9, rule: 'intimate_detected' };
  }

  // ⑤ 情绪检测
  if (p.pleasure < -0.2 && p.intimacy < 0.3) {
    return { role: 'counselor', confidence: 0.75, rule: 'emotional_distress' };
  }

  // ⑥ 商业分析（无工作词但有分析意图）
  if ((STRATEGY_KEYWORDS.test(message) || p.factual > 0.5) && p.intimacy < 0.3) {
    return { role: 'strategist', confidence: 0.7, rule: 'analytical_query' };
  }

  // ⑦ 默认：延续上一轮，无双关则 secretary
  if (previousRole) {
    return { role: previousRole, confidence: 0.6, rule: 'continuation' };
  }
  return { role: 'secretary', confidence: 0.6, rule: 'default_safe' };
}
