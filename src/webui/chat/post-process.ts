// @ts-nocheck - S3-2 scaffolding, will be properly integrated after full refactor
/**
 * post-process — 后处理流水线
 *
 * S3-2: 从 chat.ts 拆出的独立模块。
 * 职责：对话持久化、人物档案更新、关系图谱同步、主题追踪、
 *       M6 反馈信号、M8 年轮写入、高钙记忆晋升（异步）、质量评分
 */

import type { ChatContext } from '../chat.js';
import type { DNA } from '../../m1/types/dna.js';
import type { M3Decision } from '../../m3/types/perception.js';
import type { ScoredMemory } from '../../m2/types/index.js';

export interface PostProcessInput {
  ctx: ChatContext;
  dna: DNA;
  message: string;
  reply: string;
  decision: M3Decision;
  role: string;
  memories: ScoredMemory[];
  knowledgeBaseText: string;
  toneHint: string | null;
}

/**
 * 执行后处理（对话持久化 + 图谱同步 + M6/M7/M8 反馈）
 * 所有操作不阻塞主回复，通过 chatTaskQueue 异步执行
 */
export async function executePostProcess(input: PostProcessInput): Promise<void> {
  const { ctx, dna, message, reply, decision, role, memories, knowledgeBaseText } = input;
  const p = decision.enhanced.perception;
  const _cs = decision.enhanced.calcium_score;
  const _cl = decision.enhanced.calcium_level;
  const _rid = dna.dna_root_id;

  // ① 对话持久化（砂金库）
  // 已在 chat.ts:1670-1671 执行，此处不重复写入

  // ② 人物档案更新（从 M1 实体）
  try {
    const personGenes = dna.entity_genes.filter((g: any) => g.type === 'person' && g.name !== '我');
    if (personGenes.length > 0 && ctx.m4?.getFamilyGraph) {
      const fg = ctx.m4.getFamilyGraph();
      for (const pg of personGenes) {
        fg.updatePersonProfile(pg.name, {
          last_mentioned: new Date().toISOString(),
          mention_count: (fg.getPersonProfile(pg.name)?.mention_count || 0) + 1,
        } as any);
      }
    }
  } catch (err) {
    console.warn('[PostProcess] 档案更新失败:', err);
  }

  // ③ 关系图谱同步
  try {
    if (ctx.m4 && ctx.storage?.getSQLite) {
      const { extractRelations, storeRelations } = await import('../../app/knowledge/RelationshipExtractor.js');
      const relations = extractRelations(message, dna.entity_genes);
      if (relations.length > 0) {
        const sqlite = ctx.storage.getSQLite();
        const fg = ctx.m4.getFamilyGraph();
        storeRelations(sqlite, relations, message, fg);
      }
    }
  } catch (err) {
    console.warn('[PostProcess] 关系提取失败:', err);
  }

  // ④ 主题追踪
  try {
    if (ctx.topicTracker) {
      ctx.topicTracker.record(message);
    }
  } catch (err) {
    console.warn('[PostProcess] 主题追踪失败:', err);
  }

  // ⑤ 高钙记忆晋升 — 已由 chat.ts 双轨晋升（行2064）和 flushDialogGroup（行2247）处理
  // 此处不再重复写入 memories 或 black_diamond

  // ⑥ M6 反馈信号
  try {
    if (ctx.m6) {
      ctx.m6.ingestFeedback(dna as any, decision as any, reply);
    }
  } catch (err) {
    console.warn('[PostProcess] M6反馈失败:', err);
  }

  // ⑦ M8 年轮写入
  try {
    if (ctx.m8) {
      ctx.m8.writeCycle({
        dna_root_id: _rid,
        input: message,
        output: reply,
        perception: p,
        calcium: _cs,
        emotion: decision.primary_emotion,
      } as any);
    }
  } catch (err) {
    console.warn('[PostProcess] M8写入失败:', err);
  }

  // ⑧ M7 梦境触发（高钙化对话触发归纳）
  try {
    if (_cl >= 2 && ctx.m7) {
      ctx.m7.triggerInduction(dna as any, decision as any);
    }
  } catch (err) {
    console.warn('[PostProcess] M7梦境触发失败:', err);
  }

  // ⑨ 知识库异步摄入（已在 chat.ts:2133 执行主调用，此处不重复）
  // chat.ts 已完整处理：亲密检测→ingestFromConversation→异步入库
}
