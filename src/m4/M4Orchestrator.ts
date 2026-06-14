// M4Orchestrator — M4 知识融合层主控制器
// Ref: M4-design-v1.md §5

import type { M3Decision } from '../m3/types/perception.js';
import type { M4Context } from './types/index.js';
import type { ScoredMemory } from '../m2/types/index.js';
import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import { MemoryRetriever } from './MemoryRetriever.js';
import { FamilyGraph } from './FamilyGraph.js';

export class M4Orchestrator {
  private memoryRetriever: MemoryRetriever;
  private familyGraph: FamilyGraph;

  constructor(storage: FusionStorageAdapter, familyGraph?: FamilyGraph) {
    this.memoryRetriever = new MemoryRetriever(storage);
    this.familyGraph = familyGraph ?? new FamilyGraph();
  }

  async initialize(): Promise<void> {
    await this.familyGraph.initialize();
  }

  /**
   * 对 M3 决策执行完整的 M4 知识融合流程
   * @param emotionalSummaries 可选：情感检索结果，注入到 timeline 头部
   */
  async orchestrate(decision: M3Decision, emotionalSummaries?: ScoredMemory[]): Promise<M4Context> {
    const entities = decision.enhanced.entity_genes.map((g) => ({
      name: g.name,
      type: g.type,
    }));
    const locusPath = decision.enhanced.locus_path;

    // 1. 记忆检索 + 上下文压缩
    const memories = await this.memoryRetriever.retrieveMemories(locusPath, entities);
    const memorySummary = this.memoryRetriever.compressMemories(memories);

    // 2. 家族知识图谱自动推断（有副作用：写入 SQLite 边）
    await this.familyGraph.integrateFromEntity(
      decision.enhanced.entity_genes,
      decision.enhanced.raw_input
    );

    // 3. 获取家族知识摘要 + 社交关系摘要
    const familySummary = await this.familyGraph.getFamilySummary();
    const socialSummary = await this.familyGraph.getSocialSummary();

    // 4. 构建家族上下文 + 社交上下文
    const familyContext = familySummary.members.map((m) => ({
      entity: m.name,
      relation: m.relation_to_user,
      related_entity: '我',
    }));
    const socialContext = socialSummary.connections.map((c) => ({
      entity: c.name,
      relation: c.relation_to_user,
      related_entity: '我',
    }));

    // 5. 注入情感检索结果（按时间排序后合并到 timeline 头部）
    if (emotionalSummaries && emotionalSummaries.length > 0) {
      const emotionalEntries = emotionalSummaries
        .map(em => ({
          time: em.record.created_at,
          summary: em.record.raw_input.substring(0, 60),
          calcium_level: em.record.calcium_level,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));
      memorySummary.timeline = [...emotionalEntries, ...memorySummary.timeline];
    }

    // 6. 输出 M4Context
    return {
      decision,
      memory_summary: memorySummary,
      family_context: familyContext.length > 0 ? familyContext : undefined,
      social_context: socialContext.length > 0 ? socialContext : undefined,
      current_time: new Date().toISOString(),
      meta: {
        has_history: memories.length > 0,
        has_family_context: familySummary.members.length > 0,
        calcium_level: decision.enhanced.calcium_level,
        dominant_action: decision.actions[0] ?? 'memorize',
      },
    };
  }

  getFamilyGraph(): FamilyGraph {
    return this.familyGraph;
  }
}
