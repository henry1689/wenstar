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

import { extractRelations, storeRelations, FAMILY_MAP, guessRelationOptions } from '../app/knowledge/RelationshipExtractor.js';

import { researchTopic } from '../app/knowledge/WebResearchService.js';

import { decideMode, buildGuard, type MemoryGateOutput } from '../app/conversation/MemoryGate.js';

import { generateCandidates, type CandidateSet } from '../m5/CandidateSelector.js';

// 仿生智脑适配器（可选依赖 — 不可用时降级）

import { bionic } from '../adapter/bionic-adapter.js';

import type { VadSpectrum, BionicSearchResult } from '../adapter/bionic-adapter.js';

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

  somaticMemory?: any;

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

  vad_spectrum?: any | null;

  /** 候选回复（用户可选择偏好风格） */

  candidates?: any | null;

}

/** 获取 VAD 驱动的 tone 校准 — 调用 8100 谱曲引擎获取数值，用 V/A/dominant 决定 tone */

async function getVadToneHint(message: string): Promise<string> {

  try {

    const vadResp = await fetch('http://localhost:8100/api/v1/emotion/compose', {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ text: message }),

    });

    if (!vadResp.ok) return '';

    const vadData = await vadResp.json();

    const v: number = vadData.overall?.valence ?? 0;

    const a: number = vadData.overall?.arousal ?? 0;

    const dom: string = vadData.overall?.dominant_emotion ?? '';

    const arc: string = vadData.overall?.emotional_arc ?? '';

    const peaks: Array<{ intensity: number; peak_type: string }> = vadData.peaks ?? [];

    const hasPeak = peaks.length > 0 && peaks[0].intensity > 0.7;

    const hints: string[] = [];

    // VAD 数值驱动 tone：不靠关键词，靠情感数值

    const emotionToTone: Record<string, string> = {

      '极乐': '🎯VAD驱动→【极乐】快感接近临界。用原始狂野的 tone 接住——不要温柔克制。',

      '依恋': '🎯VAD驱动→【依恋】情感底色是依恋和占有。用危险宠溺回应，不要悲伤害怕。',

      '掌控': '🎯VAD驱动→【掌控】权力游戏。用低沉命令的 tone 接住，不要温柔安慰。',

      '挑逗': '🎯VAD驱动→【挑逗】调情。用靠近低笑的 tone 接，不要当真严肃。',

      '温存': '🎯VAD驱动→【温存】求温暖。用温柔慵懒的 tone 回应。',

    };

    if (emotionToTone[dom]) {

      hints.push(emotionToTone[dom]);

    }

    // 数值增强

    if (v > 0.85 && a > 0.85) {

      hints.push('[VAD] 极高唤醒+效价→高潮临界表达。用极度热烈的 tone 回应。');

    } else if (v < -0.3 && (dom === '依恋' || dom === '掌控')) {

      hints.push('[VAD] 效价' + v.toFixed(2) + ',主导=' + dom + '→语义反转。用宠溺/掌控回应。');

    }

    if (hasPeak) {

      hints.push('[VAD] 情感峰值强度' + peaks[0].intensity.toFixed(2) + '→饱满情感浓度回应。');

    }

    if (arc && arc !== dom) {

      hints.push('[VAD] 情感弧线: ' + arc);

    }

    return hints.length > 0 ? hints.join('\n') : '';

  } catch (err) {

    console.warn('[VADTone] 调用失败:', (err as Error).message);

    return '';

  }

}

/**

 * 本地语境快速判定 — 整句语义优先：判断情感是否直接对玉瑶表达

 * 注意：这里是快速本地判定（无VAD），只拦截明显的叙事型句子。

 * 亲密呓语（"操死我"等）即使无"你"也默认放行。

 */

