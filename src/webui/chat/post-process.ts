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
  try {
    ctx.conversationDB?.insertConversation('user', message);
    ctx.conversationDB?.insertConversation('assistant', reply);
  } catch (err) {
    console.warn('[PostProcess] 对话持久化失败:', err);
  }

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
    if (ctx.m4) {
      const { extractRelations, storeRelations } = await import('../../app/knowledge/RelationshipExtractor.js');
      const relations = extractRelations(message, dna.entity_genes);
      if (relations.length > 0) {
        storeRelations(ctx.m4.getFamilyGraph(), relations);
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

  // ⑤ 高钙记忆晋升（异步）
  if (_cl >= 1 && _rid) {
    try {
      const _sqlite = ctx.storage.getSQLite();
      if (_sqlite && typeof _sqlite.writeRaw === 'function') {
        const _texts = [message, reply].filter(Boolean).join('。')
          .split(/[。！？!?]/g).map((s: string) => s.trim()).filter((s: string) => s.length >= 20);
        if (_texts.length === 0) _texts.push((message + ' ' + reply).substring(0, 200));
        const _pVec = JSON.stringify([
          p.pleasure, p.arousal, p.dominance, p.aggression, p.sincerity, p.humor,
          p.factual, p.logical, p.certainty, p.abstract, p.temporal_focus, p.self_ref,
          p.intimacy, p.power_diff, p.dependency, p.moral_judgment, p.etiquette, p.belonging,
          p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.safety,
        ]);

        for (let i = 0; i < Math.min(_texts.length, 3); i++) {
          const { DNAEncoder } = await import('../../m1/DNAEncoder.js');
          const _cr = DNAEncoder.generateSubId(_rid, 'MEM', i + 1);
          _sqlite.writeRaw(
            'INSERT OR IGNORE INTO memories (id, raw_input, entity_genes, created_at, calcium_score, emotion_vector, dna_root_id) VALUES (?,?,?,?,?,?,?)',
            _cr, _texts[i], JSON.stringify(dna.entity_genes || []), new Date().toISOString(), _cs, _pVec, _rid,
          );
        }

        // 金库→黑钻（钙化≥4.5）
        if (_cs >= 4.5) {
          const _bId = (await import('../../m1/DNAEncoder.js')).DNAEncoder.generateSubId(_rid, 'BD', 1);
          _sqlite.writeRaw(
            'INSERT OR IGNORE INTO black_diamond (id, summary, emotion_tag, tags, emotion_vector, dna_root_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
            _bId, message.substring(0, 200), decision.primary_emotion || '强烈',
            JSON.stringify((dna.entity_genes || []).map((g: any) => g.name)),
            _pVec, _rid, new Date().toISOString(), new Date().toISOString(),
          );
        }
      }
    } catch (err) {
      console.warn('[PostProcess] 晋升失败:', err);
    }
  }

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

  // ⑨ 知识库异步摄入
  try {
    const { ingestFromConversation } = await import('../../app/ingestion/ConversationIngestionService.js');
    ingestFromConversation(ctx.storage, message, reply, dna as any).catch(() => {});
  } catch (err) {
    console.warn('[PostProcess] 知识摄入失败:', err);
  }
}
