/**
 * TransitionManager — 角色过渡管理
 *
 * 管理角色切换的平滑过渡、防闪烁熔断、安全降级。
 * 角色切换保留对话历史，不清空。
 */
import type { RoleType, RoleDecision } from './RoleClassifier.js';

export interface TransitionState {
  currentRole: RoleType;
  previousRole: RoleType | null;
  /** 同轮切换计数 */
  switchCount: number;
  /** 锁定角色（熔断时） */
  lockedRole: RoleType | null;
  /** 锁定剩余轮数 */
  lockRemainingTurns: number;
  /** 连续亲密消息计数（用于工作→亲密切换防误判） */
  consecutiveIntimate: number;
  /** 混合话题标记 */
  isMixedTopic: boolean;
  /** SP3-4: 上次切换时间戳（用于衰减） */
  lastSwitchTime: number;
}

const MAX_SWITCHES_PER_SESSION = 3;
const LOCK_DURATION_TURNS = 5;
const INTIMATE_THRESHOLD = 2; // 连续 2 条亲密才切换
const DECAY_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟无切换自动衰减
const DECAY_THRESHOLD_SWITCHES = 3;

export function createInitialState(): TransitionState {
  return {
    currentRole: 'secretary',
    previousRole: null,
    switchCount: 0,
    lockedRole: null,
    lockRemainingTurns: 0,
    consecutiveIntimate: 0,
    isMixedTopic: false,
    lastSwitchTime: Date.now(),
  };
}

/**
 * 评估角色切换
 */
export function evaluateTransition(
  state: TransitionState,
  decision: RoleDecision,
  message: string,
): { newRole: RoleType; state: TransitionState; switched: boolean } {
  const newState = { ...state };
  const targetRole = decision.role;

  // SP3-4: 30分钟无切换自动衰减 switchCount
  const now = Date.now();
  if (newState.switchCount > 0 && (now - newState.lastSwitchTime) > DECAY_INTERVAL_MS) {
    const halfDecayed = Math.floor(newState.switchCount / 2);
    if (halfDecayed !== newState.switchCount) {
      newState.switchCount = halfDecayed;
      console.log('[RoleRouter] 切换计数衰减: ' + state.switchCount + ' → ' + halfDecayed);
    }
  }

  // 锁定期：递减并维持锁定角色
  if (newState.lockedRole) {
    newState.lockRemainingTurns--;
    if (newState.lockRemainingTurns <= 0) {
      newState.lockedRole = null;
      // SP3-4: 熔断解除时重置切换计数
      newState.switchCount = 0;
      console.log('[RoleRouter] 熔断解除，切换计数已重置');
    } else {
      return { newRole: newState.lockedRole, state: newState, switched: false };
    }
  }

  // 同一角色不切换
  if (targetRole === newState.currentRole) {
    return { newRole: targetRole, state: newState, switched: false };
  }

  // 亲密→工作：立即切换（安全优先）
  if (targetRole === 'secretary' || targetRole === 'strategist') {
    newState.consecutiveIntimate = 0;
    newState.switchCount++;
    newState.lastSwitchTime = now;
    newState.previousRole = newState.currentRole;
    newState.currentRole = targetRole;
    if (newState.switchCount >= MAX_SWITCHES_PER_SESSION) {
      newState.lockedRole = 'secretary';
      newState.lockRemainingTurns = LOCK_DURATION_TURNS;
      console.log(`[RoleRouter] 熔断锁定 secretary ${LOCK_DURATION_TURNS}轮`);
    }
    console.log(`[RoleRouter] ${state.currentRole}→${targetRole} (${decision.rule})`);
    return { newRole: targetRole, state: newState, switched: true };
  }

  // 工作→亲密：需连续 2 条才切换（防误判）
  if (targetRole === 'lover') {
    newState.consecutiveIntimate++;
    if (newState.consecutiveIntimate < INTIMATE_THRESHOLD) {
      console.log(`[RoleRouter] 亲密待确认 (${newState.consecutiveIntimate}/${INTIMATE_THRESHOLD})`);
      return { newRole: newState.currentRole, state: newState, switched: false };
    }
    newState.switchCount++;
    newState.lastSwitchTime = now;
    newState.previousRole = newState.currentRole;
    newState.currentRole = targetRole;
    console.log(`[RoleRouter] ${state.currentRole}→${targetRole} (${decision.rule})`);
    return { newRole: targetRole, state: newState, switched: true };
  }

  // 其他切换（counselor/recaller 等）
  newState.switchCount++;
  newState.lastSwitchTime = now;
  newState.previousRole = newState.currentRole;
  newState.currentRole = targetRole;
  if (newState.switchCount >= MAX_SWITCHES_PER_SESSION) {
    newState.lockedRole = 'secretary';
    newState.lockRemainingTurns = LOCK_DURATION_TURNS;
    console.log(`[RoleRouter] 熔断锁定 secretary ${LOCK_DURATION_TURNS}轮`);
  }
  console.log(`[RoleRouter] ${state.currentRole}→${targetRole} (${decision.rule})`);
  return { newRole: targetRole, state: newState, switched: true };
}
