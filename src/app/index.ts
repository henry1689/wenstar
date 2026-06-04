/**
 * WenStar 应用层入口
 *
 * 承载所有与商业价值直接相关的功能模块：
 *   knowledge/   — 知识引擎（阶段1: 搬家  → 阶段2: RAG+向量）
 *   persona/     — 人格引擎（阶段3）
 *   task-agent/  — 任务代理（阶段3）
 */
export { createKnowledgeEngine } from './knowledge/index.js';
export type { KnowledgeItem } from './knowledge/types.js';
