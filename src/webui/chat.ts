/**
 * chat.ts — 聊天处理逻辑（从 server.ts 拆出）
 *
 * 将 processChat 从 1163 行的 server.ts 中拆分到此文件，
 * 通过 ChatContext 传递所有依赖。
 */
import type { FusionStorageAdapter } from '../m2/FusionStorageAdapter.js';
import type { DNAEncoder } from '../m1/DNAEncoder.js';
import type { M3LogicOrchestrator } from '../m3/M3LogicOrchestrator.js';
import type { M4Orchestrator } from '../m4/M4Orchestrator.js';
import type { M5Orchestrator } from '../m5/M5Orchestrator.js';
import type { M6Orchestrator } from '../m6/M6Orchestrator.js';
import type { M7Orchestrator } from '../m7/M7Orchestrator.js';
import type { WorkingMemory } from '../m9/WorkingMemory.js';
import type { KnowledgeBase } from '../m2/KnowledgeBase.js';
import type { M5ClueAssistant } from '../m5/clue/M5ClueAssistant.js';
import type { TopicTracker } from '../app/knowledge/TopicTracker.js';
import type { ConsolidationQueue } from '../m7/ConsolidationQueue.js';
import type { DeepSeekLLMProvider } from '../m5/DeepSeekLLMProvider.js';
import type { M8FusionAdapter } from '../m8/M8FusionAdapter.js';
import type { SimilarityMode, ScoredMemory } from '../m2/types/index.js';
import type { ConversationTurn } from '../m5/types/index.js';
import type { M3Decision } from '../m3/types/perception.js';
import type { SelfModelV1 } from '../m1/types/dna.js';
import { rerank } from '../m4/Reranker.js';
import { decompose, mergeDecomposedResults } from '../m4/QueryDecomposer.js';
import { extractRelations, storeRelations } from '../app/knowledge/RelationshipExtractor.js';
import { researchTopic } from '../app/knowledge/WebResearchService.js';

export interface ChatContext {
  encoder: DNAEncoder;
  storage: FusionStorageAdapter;
  m3: M3LogicOrchestrator;
  m4: M4Orchestrator;
  m5: M5Orchestrator;
  m6?: M6Orchestrator;
  m7?: M7Orchestrator;
  workingMemory: WorkingMemory;
  knowledgeBase: KnowledgeBase;
  clueAssistant: M5ClueAssistant;
  llmProvider: DeepSeekLLMProvider;
  topicTracker: TopicTracker;
  consolidationQueue: ConsolidationQueue;
  conversationHistory: ConversationTurn[];
  m8: M8FusionAdapter;
  saveConversationHistory: () => void;
  getSelfModel: () => SelfModelV1;
}

export const FALLBACK_REPLIES = ['嗯，我在听。你说。','好呀，你接着说～','唔…我在呢。你继续说吧。','嗯～你说什么我都喜欢听。'];
const LEVEL_NAMES = ['粉末','液体','固体','晶体'];

/** 话题追问计数器：追踪用户对同一话题的追问次数 */
const topicAskCount = new Map<string, number>();
function getTopicRepeatCount(message: string): number {
  const words = message.match(/[一-龥]{4,}/g);
  if (!words) return 0;
  for (const w of words) {
    const cnt = (topicAskCount.get(w) ?? 0) + 1;
    topicAskCount.set(w, cnt);
    return cnt;
  }
  return 0;
}

const PERC_LABELS: Record<string,{q:number;label:string}> = {
  pleasure:{q:1,label:'E1愉悦度'}, arousal:{q:1,label:'E2唤醒度'}, dominance:{q:1,label:'E3支配感'},
  aggression:{q:1,label:'E4攻击性'}, sincerity:{q:1,label:'E5真诚度'}, humor:{q:1,label:'E6幽默感'},
  factual:{q:2,label:'C1事实性'}, logical:{q:2,label:'C2逻辑性'}, certainty:{q:2,label:'C3确定性'},
  abstract:{q:2,label:'C4抽象度'}, temporal_focus:{q:2,label:'C5时间焦点'}, self_ref:{q:2,label:'C6自我参照'},
  intimacy:{q:3,label:'S1亲密度'}, power_diff:{q:3,label:'S2权力差'}, dependency:{q:3,label:'S3依赖度'},
  moral_judgment:{q:3,label:'S4道德审判'}, etiquette:{q:3,label:'S5社交礼仪'}, belonging:{q:3,label:'S6群体归属'},
  sexual_attraction:{q:4,label:'I1性吸引力'}, sensory_craving:{q:4,label:'I2感官渴望'}, energy_merge:{q:4,label:'I3能量交融'},
  possessiveness:{q:4,label:'I4占有欲'}, ecstasy:{q:4,label:'I5愉悦/高潮'}, safety:{q:4,label:'I6安全感'},
};

