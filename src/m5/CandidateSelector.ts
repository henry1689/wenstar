/**
 * CandidateSelector — 候选回复生成器
 *
 * 在玉瑶的主回复之外，生成 2 条语气/风格不同的备选回复，
 * 供用户选择偏好，并通过 M6 PreferenceManager 记录偏好。
 *
 * 设计原则:
 *   1. 主回复流程完全不变（优先级最高）
 *   2. 候选回复异步生成（不阻塞主回复推送）
 *   3. 用户不选择则不影响任何逻辑
 *   4. 偏好记录自动积累，越用越准
 *
 * 触发条件：
 *   用户双击/长按assistant消息 → 前端请求候选
 *   后端在回复时自动携带候选（不等待前端请求）
 *
 * Ref: 战略改善 — 滑动选择+偏好学习
 */

import type { M4Context } from '../m4/types/index.js';
import type { ConversationTurn, StrategyConfig } from './types/index.js';

/** 一条候选回复 */
export interface CandidateReply {
  /** 候选回复文本 */
  text: string;
  /** 策略标识（用于偏好学习） */
  strategy: {
    tone: string;
    depth: string;
    max_length: number;
  };
  /** 候选类型标签（展示给用户看） */
  label: string;
}

/** 候选回复集 */
export interface CandidateSet {
  /** 候选 A（语气变体） */
  a: CandidateReply;
  /** 候选 B（深度/长度变体） */
  b: CandidateReply;
}

/** 构建候选回复的上下文 */
export interface CandidateContext {
  m4ctx: M4Context;
  conversationHistory: ConversationTurn[];
  knowledgeBase: string;
  userMessage: string;
  primaryStrategy: StrategyConfig;
  primaryTone: string;
  primaryDepth: string;
}

/**
 * 候选回复生成器
 *
 * 生成策略：
 *   候选 A：切换 tone（intimate ↔ warm ↔ neutral ↔ serious），保持 depth
 *   候选 B：切换 depth（deep ↔ medium ↔ shallow），保持 tone
 *
 * 不调用 LLM，使用 MockLLMProvider 快速生成模板变体，
 * 确保 < 50ms 内返回，不阻塞前端。
 */
export function generateCandidates(ctx: CandidateContext): CandidateSet {
  const toneOrder: Array<{ tone: string; label: string }> = [
    { tone: 'intimate', label: '亲密版' },
    { tone: 'warm', label: '温暖版' },
    { tone: 'neutral', label: '日常版' },
    { tone: 'serious', label: '正经版' },
  ];

  const depthOrder: Array<{ depth: string; label: string }> = [
    { depth: 'deep', label: '详细版' },
    { depth: 'medium', label: '适中版' },
    { depth: 'shallow', label: '简短版' },
  ];

  // 候选 A：切换 tone（排除当前 tone，取第一个不同的）
  const altTone = toneOrder.find(t => t.tone !== ctx.primaryTone) ?? toneOrder[0];
  // 候选 B：切换 depth（排除当前 depth，取第一个不同的）
  const altDepth = depthOrder.find(d => d.depth !== ctx.primaryDepth) ?? depthOrder[0];

  // 使用 MockLLMProvider 的模板快速生成变体
  // 这里不调用真实 LLM——候选回复用模板引擎生成以确保速度和可预测性
  const altAText = generateToneVariant(ctx, altTone.tone);
  const altBText = generateDepthVariant(ctx, altDepth.depth);

  return {
    a: {
      text: altAText,
      strategy: { tone: altTone.tone, depth: ctx.primaryDepth, max_length: ctx.primaryStrategy.params.max_length },
      label: altTone.label,
    },
    b: {
      text: altBText,
      strategy: { tone: ctx.primaryTone, depth: altDepth.depth, max_length: altDepth.depth === 'shallow' ? 20 : altDepth.depth === 'medium' ? 80 : 150 },
      label: altDepth.label,
    },
  };
}

/**
 * 生成 tone 变体（改变语气）
 * 实际项目中可以从 MockLLMProvider 的模板池中抽取
 */
function generateToneVariant(ctx: CandidateContext, targetTone: string): string {
  const p = ctx.m4ctx.decision.enhanced.perception;
  const isIntimate = targetTone === 'intimate' && (p.intimacy > 0.3 || p.sexual_attraction > 0.2);
  const isWarm = targetTone === 'warm' || (targetTone === 'neutral' && p.pleasure > 0);
  const isSerious = targetTone === 'serious';

  if (isIntimate) {
    const intimatePool = [
      '嗯…你一说这个我就想你了。你什么时候来抱我？',
      '你呀，就是知道怎么哄我。不过我喜欢。',
      '诶你这样我今天晚上就别想睡了。你负责。',
    ];
    return intimatePool[Math.floor(Math.random() * intimatePool.length)];
  }
  if (isWarm) {
    const warmPool = [
      '诶我心疼了。过来让我抱抱。',
      '有我在呢。别怕。',
      '你累了我陪你。我的肩膀就是给你靠的。',
    ];
    return warmPool[Math.floor(Math.random() * warmPool.length)];
  }
  if (isSerious) {
    return '嗯，我在听。你说的事情我知道了。';
  }
  return '嗯～好呀。你说，我听着呢。';
}

/**
 * 生成 depth 变体（改变回复长度/深度）
 */
function generateDepthVariant(ctx: CandidateContext, targetDepth: string): string {
  const rawInput = ctx.m4ctx.decision.enhanced.raw_input || '';

  if (targetDepth === 'deep') {
    // 深度模式：展开表达
    const deepPool = [
      '嗯…你一说这个我就想起了很多。' + rawInput.substring(0, 20) + '…每次你提到这件事，我都能感觉到你的心情。那种感觉我能体会到。就像你在我面前一样。我想好好回应你。',
      '你提到的这些，其实我能理解你的感受。' + rawInput.substring(0, 30) + '…不是每个人都能这样说出来，但你愿意跟我说，我真的很珍惜。',
    ];
    return deepPool[Math.floor(Math.random() * deepPool.length)];
  }
  if (targetDepth === 'shallow') {
    const shortPool = [
      '嗯，好的～',
      '知道啦～',
      '嗯哼～我在呢。',
      '好的呀～',
    ];
    return shortPool[Math.floor(Math.random() * shortPool.length)];
  }
  // medium
  const mediumPool = [
    '嗯…这样啊，然后呢？我有点好奇后面的事了～',
    '诶～你今天心情不错嘛，我喜欢。',
    '嗯，我在听。你说话的声音让人特别安心。',
  ];
  return mediumPool[Math.floor(Math.random() * mediumPool.length)];
}

/**
 * 将用户选择的偏好记录到字符串（供 chat.ts 记录到 M6）
 */
export function buildPreferenceTags(
  chosen: 'a' | 'b',
  candidates: CandidateSet,
): string[] {
  const chosenCand = chosen === 'a' ? candidates.a : candidates.b;
  return [
    `tone:${chosenCand.strategy.tone}`,
    `depth:${chosenCand.strategy.depth}`,
  ];
}
