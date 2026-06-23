/**
 * chat/index — 聊天模块统一导出
 *
 * S3-2: 统一导出拆分后的子模块
 */

export { buildGuards, classifyRole, getCurrentRole, setRole } from './guard-builder.js';
export type { GuardBuilderInput, GuardBuilderOutput } from './guard-builder.js';
export { executePostProcess } from './post-process.js';
export type { PostProcessInput } from './post-process.js';
export { fetchBionicMemories, getVadToneHint, pushToVadCache, isVadAvailable } from './retrieval.js';
export type { MemoryGateOutput, RoleType, TransitionState } from './guard-builder.js';
