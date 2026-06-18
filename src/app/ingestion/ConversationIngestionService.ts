/**
 * ConversationIngestionService — 对话→知识自动沉淀服务
 *
 * 在聊天对话结束后，扫描用户消息中的个人信息、习惯、偏好等，
 * 自动提取并写入 knowledge_base，完成"对话即知识"的闭环。
 *
 * 设计原则:
 *   1. 纯规则驱动，无 LLM
 *   2. 高置信度模式直接入库（auto-classify）
 *   3. 低置信度标记 classification_pending=1，待玉瑶反问确认
 *   4. 不修改对话历史，不做侵入式处理
 */

import type { KnowledgeItem } from '../knowledge/types.js';

export interface IngestionCandidate {
  title: string;
  content: string;
  source_type: string;
  tags: string[];
  /** 交互型分类 */
  interaction_type: string;
  /** 关联场景标签 */
  scene_tags?: string[];
  /** 知识分类（传此值则直接入库，不标记 pending） */
  classification?: string;
  /** 是否高置信度（true=直接入库，false=待分类） */
  confident: boolean;
}

// ─── 抽取规则 ───

/**
 * 从一段用户消息中提取可沉淀的知识候选项。
 * 每条规则返回 IngestionCandidate | null。
 */

type Rule = (message: string, sceneTags?: string[]) => IngestionCandidate | null;

/** 规则1: 个人偏好 — "我喜欢/我超爱/我最爱 XXX" */
const rulePreference: Rule = (msg) => {
  const m = msg.match(/(?:我喜欢|我超爱|我最爱|我最喜欢|我特别[喜欢爱])(.{2,25}?)(?:[，。！？蛋了]|$)/);
  if (!m) return null;
  let pref = m[1].trim().replace(/[的了的]$/, '');
  // "喝咖啡" → keep; "咖啡了" → "咖啡"
  pref = pref.replace(/^(就|都|还|也|只)/, '');
  if (pref.length < 2) return null;
  return {
    title: `喜好: ${pref}`,
    content: `用户喜欢${pref}`,
    source_type: 'conversation',
    tags: ['auto-ingested', 'preference'],
    interaction_type: 'preference',
    scene_tags: ['偏好'],
    classification: '用户偏好',
    confident: true,
  };
};

/** 规则2: 个人习惯 — "我每X/我每周/我平时/我经常" */
const ruleHabit: Rule = (msg) => {
  const m = msg.match(/(?:我每[天周月年]|我平时|我经常|我习惯|我固定)(.{2,30}?)(?:[，。！？蛋]|$)/);
  if (!m) return null;
  const habit = m[1].trim().replace(/[的了]$/, '');
  if (habit.length < 2) return null;
  // Clean up prefix: "三健身三次" → "健身三次"
  // Remove leading time specifiers + pronouns
  const clean = habit.replace(/^[三四周末天早中晚我你他她]{0,2}/, '');
  return {
    title: `习惯: ${clean.substring(0, 20)}`,
    content: `用户${m[0]}`,
    source_type: 'conversation',
    tags: ['auto-ingested', 'habit'],
    interaction_type: 'conversation',
    scene_tags: ['日常', '习惯'],
    classification: '生活记录',
    confident: true,
  };
};

/** 规则3: 用户计划 — "我打算/我计划/我准备/我想去/我想要/我要"（未来时态） */
const rulePlan: Rule = (msg) => {
  const m = msg.match(/(?:我打算|我计划|我准备|我想去|我想要|我要去)(.{2,30}?)(?:[，。！？]|$)/);
  if (!m) return null;
  const plan = m[1].trim().replace(/[的了]$/, '');
  if (plan.length < 2) return null;
  return {
    title: `计划: ${plan.substring(0, 20)}`,
    content: `用户计划${m[0]}`,
    source_type: 'conversation',
    tags: ['auto-ingested', 'plan'],
    interaction_type: 'conversation',
    scene_tags: ['计划'],
    confident: false, // 计划可能变化，低置信度
  };
};