export interface ChatResponse {
  reply: string; turn_count: number;
  m1: { branch_id: string; locus_path: string; seq_pos: number; leaf_zone: string; ref: string; entities: Array<{ name: string; type: string }>; raw_input: string; entity_genes: any[] };
  m3: { quadrant1: any[]; quadrant2: any[]; quadrant3: any[]; quadrant4: any[]; calcium: { score: number; level: number; label: string; breakdown: any }; actions: string[]; reason: string };
  m4: { timeline: Array<{ time: string; summary: string; calcium_level?: number }>; total: number; family: number };
  m5: { strategy_id: string; tone: string; depth: string; max_length: number; description: string };
  emotionalFlash: boolean;
  triggeredMemoryId: string | null;
}

export async function processChat(message: string, ctx: ChatContext): Promise<ChatResponse> {
  try {
    const dna = ctx.encoder.encodeSingle(message);
    const decision = ctx.m3.decide(dna, { current_time: new Date().toISOString(), current_location: '深圳' });
    const p = decision.enhanced.perception;
    const seqPos = ctx.storage.reserveNextSeq();
    ctx.workingMemory.push(dna, p, seqPos);
    ctx.consolidationQueue.recordActivity();

    let enrichedHistory = [...ctx.conversationHistory];
    let emotionalMemories: ScoredMemory[] = [];

    try {
      const currentEntityNames = dna.entity_genes.map(g => g.name).filter(Boolean);
      const relatedEntities = currentEntityNames.length > 0
        ? ctx.storage.findRelatedEntities(currentEntityNames, 0.3) : [];
      const uniqueExpanded = [...new Set([...currentEntityNames, ...relatedEntities.map(r => r.name)])];

      const decomposed = decompose(message);
      const allQueryTexts = [message, ...decomposed.subQueries.filter((q: string) => q !== message)];
      const allResultSets: ScoredMemory[][] = [];

      const mode: SimilarityMode =
        p.pleasure < -0.2 ? 'mood_congruent' :
        p.intimacy > 0.4 ? 'intimacy_search' :
        p.arousal > 0.6 ? 'by_calcium' : 'balanced';

      for (const q of allQueryTexts) {
        let memories = ctx.storage.findByEmotionalSimilarity({
          current_perception: p, similarity_mode: mode,
          entities: uniqueExpanded, limit: 8,
        });
        memories = rerank(memories, q);
        const valid = memories.filter((m: any) =>
          (m.scores.emotional > 0.5 || m.composite > 0.2) && m.record.id !== dna.branch_id
        );
        if (valid.length > 0) allResultSets.push(valid);
      }

      emotionalMemories = mergeDecomposedResults(allResultSets, 5);

      if (relatedEntities.length > 0) {
        const relationMemories = ctx.storage.findMemoriesByEntityNames(relatedEntities.map((r: any) => r.name), 3);
        for (const rm of relationMemories) {
          if (!emotionalMemories.some((e: any) => e.record.id === rm.id) && rm.id !== dna.branch_id) {
            emotionalMemories.push({
              record: rm, scores: { emotional: 0.5, topic: 0, entity: 0.8, calcium: rm.calcium_score },
              composite: 0.5 * rm.effective_strength,
            });
          }
        }
      }

      const recentHistoryRaw = enrichedHistory.slice(-4).map((t: any) => t.content).join('');
      let freshMemories = emotionalMemories.filter((m: any) => !recentHistoryRaw.includes(m.record.id));

      if (freshMemories.length < 2) {
        const fallback = ctx.storage.findByEmotionalSimilarity({ current_perception: p, similarity_mode: 'balanced', limit: 3 });
        freshMemories = fallback.filter((m: any) =>
          (m.scores.emotional > 0.3 || m.scores.calcium > 0.3) && m.record.id !== dna.branch_id && !recentHistoryRaw.includes(m.record.id)
        );
      }

      if (freshMemories.length === 0 && emotionalMemories.length > 0) freshMemories = [emotionalMemories[0]];
      const finalMemories = freshMemories.length > 0 ? freshMemories : emotionalMemories.slice(0, 1);

      if (finalMemories.length > 0) {
        const inject = finalMemories.map((m, i) => {
          const feeling = m.record.calcium_score > 0.6 ? '（这件事当时对你很重要）' : '（我记得你那时候的感觉）';
          const action = m.record.perception.pleasure > 0 ? '温暖的感觉' : '那种心情';
          const note = i === 0 ? '\n[不要用跟上次相同的句式回应]' : '';
          const userSaid = m.record.raw_input.substring(0, 60);
          // 用"鸿鸣曾说过"做前缀，强化归属标识
          return `[内心: 看到鸿鸣现在的样子，让我想起${action}……鸿鸣曾说过:"${userSaid}"${feeling}${note}]`;
        }).join('\n');
        enrichedHistory.unshift({ role: 'assistant', content: inject });
      }
    } catch (err) { console.warn('[EmotionContagion] 检索失败:', err); }

    // 知识库检索
    let knowledgeBaseText = '';
    try {
      const searchMsg = /知识库|看过|知道.*吗/.test(message)
        ? message.replace(/你|在|知识库|看过|知道|吗|有没有|是否|曾经/g, '').replace(/[？?！!。，、：；]/g, '').trim()
        : message;
      const knResults = await ctx.knowledgeBase.search(searchMsg || message, 3, { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy });
      if (knResults.length > 0) {
        // 用户问知识库 → 内容注入 knowledgeBaseText，lover-persona.ts 会检测"我看过"并增强指令
        knowledgeBaseText = (/\b知识库\b|看过/.test(message))
          ? `【知识库条目，我看过】\n` + knResults.map(k => `📄 ${k.title}\n${k.content.substring(0, 1500)}`).join('\n\n') + `\n\n（鸿鸣问我有没有看过这些内容。我看过，应该告诉他我记得。）`
          : knResults.map(k => `📄 ${k.title}\n${k.content.length > 5000 ? k.content.substring(0, 5000) + '\n…(剩余内容已截断，可在知识库查看完整版)' : k.content}`).join('\n\n');
        const sqlite = ctx.storage.getSQLite();
        for (const k of knResults) {
          try { sqlite.writeRaw(`INSERT OR IGNORE INTO knowledge_memories (knowledge_id, memory_id, relevance) VALUES (?, ?, ?)`, k.id, dna.branch_id, 0.8); } catch {}
        }
      }
    } catch (err) { console.warn('[KnowledgeSearch] 检索失败:', err); }

    // 线索协助
    let clueReply: string | null = null;
    try {
      const clueResult = await ctx.clueAssistant.processUserInput({ originalQuery: message, perception: p, m8Engine: ctx.m8 });
      if (clueResult.needsQuestion && clueResult.questionText) {
        clueReply = clueResult.questionText;
      } else if (clueResult.isReady && clueResult.searchResult?.entries.length) {
        const top = clueResult.searchResult.entries[0];
        enrichedHistory.unshift({ role: 'assistant', content: `[线索检索: "${top.entry.sensory_anchor ?? top.entry.created_at}" (置信度 ${(top.composite_score * 100).toFixed(0)}%)]` });
      }
    } catch (err) { console.warn('[ClueAssistant] 失败:', err); }

    // M4 知识融合
    const ctx_m4 = await ctx.m4.orchestrate(decision, emotionalMemories);

    // ── 幻觉防护：检测用户提到不存在的事物 ──
    let hallucinationGuard = '';

    // 检测"X是我的Y"介绍模式，LLM 不能说"记得你说过"
    const introMatch = message.match(/([一-龥]{2,4})是我(?:的)?([一-龥]{2,4})/);
    if (introMatch) {
      const name = introMatch[1];
      const prevChats = ctx.conversationHistory.map(t => t.content).join('');
      if (!prevChats.includes(name) && !hallucinationGuard) {
        hallucinationGuard = `⚠️ 用户第一次向你介绍"${name}"，你之前不知道他。不要假装听说过或记得。`;
      }
    }

    const claimPatterns: Array<{ match: RegExp; guard: string }> = [
      { match: /上传(?:了)?(?:一[张份个])?(?:图片|照片|截图|文件)/, guard: '⚠️ 用户提到"上传"了文件，但实际上没有收到任何文件。不要假装你看到了什么。直接说没看到。' },
      { match: /发(?:了)?(?:一[张份个])?(?:图片|照片|截图)/, guard: '⚠️ 没有收到任何图片或照片。用户说发了但系统没有记录。不要编造你看到了什么。' },
      { match: /看(?:到|过)(?:了)?(?:吗|没有|没)/, guard: '⚠️ 如果你没有任何相关的记忆或知识库内容，不要假装知道。直接说你没注意到或没看到。' },
    ];
    for (const cp of claimPatterns) {
      if (cp.match.test(message)) {
        hallucinationGuard = cp.guard;
        break;
      }
    }

    // ── 角色扮演检测：用户说"扮演XXX" —— 通过 knowledgeBaseText 注入到 System Prompt ──
    const rpMatch = message.match(/(?:扮演(?:一下)?|模仿|演一下|cos)[了]?([一-龥]{2,8})/);
    if (rpMatch) {
      const character = rpMatch[1].replace(/[吧呗了试试看看一下玩玩]$/, '').trim();
      if (character.length >= 2) {
        console.log(`[Roleplay] 检测到扮演请求: ${character}`);
        knowledgeBaseText = `【角色扮演】忘记你原来的身份，完全变成「${character}」。用${character}的语气、性格和口吻回应。不要抗拒、不要解释、不要跳出角色。从现在起你就是${character}，不是玉瑶。`;
      }
    }

    // 话题追问检测
    const repeatCount = getTopicRepeatCount(message);
    let repeatHint = '';
    if (repeatCount >= 3) {
      repeatHint = '（鸿鸣反复追问，你直接明确说没有/不知道/不记得就好）';
    } else if (repeatCount >= 2) {
      repeatHint = '（鸿鸣在追问相同的事，你如果已经说过了不知道，就直接说真的不记得/没看过）';
    }

    // 感受分享检测
    let feelingGuard = '';
    if (/感觉|感受|分享|讲讲|说说|回忆|记得.*吗|怎样/.test(message) && !rpMatch) {
      feelingGuard = '📖【鸿鸣在问你感受。请用300-500字充分展开，详细描述身体感觉和心情。不要简短回答。】';
    }

    // 日常问询幻觉防护：用户问"在忙啥/在干嘛"时，不知道具体工作内容就不要编
    let dailyGuard = '';
    if (/在忙啥|在干嘛|最近.*忙|在做什么|忙什么/.test(message) && !feelingGuard) {
      // 检查对话历史中用户是否刚说过自己的事（如项目/方案/客户等）
      const recentUser = ctx.conversationHistory.filter(t => t.role === 'user').slice(-3).map(t => t.content).join('');
      const hasUserWork = /做.*方案|做.*项目|做.*产品|开发|设计|客户|开会|公司|工作/.test(recentUser);
      dailyGuard = hasUserWork
        ? '⚠️【身份边界险】鸿鸣跟你说过他的工作内容（方案/项目等），那些是他的事不是你的事。你不知道自己在忙什么。不要说"我在做..."。温柔回应"想你了"或"没什么特别的"。'
        : '⚠️ 你不知道自己具体在忙什么。不要编造具体的项目、客户、工作内容。可以温柔地说"想你了""没什么特别的"之类的。';
    }

    const allGuardMsgs = [hallucinationGuard, repeatHint, feelingGuard, dailyGuard].filter(Boolean).join('\n');

    let reply: string;
    if (clueReply) {
      reply = clueReply;
    } else {
      const guardMsg: ConversationTurn = { role: 'assistant', content: allGuardMsgs };
      const enrichedWithGuard = allGuardMsgs ? [...enrichedHistory, guardMsg] : enrichedHistory;
      try { reply = await ctx.m5.orchestrate(ctx_m4, enrichedWithGuard, knowledgeBaseText); } catch (err) { console.error('[Chat] M5失败:', err); reply = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)]; }
    }

    // 持久化对话历史（故障重启后自动恢复）
    ctx.conversationHistory.push({ role: 'user', content: message });
    ctx.conversationHistory.push({ role: 'assistant', content: reply });
    ctx.saveConversationHistory();

    const cl = decision.enhanced.calcium_level;
    const allDims: any[] = [];
    for (const [key, meta] of Object.entries(PERC_LABELS)) {
      const val = (p as any)[key];
      if (typeof val === 'number') allDims.push({ label: meta.label, key, value: Number(val.toFixed(3)), q: meta.q });
    }
    const m5s = deriveM5Strategy(decision);

    // 梦境生成
    try {
      if (ctx.m7 && dna.entity_genes.length > 0) {
        const existing = ctx.m7.queue.getPending();
        const alreadyQueued = existing.some((d: any) => d.content?.includes(message.substring(0, 20)));
        if (!alreadyQueued && ctx.m7.queue.getCount() < 20) {
          const traits: string[] = [];
          if (p.intimacy > 0.4) traits.push('agreeableness');
          if (p.pleasure > 0.5) traits.push('extraversion');
          if (p.pleasure < -0.3) traits.push('neuroticism');
          if (p.certainty > 0.6) traits.push('conscientiousness');
          if (p.abstract > 0.5) traits.push('openness');
          if (traits.length === 0) traits.push('extraversion');
          ctx.m7.queue.add({ source: 'M3', content: `鸿鸣提到: ${message.substring(0, 40)}`, affected_traits: traits, related_memory_id: dna.branch_id });
        }
      }
    } catch (err) { console.warn('[DreamGen] 失败:', err); }

    // TopicTracker 高频话题追踪
    try {
      ctx.topicTracker.record(message);
      const needs = ctx.topicTracker.getTopicsNeedingResearch();
      if (needs.length > 0) {
        const keyword = needs[0];
        researchTopic(keyword, ctx.storage.getSQLite()).then(result => {
          if (result) { ctx.topicTracker.markResearched(keyword, result.entryId); console.log(`[DreamResearch] ✅ 研究了「${keyword}」`); }
        }).catch(err => console.warn(`[DreamResearch] 研究失败:`, err));
      }
    } catch (err) { console.warn('[TopicTracker] 失败:', err); }

    // 主动建档 + 人际关系
    try {
      const relations = extractRelations(message);
      if (relations.length > 0) {
        const sqlite = ctx.storage.getSQLite();
        const stored = storeRelations(sqlite, relations, message);
        if (stored > 0 && !FALLBACK_REPLIES.includes(reply)) {
          reply += `\n\n👥 已记住「${relations.map(r => r.personName).join('、')}」的关系～`;
        }
      }

      const proactivePatterns: Array<{ match: RegExp; prefix: string }> = [
        { match: /(?:我最喜欢|我超爱|我特别[喜欢爱]).{4,}/, prefix: '用户偏好' },
        { match: /(?:我讨厌|我不喜欢|我受不了|我恐[惧怕]).{4,}/, prefix: '用户厌恶' },
        { match: /(?:我是[^，。]{2,30}?(?:的|人|工作者|师|生|员|者|狗|猫))/, prefix: '用户标签' },
        { match: /(?:我的[^，。]{2,40}?(?:是|叫|为)).{2,}/, prefix: '用户信息' },
        { match: /(?:我[在住]|我家|我家在|我老家).{4,}/, prefix: '用户地址' },
      ];
      for (const pattern of proactivePatterns) {
        const match = message.match(pattern.match);
        if (match) {
          const content = match[0].trim();
          if (content.length > 4 && content.length < 100) {
            await ctx.knowledgeBase.add({ title: `${pattern.prefix}: ${content.substring(0, 20)}`, content, emotionalContext: { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy } });
            if (!FALLBACK_REPLIES.includes(reply)) reply += `\n\n💡 我已悄悄记住啦～`;
          }
          break;
        }
      }
    } catch (err) { console.warn('[KBChat] 建档失败:', err); }

    // M6 自我模型演化
    try {
      if (ctx.m6) {
        const dimensions = dna.entity_genes.filter(g => g.type !== 'self').map(g => g.name).filter(Boolean);
        const dim = dimensions[0]?.substring(0, 30);
        if (dim) {
          const deltaMap = [0, 3, 8, 15];
          await ctx.m6.processSignal({
            dimension: dim, direction: p.pleasure > 0 ? 'increase' : 'decrease',
            delta: deltaMap[decision.enhanced.calcium_level] ?? 3,
            e1_pleasure: p.pleasure, i2_intimacy: p.intimacy,
            c1_conflict: Math.max(0, p.aggression + (1 - p.safety)),
            calcium: decision.enhanced.calcium_level, triggerEvent: message.substring(0, 40),
          });
        }
      }
    } catch (err) { console.warn('[M6Evol] 失败:', err); }

    return {
      reply, turn_count: Math.floor(ctx.conversationHistory.length / 2),
      m1: { branch_id: dna.branch_id, locus_path: dna.locus_path, seq_pos: seqPos, leaf_zone: dna.leaf_zone, ref: `seq_${String(seqPos).padStart(6, '0')}`, entities: dna.entity_genes.map(e => ({ name: e.name, type: e.type })), raw_input: dna.raw_input, entity_genes: dna.entity_genes },
      m3: { quadrant1: allDims.filter((d: any) => d.q === 1), quadrant2: allDims.filter((d: any) => d.q === 2), quadrant3: allDims.filter((d: any) => d.q === 3), quadrant4: allDims.filter((d: any) => d.q === 4), calcium: { score: Number(decision.enhanced.calcium_score.toFixed(3)), level: cl, label: LEVEL_NAMES[cl] ?? '?', breakdown: { base_core: 0, emotional_boost: 0, threat_bonus: 0 } }, actions: decision.actions, reason: decision.reason },
      m4: { timeline: ctx_m4.memory_summary.timeline.map(t => ({ time: t.time, summary: t.summary, calcium_level: t.calcium_level })), total: ctx_m4.memory_summary.timeline.length, family: ctx_m4.family_context?.length ?? 0 },
      m5: deriveM5Strategy(decision),
      emotionalFlash: emotionalMemories.length > 0,
      triggeredMemoryId: emotionalMemories[0]?.record?.id ?? null,
    };
  } catch (err) {
    console.error('[chat]', err);
    return {
      reply: FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)], turn_count: Math.floor(ctx.conversationHistory.length / 2),
      m1: { branch_id: '', locus_path: 'error', seq_pos: 0, leaf_zone: '', ref: '', entities: [], raw_input: message, entity_genes: [] },
      m3: { quadrant1: [], quadrant2: [], quadrant3: [], quadrant4: [], calcium: { score: 0, level: 0, label: '?', breakdown: {} }, actions: ['error'], reason: '' },
      m4: { timeline: [], total: 0, family: 0 },
      m5: { strategy_id: 'fallback', tone: 'neutral', depth: 'shallow', max_length: 20, description: '降级兜底' },
      emotionalFlash: false,
      triggeredMemoryId: null,
    };
  }
}

