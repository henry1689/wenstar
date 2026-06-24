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
 *
 * 🔴 铁律：亲密内容绝对禁止进入知识库 — 三道防线
 *   防线①: 感知级过滤 (ingestFromConversation 入口)
 *   防线②: 消息级关键词+白名单 (extractCandidates 入口)
 *   防线③: API 层冗余校验 (KnowledgeEngine.add 入口)
 *   所有阈值和关键词见 src/config/ingestion-guard.ts
 */

import type { KnowledgeItem } from '../knowledge/types.js';
import { INGESTION_GUARD } from '../../config/ingestion-guard.js';

// ─── 构建正则（从配置生成，支持白名单） ───

/** 关键词正则 — 全局匹配用 */
const KEYWORD_PATTERN = new RegExp(INGESTION_GUARD.intimateKeywords.join('|'));

/** 白名单正则 — 白名单词在消息中出现时降低拦截权重 */
const WHITELIST_PATTERN = new RegExp(INGESTION_GUARD.whitelistTerms.join('|'));

/** 感知阈值快捷引用 */
const PT = INGESTION_GUARD.perceptionThresholds;

// ─── 标准化拦截日志 ───

function logGuard(level: string, reason: string, detail: string): void {
  if (!INGESTION_GUARD.loggingEnabled) return;
  console.log(`[KnowledgeGuard] ${level} | ${reason} | ${detail}`);
}

/**
 * 检查消息是否命中亲密内容（关键词 + 白名单抵消）
 * 白名单中的词汇（如"生理""科普""医学"）可使消息免于拦截
 */
function isIntimateContent(message: string): { blocked: boolean; reason: string } {
  if (!KEYWORD_PATTERN.test(message)) return { blocked: false, reason: '' };

  // 白名单检测：如果消息包含白名单词（医学/生理/科普等），放行
  const hasWhitelist = WHITELIST_PATTERN.test(message);
  if (hasWhitelist) {
    return { blocked: false, reason: '白名单抵消' };
  }

  return { blocked: true, reason: `亲密关键词命中: ${message.substring(0, 30)}` };
}

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

type Rule = (message: string, sceneTags?: string[]) => IngestionCandidate | null;

/** 规则1: 个人偏好 — "我喜欢/我超爱/我最爱 XXX" */
const rulePreference: Rule = (msg) => {
  const m = msg.match(/(?:我喜欢|我超爱|我最爱|我最喜欢|我特别[喜欢爱])(.{2,25}?)(?:[，。！？蛋了]|$)/);
  if (!m) return null;
  let pref = m[1].trim().replace(/[的了的]$/, '');
  pref = pref.replace(/^(就|都|还|也|只)/, '');
  if (pref.length < 2) return null;
  // 白名单检查：如果提取的偏好词在白名单中，直接放行
  if (WHITELIST_PATTERN.test(pref)) {
    // 正常偏好，放行
  }
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

/** 规则3: 用户计划 — "我打算/我计划/我准备/我想去/我想要/我要" */
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
    confident: false,
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
    confident: false,
  };
};

// ─── 规则列表 ───

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
 * 防线②: 关键词+白名单过滤在入口层执行
 */
export function extractCandidates(message: string, sceneTags?: string[]): IngestionCandidate[] {
  if (!message || message.length < 4) return [];

  // 🔴 防线②: 消息级亲密检测（关键词 + 白名单抵消）
  const check = isIntimateContent(message);
  if (check.blocked) {
    logGuard('防线②', check.reason, `来源: conversation, 摘要: ${message.substring(0, 40)}`);
    return [];
  }

  const candidates: IngestionCandidate[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    try {
      const c = rule(message, sceneTags);
      if (c && !seen.has(c.title)) {
        seen.add(c.title);
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
 * 防线①: 感知级过滤在函数入口执行
 */
export async function ingestFromConversation(
  message: string,
  knowledgeEngine: any,
  sceneTags?: string[],
  perception?: { pleasure: number; arousal: number; intimacy: number },
  dnaId?: string,
): Promise<number> {
  // 🔴 防线①: 感知级过滤 — 从配置读取阈值
  if (perception) {
    const p = perception as any;
    if ((p.intimacy ?? 0) > PT.intimacy ||
        (p.sexual_attraction ?? 0) > PT.sexualAttraction ||
        (p.sensory_craving ?? 0) > PT.sensoryCraving) {
      logGuard('防线①', `感知阈值拦截`, `intimacy=${p.intimacy}, sexual=${p.sexual_attraction}, sensory=${p.sensory_craving}, 摘要: ${message.substring(0, 30)}`);
      return 0;
    }
  }

  const candidates = extractCandidates(message, sceneTags);
  let count = 0;

  for (const c of candidates) {
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