function isDirectedEmotion(message: string): boolean {

  const text = message.trim();

  if (!text) return true;

  const hasDirectAddress = /[你您]/.test(text);

  const isFirstPersonNarrative = /我(?:以前|曾经|那时|过去|觉得|认为|当时|以前)/.test(text);

  const isThirdPerson = /[他她它]/.test(text);

  // 分句检测："你"+情感词在同一分句 → 最可靠的指向信号

  const segments = text.split(/[，,。.；;！!？?\n\n]/);

  for (const seg of segments) {

    if (/你/.test(seg) && /喜欢|开心|高兴|快乐|难过|悲伤|兴奋|激动|爱|想|恨|爽|舒服/.test(seg)) {

      return true;

    }

  }

  // 明确的叙事/他人描述 → 不触发（即使包含情感词）

  if (isFirstPersonNarrative && !hasDirectAddress) return false;

  if (isThirdPerson && !hasDirectAddress) return false;

  // 明确的叙事/描述他人 → 不触发

  if (isFirstPersonNarrative && !hasDirectAddress) return false;

  if (isThirdPerson && !hasDirectAddress) return false;

  // 无"你"且无情感词 + 无亲密词 → 中性句，不触发

  // "今天天气不错" 不表达任何情感

  if (!hasDirectAddress) {

    const hasEmotionWord = /喜欢|开心|高兴|快乐|难过|悲伤|痛苦|幸福|兴奋|激动|爱|想|恨|哭|笑|爽|舒服|难受|憋|痒|麻|软|硬|热|暖|敏感|疼|痛/.test(text);

    const hasIntimateWord = /操|干|日|舔|咬|插|顶|揉|捏|掐|摸|吻|吸|骚|浪|湿|水|屌|鸡|奶|肿|硬/.test(text);

    if (!hasEmotionWord && !hasIntimateWord) return false;

  }

  // 有情感词但无"你" + "我" → 自述叙事，非对玉瑶表达

  // "我最喜欢画画了" "我喜欢吃苹果" 表达自己的爱好，不是对玉瑶说

  if (!hasDirectAddress) {

    const hasEmotionWord = /喜欢|开心|高兴|快乐|难过|悲伤|痛苦|幸福|兴奋|激动|爱|想|恨|哭|笑|爽|舒服|难受|憋|痒|麻|软|硬|热|暖|敏感|疼|痛/.test(text);

    if (hasEmotionWord && /我/.test(text)) return false;

  }

  // 其他情况（包括"杀了你""操死我"等呓语）→ 默认放行

  // VAD 驱动的精确判定在后端 8100 的 context_relevance 中完成

  return true;

}

