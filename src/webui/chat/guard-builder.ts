// @ts-nocheck - S3-2 scaffolding, will be properly integrated after full refactor
/**
 * guard-builder — 角色路由 + 记忆门控 + Hallucination 守卫
 *
 * S3-2: 从 chat.ts 拆出的独立模块。
 * 职责：
 *   ① 角色分类与过渡管理（从 DeepSeekLLMProvider 上浮至此）
 *   ② MemoryGate 对话模式判定
 *   ③ Hallucination 幻觉校验
 */

import { type MemoryGateOutput, decideMode, buildGuard } from '../../app/conversation/MemoryGate.js';
import { classify, type RoleType } from '../../app/role/RoleClassifier.js';
import { evaluateTransition, createInitialState, type TransitionState } from '../../app/role/TransitionManager.js';
import type { DNA } from '../../m1/types/dna.js';
import type { M3Decision } from '../../m3/types/perception.js';
import type { ConversationTurn } from '../../m5/types/index.js';

export type { MemoryGateOutput, RoleType, TransitionState };

// ─── 角色路由状态（模块级，消除 DeepSeekLLMProvider 内的竞态）───

let _currentRole: RoleType = 'secretary';
let _transitionState: TransitionState = createInitialState();

export function getCurrentRole(): RoleType { return _currentRole; }
export function getTransitionState(): TransitionState { return _transitionState; }

/**
 * 分类当前角色，更新过渡状态
 */
export function classifyRole(
  message: string,
  perception: Record<string, number>,
  entities: Array<{ name: string; type: string }>,
): RoleType {
  const classified = classify({
    message,
    perception,
    entities,
    previousRole: _currentRole,
    consecutiveIntimateCount: _transitionState.consecutiveIntimate,
  });
  _transitionState = evaluateTransition(_transitionState, classified, message);
  _currentRole = _transitionState.currentRole;
  return _currentRole;
}

/**
 * 强制切换角色（用于重置）
 */
export function setRole(role: RoleType): void {
  _currentRole = role;
  _transitionState = createInitialState();
}

// ─── MemoryGate 守卫构建 ───

export interface GuardBuilderInput {
  message: string;
  dna: DNA;
  decision: M3Decision;
  conversationHistory: ConversationTurn[];
  isFollowUp: boolean;
  hasNewEntity: boolean;
  hasContinuationMarkers: boolean;
}

export interface GuardBuilderOutput {
  role: RoleType;
  memoryGate: MemoryGateOutput;
  memoryGateFillerUsed: boolean;
}

/**
 * 构建完整守卫链：角色 + 记忆门控
 */
export async function buildGuards(input: GuardBuilderInput): Promise<GuardBuilderOutput> {
  const { message, dna, decision, conversationHistory, isFollowUp, hasNewEntity, hasContinuationMarkers } = input;

  // ① 角色分类
  const p = decision.enhanced.perception;
  const entities = dna.entity_genes.map(g => ({ name: g.name, type: g.type }));
  const role = classifyRole(message, p as any, entities);

  // ② MemoryGate
  const isCasualChat = /^(在干嘛|忙什么|吃了吗|睡了|晚安|早安|早上好|晚上好|刚起来|下班|到家|今天天气|好开心|好难过|好累|心情|感觉|今天.*不错|今天.*好|嗯|好|行|对|是|好的|知道了|没事|算了|哈哈|嘿嘿|哎|唉)$/i.test(message.trim())
    || (message.length < 10 && /今天|天气|吃|睡|累|困|忙|下班|到家|早安|晚安/.test(message));

  let memoryGate: MemoryGateOutput = {
    mode: 'casual', needsMemorySearch: false, needsKnowledgeSearch: false,
    fillerPhrase: '', hallucinationGuard: '', strictMode: false,
  };
  let memoryGateFillerUsed = false;

  try {
    const modeCtx = {
      message,
      recentHistory: conversationHistory.slice(-6),
      isFollowUp,
      hasNewEntity,
      hasContinuationMarkers,
      calciumLevel: decision.enhanced.calcium_level,
      messageLength: message.length,
      perception: p,
    };
    const modeDecision = decideMode(modeCtx);
    memoryGate = buildGuard(modeDecision.mode, false, false);

    if (memoryGate.fillerPhrase && !/知识库|看过|记得|印象/.test(message)) {
      memoryGateFillerUsed = true;
    }
  } catch (err) {
    console.warn('[MemoryGate] 失败:', err);
  }

  return { role, memoryGate, memoryGateFillerUsed };
}
