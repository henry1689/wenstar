/**
 * M4 结构性守卫测试
 *
 * 用途：锁定 M4 模块的结构契约，防止后期架构漂移。
 * 覆盖：
 *   1. 类型接口（M4Context, MemorySummary, GraphNode 等）
 *   2. 类方法签名（M4Orchestrator, MemoryRetriever, FamilyGraph）
 *   3. 纯函数导出（rerank, decompose, mergeDecomposedResults）
 *   4. 外部消费者契约（14 处外部 import）
 *
 * Ref: 架构加固指令 — M4 结构性守卫测试
 */

import { describe, it, expect } from 'vitest';
import { M4Orchestrator } from '../M4Orchestrator.js';
import { MemoryRetriever } from '../MemoryRetriever.js';
import { FamilyGraph } from '../FamilyGraph.js';
import { rerank } from '../Reranker.js';
import { decompose, mergeDecomposedResults } from '../QueryDecomposer.js';
import type { M4Context, MemorySummary } from '../types/index.js';
import type {
  GraphNode, GraphEdge, GraphQueryResult, GraphPath,
  InferenceResult, FamilySummary, RelationCandidate,
  FamilyManualAPI, NodeType,
} from '../types/graph.js';

// ════════════════════════════════════════════════════════════════════
// 第 1 组：类型接口形状守卫
// ════════════════════════════════════════════════════════════════════

describe('[M4守卫] types/index.ts 类型接口', () => {
  it('MemorySummary 含 timeline + frequentEntities + timeSpan', () => {
    const ms: MemorySummary = {
      timeline: [{ time: '2026-01-01', summary: 'test', calcium_level: 1 }],
      frequentEntities: [{ name: '妈妈', type: 'person', mentionCount: 3 }],
      timeSpan: { earliest: '2026-01-01', latest: '2026-01-02' },
    };
    expect(Array.isArray(ms.timeline)).toBe(true);
    expect(ms.timeline[0].calcium_level).toBeDefined();
    expect(ms.timeSpan.earliest).toBeTruthy();
  });

  it('M4Context 含 decision + memory_summary + meta(4项)', () => {
    const ctx: M4Context = {
      decision: {} as any,
      memory_summary: {} as MemorySummary,
      current_time: new Date().toISOString(),
      meta: { has_history: true, has_family_context: false, calcium_level: 1, dominant_action: 'memorize' },
    };
    expect(ctx.meta.has_history).toBe(true);
    expect(Object.keys(ctx.meta).length).toBe(4);
  });
});