/** 规则4: 个人属性 — "我是XXX"、"我住在"、"我在XXX工作" */
const ruleIdentity: Rule = (msg) => {
  const m1 = msg.match(/我是([^的]{1,10}(?:的|人|工作者|师|生|员|者))/);
  const m2 = msg.match(/我[在住](.{2,20}?)(?:[，。！？]|$)/);
  const m3 = msg.match(/我老家(.{2,20})/);
  const m = m1 || m2 || m3;
  if (!m) return null;
  const identity = (m[1] || m[0]).trim();
  if (identity.length < 2) return null;
  return {
    title: `用户信息: ${identity.substring(0, 20)}`,
    content: identity,
    source_type: 'conversation',
    tags: ['auto-ingested', 'identity'],
    interaction_type: 'profile',
    scene_tags: ['个人'],
    classification: '用户资料',
    confident: true,
  };
};

/** 规则5: 回忆/记忆 — "我记得XXX"、"有一次" */
const ruleMemory: Rule = (msg) => {
  const m = msg.match(/(?:我记得|有一次|之前有一次|以前.{2,10}时候)(.{4,60})/);
  if (!m) return null;
  const memory = m[1].trim();
  if (memory.length < 4) return null;
  return {
    title: `回忆: ${memory.substring(0, 20)}`,
    content: m[0],
    source_type: 'conversation',
    tags: ['auto-ingested', 'memory'],
    interaction_type: 'conversation',
    scene_tags: ['回忆'],
    confident: false, // 回忆需要确认准确性
  };
};

// ─── 规则列表 — 按优先级排序 ───

const RULES: Rule[] = [
  rulePreference,
  ruleHabit,
  ruleIdentity,
  rulePlan,
  ruleMemory,
];

// ─── 主要接口 ───

/**
 * 扫描一段用户消息，返回所有可沉淀的知识候选项。
 * 每条规则独立执行，不冲突去重（同一消息可产生多条知识）。
 */
export function extractCandidates(message: string, sceneTags?: string[]): IngestionCandidate[] {
  if (!message || message.length < 4) return [];
  const candidates: IngestionCandidate[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    try {
      const c = rule(message, sceneTags);
      if (c && !seen.has(c.title)) {
        seen.add(c.title);
        // 注入场景标签
        if (sceneTags?.length) {
          c.scene_tags = [...new Set([...(c.scene_tags ?? []), ...sceneTags])];
        }
        candidates.push(c);
      }
    } catch {
      // 单条规则失败不影响后续
    }
  }

  return candidates;
}

/**
 * 提取并直接存入知识库（由 chat.ts 在对话结束后调用）。
 * 返回本次新入库的条目数。
 */
export async function ingestFromConversation(
  message: string,
  knowledgeEngine: any,
  sceneTags?: string[],
  perception?: { pleasure: number; arousal: number; intimacy: number },
  dnaId?: string,
): Promise<number> {
  const candidates = extractCandidates(message, sceneTags);
  let count = 0;

  for (const c of candidates) {
    // 去重: 检查标题是否已存在
    const existing = await knowledgeEngine.search(c.title.substring(0, 15), 1);
    if (existing.length > 0) continue;

    try {
      await knowledgeEngine.add({
        title: c.title,
        content: c.content,
        source_type: c.source_type,
        tags: c.tags,
        interaction_type: c.interaction_type,
        scene_tags: c.scene_tags,
        classification: c.confident ? c.classification : undefined,
        emotionalContext: perception,
        dna_id: dnaId,
      });
      count++;
      console.log(`[Ingestion] 自动入库: ${c.title} (${c.interaction_type}, 置信=${c.confident})`);
    } catch (err) {
      console.warn(`[Ingestion] 入库失败: ${c.title}`, err);
    }
  }

  return count;
}