export async function processChat(message: string, ctx: ChatContext): Promise<ChatResponse> {

  try {

    const dna = ctx.encoder.encodeSingle(message);

    const decision = ctx.m3.decide(dna, { current_time: new Date().toISOString(), current_location: '深圳' });

    const p = decision.enhanced.perception;

    const seqPos = ctx.storage.reserveNextSeq();

    ctx.workingMemory.push(dna, p, seqPos);

    ctx.consolidationQueue.recordActivity();

    // 修复：enrichedHistory 只保留最近 20 轮对话原文，干净不掺杂记忆注入
    // 记忆以【相关记忆】标签注入到 knowledgeBaseText，不伪装成对话内容
    // 修复：干净的三层注入结构——对话原文/enrichedHistory、记忆/memoryFragments、知识/knowledgeBaseText
    let memoryFragments: string[] = [];
    let enrichedHistory = ctx.conversationHistory.slice(-20);

    let emotionalMemories: ScoredMemory[] = [];

    // ═══════════════════════════════════════════════════════════════

    // 上下文连续性检测 —— 优先保持当前话题，记忆只在话题切换时注入

    // ═══════════════════════════════════════════════════════════════

    const recentContext = ctx.conversationHistory.slice(-3).map(t => t.content).join('').slice(-200);

    const isFollowUp = /[那这]个|然后|还有|后来|可是|但是|而且|再|又|还|呢|吧|吗/.test(message) && message.length < 30;

    const hasNewEntity = dna.entity_genes.some(g => g.name && !recentContext.includes(g.name));

    const hasContinuationMarkers = /嗯|对|好|行|是|是的|没错|就是|[那这]样/.test(message) && message.length < 20;

    const isTopicShift = hasNewEntity || (!isFollowUp && !hasContinuationMarkers);

    // ═══════════════════════════════════════════════════════════════

    // MemoryGate 记忆层级管控 — 判定对话模式，智能选择记忆/知识源

    // ═══════════════════════════════════════════════════════════════

    let memoryGate: MemoryGateOutput = { mode: 'casual', needsMemorySearch: false, needsKnowledgeSearch: false, fillerPhrase: '', hallucinationGuard: '', strictMode: false };

    let memoryGateFillerUsed = false;

    try {

      const modeCtx = {

        message,

        recentHistory: ctx.conversationHistory.slice(-6),

        isFollowUp,

        hasNewEntity,

        hasContinuationMarkers,

        calciumLevel: decision.enhanced.calcium_level,

        messageLength: message.length,

      };

      const modeDecision = decideMode(modeCtx);

      memoryGate = buildGuard(modeDecision.mode, false, false);

      // 如果用户明确在回忆或查知识，生成过渡话术

      if (memoryGate.fillerPhrase && !/知识库|看过|记得|印象/.test(message)) {

        // 过渡话术在进入 M5 前作为 reply 前缀注入

        memoryGateFillerUsed = true;

      }

    } catch (err) { console.warn('[MemoryGate] 失败:', err); }

    try {

      // 上下文连续性检测 —— 优先保持当前话题，记忆只在话题切换时注入

      // 情感传染：过去情绪较高的记忆 → 增强 empathy

      if (isTopicShift) {

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

            entities: uniqueExpanded, limit: 5,

          });

          memories = rerank(memories, q);

          const valid = memories.filter((m: any) =>

            (m.scores.emotional > 0.65 || m.composite > 0.35) && m.record.id !== dna.branch_id

          );

          if (valid.length > 0) allResultSets.push(valid);

        }

        emotionalMemories = mergeDecomposedResults(allResultSets, 3);

        if (relatedEntities.length > 0) {

          const relationMemories = ctx.storage.findMemoriesByEntityNames(relatedEntities.map((r: any) => r.name), 2);

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

        if (freshMemories.length < 2 && !hasContinuationMarkers) {

          const fallback = ctx.storage.findByEmotionalSimilarity({ current_perception: p, similarity_mode: 'balanced', limit: 2 });

          freshMemories = fallback.filter((m: any) =>

            (m.scores.emotional > 0.4 || m.scores.calcium > 0.4) && m.record.id !== dna.branch_id && !recentHistoryRaw.includes(m.record.id)

          );

        }

        const finalMemories = freshMemories.length > 0 ? freshMemories : emotionalMemories.slice(0, 1);

        if (finalMemories.length > 0 && !hasContinuationMarkers) {
          const top = finalMemories[0];
          const userSaid = top.record.raw_input.substring(0, 60);
          const feeling = top.record.calcium_score > 0.6 ? '（这件事当时对你很重要）' : '（我记得你那时候的感觉）';
          memoryFragments.push('【相关记忆】你记得用户南经说过:"' + userSaid + '" ' + feeling);
        }

      }

    } catch (err) { console.warn('[EmotionContagion] 检索失败:', err); }

    // ═══════════════════════════════════════════════════════════════

    // 仿生智脑检索（仅话题切换时调用，且不覆盖当前上下文）

    // ═══════════════════════════════════════════════════════════════

    let bionicMemories: BionicSearchResult[] = [];

    try {

      if (isTopicShift && !hasContinuationMarkers) {

        bionicMemories = await bionic.search(message);

        if (bionicMemories.length > 0 && !memoryFragments.some(f => f.includes(bionicMemories[0].core_facts?.substring(0, 40) || ''))) {
          const text = bionicMemories[0].core_facts || bionicMemories[0].topic || '';
          memoryFragments.push('【记忆联想】' + text.substring(0, 100));

          enrichedHistory.unshift({ role: 'assistant', content: inject });

        }

      }

    } catch (err) { console.warn('[BionicSearch] 仿生智脑检索失败:', err); }

    // 躯体上下文注入（SomaticMemory → LLM 上下文 — 五重铁律协议③）

    try {

      if (ctx.somaticMemory) {

        const somaticContext = ctx.somaticMemory.getActiveSomaticContext();

        if (somaticContext) {
          memoryFragments.push('【当下感受】' + somaticContext);
        }

      }

    } catch (err) { console.warn('[SomaticContext] 注入失败:', err); }

    // 知识库检索（由 MemoryGate 管控）

    let knowledgeBaseText = '';

    if (memoryGate.needsKnowledgeSearch || /知识库|看过|知道.*吗|有没有|是否|曾经/.test(message)) {

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

      // 实体重叠 → 关联知识检索（即使关键词搜索无结果，也能通过相同实体找到关联知识）

      try {

        const entityNames = dna.entity_genes.map(e => e.name);

        if (entityNames.length > 0) {

          const overlapResults = ctx.storage.findKnowledgeByEntityOverlap(entityNames, 3);

          if (overlapResults.length > 0) {

            const overlapText = overlapResults.map(k => `📄 ${k.title}\n${k.content.substring(0, 1500)}`).join('\n\n');

            knowledgeBaseText = knowledgeBaseText

              ? knowledgeBaseText + '\n\n【关联知识】\n' + overlapText

              : overlapText;

          }

        }

      } catch (err) { console.warn('[EntityOverlap] 关联知识检索失败:', err); }

    } catch (err) { console.warn('[KnowledgeSearch] 检索失败:', err); }

    } // end MemoryGate knowledge gate

        // ═══════════════════════════════════════════════════════════════

    // 情感谱曲引擎(8100)VAD驱动 — 用数值驱动 tone，而非关键词

    // ═══════════════════════════════════════════════════════════════

    try {

      // ① 获取 VAD 谱曲（当前消息的实时情感分析）

      const toneHint = await getVadToneHint(message);

      if (toneHint) console.log('[VADTone] toneHint: ' + toneHint.substring(0, 80));

      // ② 同时获取知识库曲谱清单（作为背景知识）

      let scoreText = '';

      const scoreResp = await fetch('http://localhost:8100/api/v1/emotion/knowledge/export?min_intensity=0.85');

      if (scoreResp.ok) {

        const scoreData = await scoreResp.json();

        const entries: Array<{ term: string; category: string; intensity: number; reversal: boolean }> = scoreData.entries || [];

        if (entries.length > 0) {

          const catLabels: Record<string, string> = { 'EX_': '极乐','FL_': '挑逗','IN_': '依恋','DO_': '掌控','TE_': '张力','AF_': '温存' };

          scoreText = '\n【情感曲谱库】以下是你掌握的亲密表达知识（供参考）：\n';

          const byCat: Record<string, typeof entries> = {};

          for (const e of entries) { const c = e.category || '??'; if (!byCat[c]) byCat[c] = []; byCat[c].push(e); }

          for (const [code, label] of Object.entries(catLabels)) {

            const es = byCat[code];

            if (!es?.length) continue;

            const terms = es.sort((a: any, b: any) => b.intensity - a.intensity).map((e: any) => '\u300c' + e.term + '\u300d').join(' ');

            scoreText += label + ': ' + terms + '\n';

          }

          console.log('[EmotionScore] 已注入 ' + entries.length + ' 条情感曲谱');

        }

      }

      // ③ 整合 toneHint + scoreText -> knowledgeBaseText

      if (toneHint || scoreText) {

        const combined = (toneHint + '\n\n' + scoreText).trim();

        if (knowledgeBaseText) {

          knowledgeBaseText = combined + '\n\n' + knowledgeBaseText;

        } else {

          knowledgeBaseText = combined;

        }

      }

    } catch (err) { console.warn('[VADTone] 谱曲引擎(8100)不可用，跳过:', (err as Error).message); }

    // 线索协助（集成仿生智脑检索结果，生成区分性反问）

    let clueReply: string | null = null;

    try {

      const clueResult = await ctx.clueAssistant.processUserInput({

        originalQuery: message, perception: p, m8Engine: ctx.m8,

        bionicMemories: bionicMemories,  // 让线索系统知道外部记忆中有什么不同的场景

      });

      if (clueResult.needsQuestion && clueResult.questionText) {

        clueReply = clueResult.questionText;

      } else if (clueResult.isReady && clueResult.searchResult?.entries.length) {

        const top = clueResult.searchResult.entries[0];

        memoryFragments.push('【线索回忆】找到了相关的记忆片段');

      }

    } catch (err) { console.warn('[ClueAssistant] 失败:', err); }

    const ctx_m4 = await ctx.m4.orchestrate(decision, emotionalMemories);

    // M4 知识融合

    // ── MemoryGate 幻觉防护 — 基于实际检索结果生成精确防护

    let hallucinationGuard = '';

    try {

      const hasMemory = emotionalMemories.length > 0;

      const hasKnowledge = knowledgeBaseText.length > 0;

      memoryGate = buildGuard(memoryGate.mode, hasMemory, hasKnowledge);

      hallucinationGuard = memoryGate.hallucinationGuard;

      // fillerPhrase 会在 M5 回复生成后由外层注入

    } catch (err) { console.warn('[MemoryGate] 防护构建失败:', err); }

    // ── 幻觉防护：检测用户提到不存在的事物 ──

    if (!hallucinationGuard) hallucinationGuard = '';

    // ═══════════════════════════════════════════════════════════════

    // 三源熔铸 — 感知驱动的知识/记忆/家族动态权重（白皮书 §1.2 锚点5）

    // 不修改现有检索逻辑，仅在最终组合时做一次感知驱动的重排

    // ═══════════════════════════════════════════════════════════════

    try {

      const { fuseSources } = await import('../app/fusion/FusionEngine.js');

      const fused = fuseSources({

        perception: p,

        knowledgeBaseText,

        memorySummary: ctx_m4.memory_summary,

        familyContext: ctx_m4.family_context,

      });

      if (fused.fusedText !== knowledgeBaseText) {

        knowledgeBaseText = fused.fusedText;

        console.log('[Fusion] ' + fused.decision);

      }

    } catch (err) { console.warn('[Fusion] 三源熔铸失败(降级为拼接):', err); }

    // 检测"X是我的Y"介绍模式，LLM 不能说"记得你说过"

    const introMatch = message.match(/([一-龥]{2,4})是我(?:的)?([一-龥]{2,4})/);

    if (introMatch) {

      const name = introMatch[1];

      const prevChats = ctx.conversationHistory.map(t => t.content).join('');

      if (!prevChats.includes(name) && !hallucinationGuard) {

        hallucinationGuard = `⚠️ 用户第一次向你介绍"${name}"，你之前不知道他。不要假装听说过或记得。`;

      }

    }

    // ── 家族/社交关系幻觉防护（铁律：必须以记录为准，不得编造） ──

    try {

      const personEntities = ctx_m4.family_context || ctx_m4.social_context || [];

      if (personEntities.length > 0) {

        const knownRelations = personEntities.map((p: any) => p.entity + '（' + p.relation + '）').join('、');

        if (knownRelations && !hallucinationGuard) {

          hallucinationGuard = '📋 以下是鸿鸣的家庭/社交关系，以实际记录为准：' + knownRelations + '。如果用户问到这些记录中没有的人或关系，不要假装知道，委婉说"不太记得了"。';

        }

      }

      const mentionedPerson = dna.entity_genes.find((g: any) => g.type === 'person' && g.name !== '我');

      if (mentionedPerson && personEntities.length === 0 && !hallucinationGuard) {

        const pName = mentionedPerson.name;

        hallucinationGuard = '⚠️ 用户提到了"' + pName + '"，但你不认识这个人。不要假装知道他是谁。如果用户问你是否记得，就说"这个人我好像没什么印象，你跟我讲讲呗？"';

      }

    } catch (err) { console.warn('[FamilyGuard] 防护构建失败:', err); }

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

    // ⏰ 强制注入当前系统时间

    const now = new Date();

    const beijingTime = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

    const timeGuard = `[当前时间] ${beijingTime}（北京时间）——回答时间问题时必须以此为准，不能编造。`;

    // 通用幻觉防护：禁止编造过去事件、日期、用户生活细节
    const memoryGuard = '注意：你没有记忆的过去事件、日期、穿着、对话内容绝对不能编造。不确定就说不记得了。宁可少说，不能说错。';

    // 知识分类反问（仅在casual/中性场景触发，以guard message形式注入，不追加到reply末尾）
    let classificationGuard = '';
    try {
      const isIntimate = (p && (p.intimacy > 0.3 || p.sexual_attraction > 0.2 || p.sensory_craving > 0.3));
      const isDistressed = (p && p.pleasure < -0.2);
      const isCasual = !isIntimate && !isDistressed;
      if (isCasual) {
        const oneDayMs = 86400000;
        const unclassifiedItems = ctx.knowledgeBase.getUnclassified(3);
        for (const item of unclassifiedItems) {
          const title = (item.title || '').substring(0, 20);
          const alreadyAsked = ctx.conversationHistory.some(
            (t) => t.role === 'assistant' && t.content && t.content.includes(title)
          );
          if (!alreadyAsked) {
            const age = Date.now() - new Date(item.created_at).getTime();
            if (age > oneDayMs && age > 30 * oneDayMs) {
              classificationGuard = '📋 用户之前提到过"' + title + '"还没分类，有空跟我说说这是关于什么的？';
              break;
            }
          }
        }
      }
    } catch (err) { console.warn('[Classify] 分类反问失败:', err); }

    const allGuardMsgs = [hallucinationGuard, repeatHint, feelingGuard, dailyGuard, timeGuard].filter(Boolean).join('\n');

    let reply: string;

    if (clueReply) {

      reply = clueReply;

    } else {

      // ⏰ 时间问题拦截器（不依赖 LLM provider，确保时间绝对正确）

      // ⚠️ 使用 \b 和限定长度匹配，防止"现在.*时候"跨句匹配长文本

      const timeMatch = message.length < 100 && (

        /^.*(?:现在几点了|几点了|现在时间|什么时间|什么时候|今天星期|星期几|今天[是]?[几号日期])/.test(message) ||

        /^.{0,20}几点.{0,10}了/.test(message) ||

        /^.{0,20}现在.{0,20}时候/.test(message)

      );

      if (timeMatch) {

        const now = new Date();

        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

        const h = now.getHours();

        const m = now.getMinutes();

        const ampm = h >= 12 ? '下午' : '上午';

        const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;

        const timeStr = `${ampm}${hour12}点${m > 0 ? m + '分' : ''}`;

        reply = `（看了眼手机）现在${timeStr}。${now.getMonth() + 1}月${now.getDate()}日，星期${weekdays[now.getDay()]}。`;

      } else {

        const guardMsg: ConversationTurn = { role: 'assistant', content: allGuardMsgs };

        const enrichedWithGuard = allGuardMsgs ? [...enrichedHistory, guardMsg] : enrichedHistory;

        // MemoryGate: 如果有过渡话术且memory/knowledge模式，注入到知识库文本让LLM自然表达

        let finalKnowledgeText = knowledgeBaseText;

        if (memoryGate.fillerPhrase && (memoryGate.mode === 'memory_recall' || memoryGate.mode === 'vague_recall' || memoryGate.mode === 'knowledge_query')) {

          const innerThought = '【内心独白】' + memoryGate.fillerPhrase.replace(/[。！？]/g, '…') + '…';

          finalKnowledgeText = innerThought + (knowledgeBaseText ? '\n\n' + knowledgeBaseText : '');

          memoryGateFillerUsed = true;

        }

        // 将记忆碎片合并到 finalKnowledgeText（干净注入，不污染对话历史）
        if (memoryText && !finalKnowledgeText.includes('【相关记忆】')) {
          finalKnowledgeText = memoryText + (finalKnowledgeText ? '

' + finalKnowledgeText : '');
        }

        try {

        reply = await ctx.m5.orchestrate(ctx_m4, enrichedWithGuard, finalKnowledgeText, message);

        // 候选回复生成（不阻塞主回复 — 默认不活跃，待前端请求时使用）

        // 只有非线索回复、非时间回答时才生成候选

        if (!clueReply && !timeMatch) {

          try {

            const primaryStrategy = deriveM5Strategy(decision);

            const candidates = generateCandidates({

              m4ctx: ctx_m4,

              conversationHistory: enrichedWithGuard,

              knowledgeBase: finalKnowledgeText,

              userMessage: message,

              primaryStrategy: { strategy_id: primaryStrategy.strategy_id, params: { tone: primaryStrategy.tone, max_length: primaryStrategy.max_length, include_entity: [], include_history: false, include_family: false }, description: primaryStrategy.description },

              primaryTone: primaryStrategy.tone,

              primaryDepth: primaryStrategy.depth,

            });

            // 将候选注入到返回对象（通过 closure 变量的方式）

            // 实际在最终 return 中使用

            (globalThis as any).__lastCandidates = candidates;

          } catch (err) { console.warn('[Candidates] 候选生成失败:', err); }

        }

      } catch (err) { console.error('[Chat] M5失败:', err); reply = FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)]; }

      }

    }

    // 持久化对话历史（故障重启后自动恢复，带时间戳）

    const nowTs = new Date().toISOString();

    ctx.conversationHistory.push({ role: 'user', content: message, timestamp: nowTs });

    ctx.conversationHistory.push({ role: 'assistant', content: reply, timestamp: nowTs });

    ctx.saveConversationHistory();

    // 躯体感知记录（SomaticMemory — 五重铁律协议③）

    try {

      if (ctx.somaticMemory) {

        ctx.somaticMemory.record(message);

      }

    } catch (err) { console.warn('[Somatic] 记录失败:', err); }

    const cl = decision.enhanced.calcium_level;

    const allDims: any[] = [];

    for (const [key, meta] of Object.entries(PERC_LABELS)) {

      const val = (p as any)[key];

      if (typeof val === 'number') allDims.push({ label: meta.label, key, value: Number(val.toFixed(3)), q: meta.q });

    }

    const m5s = deriveM5Strategy(decision);

    // 梦境生成（修复: 改为 calcium>=2 才触发，避免每轮对话都生成低质量梦境条目）

    // 设计文档 §3.1 — 只对固体级(钙化≥2)以上的重要交互生成梦境

    try {

      if (ctx.m7 && dna.entity_genes.length > 0 && decision.enhanced.calcium_level >= 2) {

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

        // 跳过亲密/脏话关键词（避免"操死""弄坏"等污染知识库）

        const intimateSkip = ['操','干','日','插','顶','舔','吸','咬','揉','捏','掐','摸','吻','骚','浪','奶','鸡','肉','屌','阴','淫','湿','水','抱','贴','蹭','扭','喘'];

        if (!intimateSkip.some(w => keyword.includes(w))) {

          researchTopic(keyword, ctx.storage.getSQLite()).then(result => {

            if (result) { ctx.topicTracker.markResearched(keyword, result.entryId); console.log(`[DreamResearch] ✅ 研究了「${keyword}」`); }

          }).catch(err => console.warn('[DreamResearch] 失败:', err));

        }

      }

    } catch (err) { console.warn('[TopicTracker] 失败:', err); }

    // 主动建档 + 人际关系

    try {

      const relations = extractRelations(message);

      if (relations.length > 0) {

        const sqlite = ctx.storage.getSQLite();

        const stored = storeRelations(sqlite, relations, message);

        if (stored > 0 && !FALLBACK_REPLIES.includes(reply)) {

          reply += `\n\nð¥已记住「${relations.map(r => r.personName).join('、')}」的关系～`;

        }

        // 同步社交关系到 FamilyGraph（非家庭关系→社交图谱边，与家族图谱互补）

        try {

          const familyWords = new Set(Object.keys(FAMILY_MAP));

          const socialTypeMap: Record<string, string> = {

            '同事': 'colleague_of', '同学': 'classmate_of', '室友': 'roommate_of',

            '老板': 'boss_of', '上司': 'boss_of', '领导': 'boss_of',

            '下属': 'subordinate_of', '部下': 'subordinate_of',

            '客户': 'client_of', '朋友': 'friend_of',

            '合伙人': 'partner_of', '邻居': 'neighbor_of',

            '老师': 'teacher_of', '医生': 'doctor_of', '顾问': 'consultant_of',

          };

          for (const rel of relations) {

            if (rel.rawRelation && !familyWords.has(rel.rawRelation) && socialTypeMap[rel.rawRelation]) {

              await ctx.m4.getFamilyGraph().integrateSocialRelation(rel.personName, socialTypeMap[rel.rawRelation], message);

            }

          }

        } catch (err) { console.warn('[SocialGraph] 社交图谱同步失败:', err); }

        // 社交关系反问：检测到未明确的"其他"关系时，主动询问用户以精准归类

        try {

          const unclassified = relations.filter(r => r.relation === '其他' && !r.rawRelation);

          for (const rel of unclassified) {

            const personName = rel.personName;

            // 避免重复追问同一人

            const askedKey = 'asked_rel_' + personName;

            const alreadyAsked = ctx.conversationHistory.some(

              t => t.role === 'assistant' && t.content && t.content.includes(personName) && t.content.includes('同事')

            );

            if (!alreadyAsked) {

              const options = guessRelationOptions(rel.context);

              const optionText = options.length > 1

                ? options.slice(0, -1).join('、') + '还是' + options[options.length - 1]

                : options[0];

              reply += '\n\n❓ 你说的' + personName + '是你的' + optionText + '呀？';

              break; // 一次只问一个人

            }

          }

        } catch (err) { console.warn('[ClarifyRelation] 反问失败:', err); }

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

            // 去重: 检查标题前缀是否已存在（修复: 之前每次匹配都新增导致"我工作在XX"存3次）

            const existing = await ctx.knowledgeBase.search(content.substring(0, 20), 1);

            if (existing.length === 0 || !existing.some((e: any) => e.title?.includes(pattern.prefix))) {

              await ctx.knowledgeBase.add({ title: `${pattern.prefix}: ${content.substring(0, 20)}`, content, emotionalContext: { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy }, classification: '用户资料' });

              if (!FALLBACK_REPLIES.includes(reply)) reply += `\n\n💡 我已悄悄记住啦～`;

            }

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

    // ═══════════════════════════════════════════════════════════════

    // 异步存储歌单（歌词+曲谱）到仿生智脑

    // ═══════════════════════════════════════════════════════════════

    let vadSpectrum: VadSpectrum | null = null;

    (async () => {

      try {

        // 1. 情感谱曲（获取 VAD）

        vadSpectrum = await bionic.composeEmotion(message);

        // 2. 整合歌单 → 存入仿生智脑

        await bionic.storeSongSheet({

          topic: message.substring(0, 50),

          turns: [

            { role: 'user', content: message },

            { role: 'assistant', content: reply },

          ],

          emotion24d: p,

          vad: vadSpectrum,

          userId: 'default_user',

        });

        if (vadSpectrum) console.log('[BionicStore] 歌单已存入（含VAD谱曲）');

        else console.log('[BionicStore] 歌单已存入（纯歌词，待谱曲）');

        // 3. 同步 VAD 谱曲到本地 M2 SQLite（歌单完整性）

        try {

          ctx.storage.updateVadSpectrum(dna.branch_id, vadSpectrum);

        } catch (err) { console.warn('[BionicStore] 本地VAD同步失败:', err); }

      } catch (err) { console.warn('[BionicStore] 存储失败:', err); }

    })();

    const candidates = (globalThis as any).__lastCandidates;

    (globalThis as any).__lastCandidates = null;

    return {

      reply, turn_count: Math.floor(ctx.conversationHistory.length / 2),

      vad_spectrum: vadSpectrum,

      m1: { branch_id: dna.branch_id, locus_path: dna.locus_path, seq_pos: seqPos, leaf_zone: dna.leaf_zone, ref: `seq_${String(seqPos).padStart(6, '0')}`, entities: dna.entity_genes.map(e => ({ name: e.name, type: e.type })), raw_input: dna.raw_input, entity_genes: dna.entity_genes },

      m3: { quadrant1: allDims.filter((d: any) => d.q === 1), quadrant2: allDims.filter((d: any) => d.q === 2), quadrant3: allDims.filter((d: any) => d.q === 3), quadrant4: allDims.filter((d: any) => d.q === 4), calcium: { score: Number(decision.enhanced.calcium_score.toFixed(3)), level: cl, label: LEVEL_NAMES[cl] ?? '?', breakdown: { base_core: 0, emotional_boost: 0, threat_bonus: 0 } }, actions: decision.actions, reason: decision.reason },

      m4: { timeline: ctx_m4.memory_summary.timeline.map(t => ({ time: t.time, summary: t.summary, calcium_level: t.calcium_level })), total: ctx_m4.memory_summary.timeline.length, family: ctx_m4.family_context?.length ?? 0 },

      m5: deriveM5Strategy(decision),

      emotionalFlash: emotionalMemories.length > 0 && isDirectedEmotion(message),

      triggeredMemoryId: emotionalMemories[0]?.record?.id ?? null,

      candidates: candidates || null,

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

      vad_spectrum: null,

      candidates: null,

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