describe('[M4守卫] types/graph.ts 类型接口', () => {
  it('NodeType 只能是 4 种之一', () => {
    const types: NodeType[] = ['person', 'place', 'thing', 'concept'];
    expect(types.length).toBe(4);
  });

  it('GraphNode 含 id/type/name + 可选字段', () => {
    const gn: GraphNode = { id: 'n1', type: 'person', name: '妈妈', aliases: ['母亲'], properties: { age: 50 } };
    expect(gn.id).toBe('n1');
    expect(Array.isArray(gn.aliases)).toBe(true);
  });

  it('GraphEdge 含 source_id/target_id/relation + 可选字段', () => {
    const ge: GraphEdge = { source_id: 'n1', target_id: 'n2', relation: 'mother_of' };
    expect(ge.source_id).toBeTruthy();
    expect(ge.target_id).toBeTruthy();
  });

  it('InferenceResult 含 nodes_created/edges_created/details', () => {
    const ir: InferenceResult = { nodes_created: 1, edges_created: 2, details: ['创建节点: 妈妈'] };
    expect(ir.nodes_created).toBeGreaterThan(0);
    expect(Array.isArray(ir.details)).toBe(true);
  });

  it('FamilySummary 含 members + locations', () => {
    const fs: FamilySummary = { members: [{ name: '妈妈', relation_to_user: '母亲', aliases: [] }], locations: ['深圳'] };
    expect(fs.members.length).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 2 组：类方法签名守卫
// ════════════════════════════════════════════════════════════════════

describe('[M4守卫] M4Orchestrator 方法签名', () => {
  const proto = M4Orchestrator.prototype;
  it('构造函数', () => { expect(M4Orchestrator).toBeInstanceOf(Function); });
  it('initialize() — 异步初始化', () => { expect(typeof proto.initialize).toBe('function'); });
  it('orchestrate(decision, emotionalSummaries?)', () => { expect(typeof proto.orchestrate).toBe('function'); });
  it('getFamilyGraph()', () => { expect(typeof proto.getFamilyGraph).toBe('function'); });
});

describe('[M4守卫] MemoryRetriever 方法签名', () => {
  const proto = MemoryRetriever.prototype;
  it('构造函数', () => { expect(MemoryRetriever).toBeInstanceOf(Function); });
  it('retrieveMemories(locusPath, entities, options?)', () => { expect(typeof proto.retrieveMemories).toBe('function'); });
  it('compressMemories(dnas)', () => { expect(typeof proto.compressMemories).toBe('function'); });
});

describe('[M4守卫] FamilyGraph 方法签名', () => {
  const proto = FamilyGraph.prototype;
  it('构造函数', () => { expect(FamilyGraph).toBeInstanceOf(Function); });
  it('initialize() — 异步初始化', () => { expect(typeof proto.initialize).toBe('function'); });
  it('addNode(node)', () => { expect(typeof proto.addNode).toBe('function'); });
  it('addEdge(edge)', () => { expect(typeof proto.addEdge).toBe('function'); });
  it('findRelated(entityName, relation?)', () => { expect(typeof proto.findRelated).toBe('function'); });
  it('findPath(sourceName, targetName)', () => { expect(typeof proto.findPath).toBe('function'); });
  it('integrateFromEntity(entities, rawInput, selfName?)', () => { expect(typeof proto.integrateFromEntity).toBe('function'); });
  it('correctRelation(source, target, correctRelation)', () => { expect(typeof proto.correctRelation).toBe('function'); });
  it('addFamilyMember(name, relation, aliases?)', () => { expect(typeof proto.addFamilyMember).toBe('function'); });
  it('getFamilySummary()', () => { expect(typeof proto.getFamilySummary).toBe('function'); });
  // 验证已删除的方法不存在
  it('generateId() 已被删除（统一使用 uid()）', () => {
    expect((proto as any).generateId).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 3 组：纯函数导出守卫
// ════════════════════════════════════════════════════════════════════

describe('[M4守卫] Reranker 导出', () => {
  it('rerank 是函数', () => { expect(typeof rerank).toBe('function'); });
});

describe('[M4守卫] QueryDecomposer 导出', () => {
  it('decompose 是函数', () => { expect(typeof decompose).toBe('function'); });
  it('mergeDecomposedResults 是函数', () => { expect(typeof mergeDecomposedResults).toBe('function'); });
  it('decompose 返回 DecomposedQuery 结构', () => {
    const r = decompose('为什么我总是失眠');
    expect(typeof r.original).toBe('string');
    expect(Array.isArray(r.subQueries)).toBe(true);
    expect(['causal', 'comparison', 'enumeration', 'simple']).toContain(r.intent);
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 4 组：外部消费者契约守卫
// ════════════════════════════════════════════════════════════════════

describe('[M4守卫] 外部消费者契约', () => {
  it('M4Context 被 m5(3处) 使用 — 结构不变', () => {
    const ctx: M4Context = {
      decision: {} as any, memory_summary: {} as MemorySummary,
      current_time: '', meta: { has_history: false, has_family_context: false, calcium_level: 0, dominant_action: '' },
    };
    expect(ctx.meta.dominant_action).toBeDefined();
  });

  it('rerank 被 webui(2处) 使用 — 函数存在', () => {
    expect(typeof rerank).toBe('function');
  });

  it('decompose/mergeDecomposedResults 被 webui(2处) 使用 — 函数存在', () => {
    expect(typeof decompose).toBe('function');
    expect(typeof mergeDecomposedResults).toBe('function');
  });

  it('buildContext() 已删除，所有调用已改用 orchestrate()', () => {
    const proto = MemoryRetriever.prototype;
    expect((proto as any).buildContext).toBeUndefined();
  });
});