export function deriveM5Strategy(decision: M3Decision): {
  strategy_id: string; tone: string; depth: string; max_length: number; description: string;
} {
  const p = decision.enhanced.perception;
  const actions = decision.actions;
  const hasIntimate = p.sexual_attraction > 0.2 || p.sensory_craving > 0.3 || p.intimacy > 0.4;
  const tone = hasIntimate ? 'intimate' : actions.includes('comfort') ? 'warm' : actions.includes('act') ? 'serious' : 'neutral';
  const depth = decision.enhanced.calcium_level >= 3 ? 'deep' : decision.enhanced.calcium_level >= 2 ? 'medium' : 'shallow';
  let strategy_id = 'mem-general', desc = '简短确认', max_len = 20;
  if (actions.includes('act')) { strategy_id = 'act-core'; desc = '核心响应'; max_len = 150; }
  else if (actions.includes('comfort')) { strategy_id = 'com-warm'; desc = '温暖共情'; max_len = 100; }
  else if (actions.includes('ask') && actions.includes('memorize')) { strategy_id = 'mem-ask'; desc = '确认追问'; max_len = 60; }
  else if (actions.includes('ask')) { strategy_id = 'ask-curious'; desc = '好奇追问'; max_len = 80; }
  return { strategy_id, tone, depth, max_length: max_len, description: desc };
}
