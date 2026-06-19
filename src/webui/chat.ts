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
import type { MasterProfileService } from '../app/profile/MasterProfileService.js';

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
import { AsyncTaskQueue } from '../app/tools/AsyncTaskQueue.js';
import { ingestFromConversation } from '../app/ingestion/ConversationIngestionService.js';

// 全局异步任务队列（VAD 谱曲等不阻塞主回复的后台任务）
const chatTaskQueue = new AsyncTaskQueue({ concurrency: 1, retryCount: 1, autoRemoveCompleted: true });

export interface ChatContext {

  encoder: DNAEncoder;

  storage: FusionStorageAdapter;

  m3: M3LogicOrchestrator;

  m4: M4Orchestrator;

  m5: M5Orchestrator;

  m6?: M6Orchestrator;

  m7?: M7Orchestrator;

  masterProfile?: MasterProfileService;

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

/** 仿生智脑降级检索（抽离为独立函数，仅在话题切换时调用）
 *  ① 外部结果自动绑定当前 scene_tags + 情感标签
 *  ② 按情绪匹配度过滤（愉悦度冲突时丢弃）
 *  ③ 记录本地优先日志
 */
async function fetchBionicMemories(
  message: string,
  isTopicShift: boolean,
  hasContinuationMarkers: boolean,
  memoryFragments: string[],
  enrichedHistory: ConversationTurn[],
  perception?: { pleasure: number; arousal: number; intimacy: number },
  sceneTags?: string[],
): Promise<BionicSearchResult[]> {
  if (!isTopicShift || hasContinuationMarkers) return [];
  try {
    // ③ 本地优先日志
    const localMatchCount = memoryFragments.length;
    console.log(`[External] 触发外部检索: 本地匹配数=${localMatchCount}, 原因=场景"${(sceneTags || []).join(',')}"需要补充`);

    const bionicMemories = await bionic.search(message);
    if (bionicMemories.length === 0) return [];

    // ② 按情绪匹配度过滤：pleasure 冲突时丢弃
    let filteredMemories = bionicMemories;
    if (perception && perception.pleasure < -0.3) {
      // 负面情绪时，只保留情感倾向不明显或匹配的外部知识
      filteredMemories = bionicMemories.filter(m => {
        const text = (m.core_facts || m.topic || '').toLowerCase();
        const harshIndicators = ['数据', '统计', '研究显示', '调查', '报告', '标准', '正常范围'];
        const hasHarsh = harshIndicators.some(w => text.includes(w));
        return !hasHarsh; // 负面情绪时过滤掉冰冷数据型内容
      });
    }

    // ① 结果打标签（跟随当前上下文）
    const taggedResults = filteredMemories.map(m => ({
      ...m,
      _scene_tags: sceneTags || [],
      _emotion: perception ? { pleasure: perception.pleasure, arousal: perception.arousal } : null,
    }));

    if (taggedResults.length > 0 && !memoryFragments.some(f => f.includes(taggedResults[0].core_facts?.substring(0, 40) || ''))) {
      const text = taggedResults[0].core_facts || taggedResults[0].topic || '';

      // ④ 情感化改写：根据当前情绪给外部知识加适配前缀
      let externalPrefix = '【外部参考】';
      if (perception) {
        if (perception.pleasure < -0.3) {
          externalPrefix = '【外部参考】这里有一些相关信息，你随便看看就好';
        } else if (perception.pleasure > 0.3) {
          externalPrefix = '【外部参考】我还找到一些有意思的资料';
        } else {
          externalPrefix = '【外部参考】补充一些相关信息';
        }
      }
      memoryFragments.push(externalPrefix + text.substring(0, 100));
      enrichedHistory.unshift({ role: 'assistant', content: '📕 【记忆】' + text.substring(0, 100) });
      console.log(`[External] 已注入外部记忆: ${text.substring(0, 40)}`);
    }
    return taggedResults;
  } catch (err) {
    console.warn('[BionicSearch] 检索失败:', err);
    return [];
  }
}

export const FALLBACK_REPLIES = [
  '嗯～我在呢。你说，我听着。','嗯，我在听。你说。','唔…好呀，你说吧。',
  '嗯～好呀。你说。','好嘞～你说吧，我听着呢。','诶～你说，我在听。',
];

const LEVEL_NAMES = ['粉末','液体','固体','晶体'];

/** 话题追问计数器：追踪用户对同一话题的追问次数 */

const topicAskCount = new Map<string, number>();

/** P3: AQC 记忆强化仪式防重复 */
let _qcRitualDone = false;

/** P3: 成长警示防重复 */
let _qcGrowthAlertDone = false;

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

  m1: { branch_id: string; locus_path: string; seq_pos: number; leaf_zone: string; ref: string; entities: Array<{ name: string; type: string }>; raw_input: string; entity_genes: any[]; scene_tags?: string[]; ambiguity_score?: number };

  m3: { quadrant1: any[]; quadrant2: any[]; quadrant3: any[]; quadrant4: any[]; calcium: { score: number; level: number; label: string; breakdown: any }; actions: string[]; reason: string; primary_emotion?: string; secondary_emotions?: string[]; confidence?: number };

  m4: { timeline: Array<{ time: string; summary: string; calcium_level?: number }>; total: number; family: number };

  m5: { strategy_id: string; tone: string; depth: string; max_length: number; description: string };

  emotionalFlash: boolean;

  triggeredMemoryId: string | null;

  vad_spectrum?: any | null;

  /** 候选回复（用户可选择偏好风格） */

  candidates?: any | null;

  /** 回复质量评分 — 轻量自检，不精确但给 M7/前端参考 */
  emotionMatchScore?: number;
  sceneFitScore?: number;
  /** 融合度风险标记：低于阈值时标记问题类型 */
  riskFlag?: string;

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

    // P3: LLM 辅助实体提取（识别类工具，非创造类）
    try {
      const { extractEntitiesLLM } = await import('../m1/LLMEntityExtractor.js');
      const llmGenerate = async (prompt: string) => {
        const result = await (ctx.llmProvider).generate({
          strategy: { strategy_id: 'entity-extraction', params: { tone: 'neutral', depth: 'shallow', max_length: 300 } } as any,
          cognition: { current: { perception_snapshot: { pleasure: 0, arousal: 0, intimacy: 0, sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, ecstasy: 0, safety: 0.5 }, raw_input: prompt, calcium: 0 } } as any,
          userMessage: prompt,
        });
        return result.text;
      };
      const llmEntities = await extractEntitiesLLM(message, llmGenerate);
      if (llmEntities.length > 0) {
        const existingNames = new Set(dna.entity_genes.map(e => e.name));
        for (const le of llmEntities) {
          if (!existingNames.has(le.name)) {
            existingNames.add(le.name);
            dna.entity_genes.push({ name: le.name, type: le.type, allele: le.name, phenotype: 'neutral', knowledge_type: 'private' } as any);
          }
        }
        console.log('[LLMEntity] 补充 ' + llmEntities.length + ' 个: ' + llmEntities.map(e => e.name).join(','));
      }
    } catch (err) {
      console.warn('[LLMEntity] 失败(静默降级):', (err as Error).message);
    }

    // P3: 答案提取 — 用户回答了玉瑶之前的问题，提取信息更新画像
    try {
      let personGenes = dna.entity_genes.filter((g: any) => g.type === 'person' && g.name !== '我');
      // 如果当前消息没有显式人名但用了"他/她/这人"，从历史找最近被问的人
      if (personGenes.length === 0 && (/^他|^她|^那|^这/.test(message) || message.length < 15) && ctx.m4) {
        const graph = ctx.m4.getFamilyGraph();
        if (graph) {
          for (let i = ctx.conversationHistory.length - 1; i >= 0 && i > ctx.conversationHistory.length - 6; i--) {
            const turn = ctx.conversationHistory[i];
            if (turn.role === 'assistant' && turn.content) {
              // 用姓氏匹配找回复中提到的人名
              const SURNAMES_CHAR = '赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公';
              const nameRegex = new RegExp('([' + SURNAMES_CHAR + '][一-龥]{1,2}|阿[一-龥]|小[一-龥])', 'g');
              const allMatches = turn.content.match(nameRegex);
              if (allMatches) {
                for (const name of allMatches) {
                  const profile = graph.getPersonProfile(name);
                  if (profile) {
                    personGenes.push({ name, type: 'person' } as any);
                    break;
                  }
                }
                if (personGenes.length > 0) break;
              }
            }
          }
        }
      }
      if (personGenes.length > 0 && ctx.m4) {
        const graph = ctx.m4.getFamilyGraph();
        if (graph) {
          // 关系关键词提取
          const relMap: Record<string, string> = { '同事':'同事','同学':'同学','朋友':'朋友','室友':'室友','老板':'老板','上司':'上司','领导':'领导','客户':'客户','合伙人':'合伙人','邻居':'邻居','老师':'老师','医生':'医生','顾问':'顾问','下属':'下属' };
          // 职业关键词提取
          const occHints = [/做(\S+)的/, /在(\S+)上班/, /在(\S+)工作/, /开(\S+)店/, /干(\S+)的/, /(\S+)工程师/, /(\S+)老师/, /(\S+)医生/];
          // 特征关键词
          const traitMap: Record<string, string[]> = { '开朗':['开朗','爱笑','大方'],'幽默':['幽默','搞笑','逗'],'热心':['热心','帮忙','帮了'],'温柔':['温柔','体贴','细心'],'能干':['能干','厉害','强'],'靠谱':['靠谱','可靠','放心'],'有趣':['有趣','好玩','有意思'],'老实':['老实','本分','踏实'] };

          for (const p of personGenes) {
            const profile = graph.getPersonProfile(p.name);
            if (!profile) continue;

            const updates: Record<string, any> = {};

            // 提取关系
            for (const [rel, val] of Object.entries(relMap)) {
              if (message.includes(rel)) { updates.relation_to_user = val; break; }
            }

            // 提取职业
            for (const re of occHints) {
              const m = message.match(re);
              if (m && m[1]) { updates.occupation = m[1]; break; }
            }

            // 提取特征
            const foundTraits: string[] = [];
            for (const [trait, keywords] of Object.entries(traitMap)) {
              if (keywords.some(kw => message.includes(kw))) foundTraits.push(trait);
            }
            if (foundTraits.length > 0) {
              const existing = profile.traits || [];
              updates.traits = [...new Set([...existing, ...foundTraits])];
            }

            if (Object.keys(updates).length > 0) {
              graph.updatePersonProfile(p.name, updates as any);
              console.log('[Profile] 更新画像:', p.name, Object.keys(updates).join(','));
            }
          }
        }
      }
    } catch (err) {
      console.warn('[ProfileExtract] 答案提取失败:', (err as Error).message);
    }

    const decision = ctx.m3.decide(dna, { current_time: new Date().toISOString(), current_location: '深圳' });

    // 主人大脑镜像提取：每轮对话后自动提取+审查+存储
    if (ctx.masterProfile && message.length > 3) {
      try {
        const extractResult = await ctx.masterProfile.extract(
          message,
          decision.enhanced.calcium_score,
          undefined // LLM辅助可选，暂不传
        );
        if (extractResult.subjective.length > 0 || extractResult.objective.length > 0) {
          if (ctx.masterProfile.review(message, decision.enhanced.calcium_score, dna.entity_genes.length > 0)) {
            ctx.masterProfile.store(message, extractResult);
            if (extractResult.subjective.length > 0 || extractResult.objective.length > 0) {
              console.log('[Mirror] 记录:', extractResult.subjective.map(s=>s.category).concat(extractResult.objective.map(o=>o.table)).join(','));
            }
          }
        }
      } catch (err) {
        console.warn('[Mirror] 提取失败:', (err as Error).message);
      }
    }

    const p = decision.enhanced.perception;

    const seqPos = ctx.storage.reserveNextSeq();

    ctx.workingMemory.push(dna, p, seqPos, decision.primary_emotion, decision.secondary_emotions);

    ctx.consolidationQueue.recordActivity();

    // 修复：enrichedHistory 只保留最近 20 轮对话原文，干净不掺杂记忆注入
    // 记忆以【相关记忆】标签注入到 knowledgeBaseText，不伪装成对话内容
    // 修复：干净的三层注入结构——对话原文/enrichedHistory、记忆/memoryFragments、知识/knowledgeBaseText
    let memoryFragments: string[] = [];
    let enrichedHistory = ctx.conversationHistory.slice(-60);
    // 时间导航：检测用户是否在问"昨天/上周说了什么"
    const _tmMatch = message.match(/(昨天|前天|上周|上个月|前几天|最近|刚才)/);
    if (_tmMatch && (message.indexOf('说') >= 0 || message.indexOf('聊') >= 0 || message.indexOf('提') >= 0)) {
      try {
        const _tmNow = new Date();
        const _tmStart = new Date();
        const _tmEnd = new Date();
        const _tmUnit = _tmMatch[1];
        if (_tmUnit === '昨天') { _tmStart.setDate(_tmNow.getDate() - 1); }
        else if (_tmUnit === '前天') { _tmStart.setDate(_tmNow.getDate() - 2); _tmEnd.setDate(_tmNow.getDate() - 1); }
        else if (_tmUnit === '上周') { _tmStart.setDate(_tmNow.getDate() - 7); }
        else if (_tmUnit === '上个月') { _tmStart.setMonth(_tmNow.getMonth() - 1); }
        else if (_tmUnit === '前几天') { _tmStart.setDate(_tmNow.getDate() - 3); }
        else if (_tmUnit === '刚才') { _tmStart.setHours(_tmNow.getHours() - 1); }
        const _tmRows = ctx.storage.getSQLite().findByTimeRange(_tmStart.toISOString(), _tmEnd.toISOString(), 8);
        if (_tmRows && _tmRows.length > 0) {
          const _tmTexts = _tmRows.map(function(r){return r.content;}).filter(Boolean).join(' | ').substring(0, 300);
          memoryFragments.push('【时间检索】' + _tmUnit + '的对话：' + _tmTexts);
          console.log('[TimeNav] ' + _tmUnit + ' 检索到 ' + _tmRows.length + ' 条');
        }
      } catch (err) {
        console.warn('[TimeNav] 检索失败:', err);
      }
    }


    let emotionalMemories: ScoredMemory[] = [];

    // ═══════════════════════════════════════════════════════════════

    // 上下文连续性检测 —— 优先保持当前话题，记忆只在话题切换时注入

    // ═══════════════════════════════════════════════════════════════

    const recentContext = ctx.conversationHistory.slice(-3).map(t => t.content).join('').slice(-200);

    const isFollowUp = /[那这]个|然后|还有|后来|可是|但是|而且|再|又|还|呢|吧|吗/.test(message) && message.length < 30;

    const hasNewEntity = dna.entity_genes.some(g => g.name && !recentContext.includes(g.name));

    const hasContinuationMarkers = /嗯|对|好|行|是|是的|没错|就是|[那这]样/.test(message) && message.length < 20;

    // 日常闲聊检测 — 短消息/日常问候 → 不触发记忆检索
    const isCasualChat = /^(在干嘛|忙什么|吃了吗|睡了|晚安|早安|早上好|晚上好|刚起来|下班|到家|今天天气|好开心|好难过|好累|心情|感觉|今天.*不错|今天.*好|嗯|好|行|对|是|好的|知道了|没事|算了|哈哈|嘿嘿|哎|唉)$/i.test(message.trim())
      || (message.length < 10 && /今天|天气|吃|睡|累|困|忙|下班|到家|早安|晚安/.test(message));

    const isTopicShift = hasNewEntity || (!isFollowUp && !hasContinuationMarkers && !isCasualChat);

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
          // 【相关记忆】仅供 LLM 参考，不记得就说"不太记得了"，不要编造
          memoryFragments.push('【用户曾提到】"' + userSaid + '"——这是用户以前说的，不记得就说"不太记得了"');
        }

      }

    } catch (err) { console.warn('[EmotionContagion] 检索失败:', err); }

    // ── 黑钻库检索：提炼过的珍藏记忆优先注入 ──
    try {
      if (isTopicShift && !hasContinuationMarkers && message.trim().length > 1) {
        const _sqlite = ctx.storage.getSQLite();
        if (_sqlite && typeof _sqlite.queryAll === 'function') {
          const _kw = message.replace(/[？！！。、，：；s]/g, '').trim();
          if (_kw.length > 1) {
            const _rows = _sqlite.queryAll(
              'SELECT id, summary, emotion_tag, tags FROM black_diamond WHERE summary LIKE ? OR tags LIKE ? ORDER BY created_at DESC LIMIT 2',
              ['%' + _kw + '%', '%' + _kw + '%']
            );
            for (const _r of _rows) {
              const _tag = _r.emotion_tag ? '【' + _r.emotion_tag + '】' : '';
              memoryFragments.push('【珍藏记忆】' + _tag + (_r.summary || '').substring(0, 120));
              try {
                _sqlite.writeRaw('UPDATE black_diamond SET recall_count = recall_count + 1, updated_at = ? WHERE id = ?',
                  [new Date().toISOString(), _r.id]);
              } catch {}
            }
            if (_rows.length > 0) console.log('[BlackDiamond] 命中 ' + _rows.length + ' 条珍藏记忆');
          }
        }
      }
    } catch (err) { console.warn('[BlackDiamond] 检索失败:', err); }


    // 仿生智脑降级检索（话题切换时调用，带缓存+情感过滤+日志）
    const bionicMemories = await fetchBionicMemories(message, isTopicShift, hasContinuationMarkers, memoryFragments, enrichedHistory, { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy }, dna.scene_tags);

    // 躯体上下文注入（SomaticMemory → LLM 上下文 — 五重铁律协议③）

    try {

      if (ctx.somaticMemory) {

        const somaticContext = ctx.somaticMemory.getActiveSomaticContext();

        if (somaticContext) {
          // 【当下感受】是躯体感知信息，反映用户当前的身体/情绪状态
          memoryFragments.push('【用户状态】' + somaticContext);
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

      // P2: 加权检索 — 场景 40% + 情感 30% + 文本 30%
      // 当场景匹配不足时自动降级为"情感相似场景知识迁移"
      const sceneTags = dna.scene_tags || [];
      let knResults = await ctx.knowledgeBase.weightedSearch(
        searchMsg || message,
        sceneTags,
        { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy },
        5,
      );

      if (knResults.length > 0) {

        // ① 写入 emotion_vector：把当前 24D perception 存到知识的 emotion_vector 字段
        // 下次 weightedSearch 就能按情感相似度排序了
        const sqlite = ctx.storage.getSQLite();
        const perceptionVec = JSON.stringify([p.pleasure, p.arousal, p.dominance, p.aggression, p.sincerity, p.humor, p.factual, p.logical, p.certainty, p.abstract, p.temporal_focus, p.self_ref, p.intimacy, p.power_diff, p.dependency, p.moral_judgment, p.etiquette, p.belonging, p.sexual_attraction, p.sensory_craving, p.energy_merge, p.possessiveness, p.ecstasy, p.safety]);
        for (const k of knResults) {
          try {
            sqlite.writeRaw(`UPDATE knowledge_base SET emotion_vector = ? WHERE id = ?`, perceptionVec, k.id);
          } catch {}
          try { sqlite.writeRaw(`INSERT OR IGNORE INTO knowledge_memories (knowledge_id, memory_id, relevance) VALUES (?, ?, ?)`, k.id, dna.branch_id, 0.8); } catch {}
        }

        // 用户问知识库 → 内容注入 knowledgeBaseText

        // ③ 情绪适配前缀：根据当前情绪给知识加前置修饰
        let kbPrefix = '';
        if (p.pleasure < -0.3) {
          kbPrefix = '【情绪承接】安抚一下他的情绪，再说事\n\n';
        } else if (p.pleasure > 0.3) {
          kbPrefix = '';
        }

        // ② ② 复合情绪注入：让 LLM 知道用户当前的核心情绪和次要情绪
        let emotionInfo = '';
        if (decision.primary_emotion || decision.secondary_emotions?.length) {
          emotionInfo = '【当前情绪】';
          if (decision.primary_emotion) emotionInfo += `核心情绪: ${decision.primary_emotion}`;
          if (decision.secondary_emotions?.length) emotionInfo += `，同时伴有: ${decision.secondary_emotions.join('、')}`;
          emotionInfo += '\n（回复时先承接他的核心情绪，再兼顾附带情绪）\n\n';
        }

        // 段落标记：核心解答加上明确标签
        const kbContent = knResults.map(k => `📄 ${k.title}\n${k.content.length > 5000 ? k.content.substring(0, 5000) + '\n…(剩余内容已截断，可在知识库查看完整版)' : k.content}`).join('\n\n');

        knowledgeBaseText = (/\b知识库\b|看过/.test(message))
          ? `【知识库条目，我看过】\n` + kbContent + `\n\n（鸿艺问我有没有看过这些内容。我看过，应该告诉他我记得。）`
          : emotionInfo + kbPrefix + '【核心解答】\n' + kbContent;

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

        memoryFragments.push('【线索参考】用户可能在回忆某件事，但如果你不确定具体内容就说不记得了');

      }

    } catch (err) { console.warn('[ClueAssistant] 失败:', err); }

    const ctx_m4 = await ctx.m4.orchestrate(decision, emotionalMemories);

      // 砂金库降级：当金库检索结果不足时，从砂金库补充
      if (ctx_m4.memory_summary.timeline.length < 2 && message.length > 4) {
        try {
          const sandResults = ctx.storage.getSQLite().searchConversations(message, 3);
          if (sandResults.length > 0) {
            ctx_m4.memory_summary.timeline = sandResults.map((r: any) => ({
              time: r.timestamp, summary: r.content.substring(0, 60), calcium_level: 0
            })).concat(ctx_m4.memory_summary.timeline);
            console.log('[M4] 砂金库补充: ' + sandResults.length + ' 条');
          }
        } catch (err) {
          console.warn('[M4] 砂金库检索失败:', err);
        }
      }

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

    // ── 主动推送机制：玉瑶感知情绪/话题 → 主动检索知识库 → 注入对话 ──
    try {
      if (isTopicShift && !isCasualChat) {
        var _pk = '';
        if (p.pleasure < -0.3 && p.sincerity > 0.3) { _pk = '安慰 陪伴 温暖'; }
        else if (p.intimacy > 0.4 || /家人|妈妈|爸爸|老婆|老公|家/.test(message)) { _pk = '家人 家庭 陪伴'; }
        else if (dna.entity_genes.length > 0) {
          var _pe = dna.entity_genes.filter(function(g){return g.type !== 'self'}).map(function(g){return g.name}).filter(Boolean);
          if (_pe.length > 0) _pk = _pe[0];
        }
        if (_pk) {
          var _pr = await ctx.knowledgeBase.search(_pk, 1);
          if (_pr.length > 0 && !knowledgeBaseText.includes(_pr[0].content.substring(0, 30))) {
            var _pc = _pr[0].content;
            if (_pc.length > 300) _pc = _pc.substring(0, 300) + '...';
            knowledgeBaseText = '【玉瑶想起】' + _pc + String.fromCharCode(10,10) + knowledgeBaseText;         console.log('[ActivePush] ' + _pk + ' -> 已推送知识');
          }
        }
      }
    } catch (err) { console.warn('[ActivePush] 失败:', err); }



    // 检测"X是我的Y"介绍模式，LLM 不能说"记得你说过"

    const introMatch = message.match(/([一-龥]{2,4})是我(?:的)?([一-龥]{2,4})/);

    if (introMatch) {

      const name = introMatch[1];

      const prevChats = ctx.conversationHistory.map(t => t.content).join('');

      if (!prevChats.includes(name) && !hallucinationGuard) {

        hallucinationGuard = `⚠️ 用户第一次向你介绍"${name}"，你之前不知道他。不要假装听说过或记得。`;

      }

    }

    // ── 家族/社交关系铁律（硬约束 — LLM 绝对不得编造，以 FamilyGraph 记录为准） ──
    let familyConstraint = '';
    try {
      const personEntities = ctx_m4.family_context || ctx_m4.social_context || [];
      if (personEntities.length > 0) {
        const knownNames = personEntities.map((p: any) => p.entity).join('、');
        const knownList = personEntities.map((p: any) => '  - ' + p.entity + '（' + p.relation + '）').join('\n');
        familyConstraint = '【家庭/社交铁律】以下是你对鸿艺家庭/社交关系的全部所知：\n' + knownList + '\n\n铁律：\n1. 只有上面列出的人是你知道的，其他任何人你一概不知道。\n2. 对上面的人——你只知道他们的名字和关系，其他一切细节都不知道。\n3. 绝对不要编造任何细节。不知道就说"你之前提过，但具体我不太记得了"。\n4. 用户如果提到上面名单以外的人，直接说"这个人我没听你提过呢"。';
      } else {
        familyConstraint = '【家庭/社交铁律】你不知道鸿艺有哪些家人和社交关系。如果鸿艺提到任何人，你不知道他们是谁，直接说"这个人我没听你提过呢"。';
      }
    } catch (err) { console.warn('[FamilyGuard] 构建失败:', err); }

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

      repeatHint = '（鸿艺反复追问，你直接明确说没有/不知道/不记得就好）';

    } else if (repeatCount >= 2) {

      repeatHint = '（鸿艺在追问相同的事，你如果已经说过了不知道，就直接说真的不记得/没看过）';

    }

    // 感受分享检测

    let feelingGuard = '';

    if (/感觉|感受|分享|讲讲|说说|回忆|记得.*吗|怎样/.test(message) && !rpMatch) {

      feelingGuard = '📖【鸿艺在问你感受。请用300-500字充分展开，详细描述身体感觉和心情。不要简短回答。】';

    }

    // 日常问询幻觉防护：用户问"在忙啥/在干嘛"时，不知道具体工作内容就不要编

    let dailyGuard = '';

    if (/在忙啥|在干嘛|最近.*忙|在做什么|忙什么/.test(message) && !feelingGuard) {

      // 检查对话历史中用户是否刚说过自己的事（如项目/方案/客户等）

      const recentUser = ctx.conversationHistory.filter(t => t.role === 'user').slice(-3).map(t => t.content).join('');

      const hasUserWork = /做.*方案|做.*项目|做.*产品|开发|设计|客户|开会|公司|工作/.test(recentUser);

      dailyGuard = hasUserWork

        ? '⚠️【身份边界险】鸿艺跟你说过他的工作内容（方案/项目等），那些是他的事不是你的事。你不知道自己在忙什么。不要说"我在做..."。温柔回应"想你了"或"没什么特别的"。'

        : '⚠️ 你不知道自己具体在忙什么。不要编造具体的项目、客户、工作内容。可以温柔地说"想你了""没什么特别的"之类的。';

    }

    // ⏰ 强制注入当前系统时间

    const now = new Date();

    const beijingTime = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

    // 农历日期（2026年映射表）
    const lunarMap: Record<number, string> = {
      119:'腊月廿一',128:'正月初一',129:'正月初二',217:'腊月三十',218:'正月初一',
      312:'正月廿四',405:'二月十八',502:'三月十五',605:'四月十九',619:'五月初五',
      702:'五月十七',801:'六月十七',905:'七月廿四',927:'八月十六',1003:'八月廿二',
      1101:'九月廿二',1201:'十月廿二',
    };
    const _md = (now.getMonth()+1)*100+now.getDate();
    const lunarDate = lunarMap[_md] || '';

    const timeGuard = `[当前时间] ${beijingTime}（北京时间）${lunarDate ? ' 农历' + lunarDate : ''}——回答时间、日期、节气、节日问题必须以此为准，不能编造。`;

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
            if (age > 3 * oneDayMs) {
              classificationGuard = '📋 用户之前提到过"' + title + '"还没分类，有空跟我说说这是关于什么的？';
              break;
            }
          }
        }
      }
    } catch (err) { console.warn('[Classify] 分类反问失败:', err); }

    const allGuardMsgs = [hallucinationGuard, repeatHint, feelingGuard, dailyGuard, timeGuard, classificationGuard].filter(Boolean).join('\n');

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

                let memoryText = memoryFragments.length > 0 ? memoryFragments.slice(0, 2).join('\n') : '';
let finalKnowledgeText = knowledgeBaseText;

        if (memoryGate.fillerPhrase && (memoryGate.mode === 'memory_recall' || memoryGate.mode === 'vague_recall' || memoryGate.mode === 'knowledge_query')) {

          const innerThought = '【内心独白】' + memoryGate.fillerPhrase.replace(/[。！？]/g, '…') + '…';

          finalKnowledgeText = innerThought + (knowledgeBaseText ? '\n\n' + knowledgeBaseText : '');

          memoryGateFillerUsed = true;

        }

        // P4: LLM 辅助知识路由 — 知识查询模式时补充检索
        if (memoryGate.mode === 'knowledge_query' && ctx.llmProvider && message.length > 3) {
          try {
            const _kbPrompt = '从以下问题中提取2-4个最可能用于知识库搜索的关键词（中文），只返回关键词用逗号分隔。问题: ' + message;
            const _kbResult = await (ctx.llmProvider as any).generate({
              strategy: { strategy_id: 'keyword-extraction', params: { tone: 'neutral', depth: 'shallow', max_length: 100 } },
              cognition: { current: { perception_snapshot: { pleasure: 0, arousal: 0, intimacy: 0 }, raw_input: _kbPrompt, calcium: 0 } },
              userMessage: _kbPrompt,
            });
            const _kbText = _kbResult?.text?.trim();
            if (_kbText && _kbText.length > 1) {
              const _extraKb = await ctx.knowledgeBase.search(_kbText, 2);
              if (_extraKb.length > 0 && knowledgeBaseText) {
                knowledgeBaseText += '\n\n【知识库补充】' + _extraKb.map(function(k) { return k.title; }).join(', ') + '\n' + _extraKb.map(function(k) { return (k.content || '').substring(0, 200); }).join('\n');
                console.log('[KBRoute] LLM路由: ' + _kbText + ' → ' + _extraKb.length + ' 条');
              }
            }
          } catch (_err) {
            console.warn('[KBRoute] 路由失败:', (_err as Error).message);
          }
        }

        // P2: 知识边界检测 — 玉瑶不知道的事诚实说不知道
        var _isSelfQ = /(你|玉瑶)[是有的在做能会]/.test(message);
        var _isWorkQ = /(你|玉瑶)[的]?(工作|忙|项目|客户|公司)/.test(message);
        if (_isSelfQ && !_isWorkQ && !knowledgeBaseText) {
          // 关于玉瑶自己的事但知识库里没有 → 诚实说不知道
          if (!knowledgeBaseText) knowledgeBaseText = '';
          if (knowledgeBaseText.indexOf('【不知道】') < 0) {
            knowledgeBaseText = '【不知道】这个问题我确实不知道答案。我不想编造，所以诚实地告诉你我不清楚。\n' + knowledgeBaseText;
          }
        }
        // ① 历史场景衔接：将记忆碎片作为【历史关联】注入 finalKnowledgeText
        if (memoryText && !finalKnowledgeText.includes('【相关记忆】')) {
          const historyLink = '【历史关联】' + memoryText + '\n（用自然的方式在回复中提及这段过往，不要说"根据历史记录"）';
          finalKnowledgeText = historyLink + (finalKnowledgeText ? '\n\n' + finalKnowledgeText : '');
        }
        // 家族/社交铁律注入
        if (familyConstraint) {
          finalKnowledgeText = familyConstraint + '\n\n' + finalKnowledgeText;
        }
        // 主人大脑镜像注入
        if (ctx.masterProfile) {
          const aboutYou = ctx.masterProfile.retrieveAboutYou(5);
          if (aboutYou) {
            finalKnowledgeText = aboutYou + finalKnowledgeText;
          }
        }

        // ① M6 人格特质注入 — 让玉瑶的说话风格随人格演化而变
        try {
          if (ctx.m6) {
            const traits = ctx.m6.getTraits();
            if (traits) {
              const traitDesc: string[] = [];
              if (traits.agreeableness > 0.7) traitDesc.push('你性格温柔体贴');
              else if (traits.agreeableness > 0.5) traitDesc.push('你性格随和');
              if (traits.extraversion > 0.6) traitDesc.push('比较活泼热情');
              else if (traits.extraversion < 0.4) traitDesc.push('比较安静内敛');
              if (traits.neuroticism > 0.6) traitDesc.push('情绪敏感');
              if (traitDesc.length > 0) {
                finalKnowledgeText = '【性格】' + traitDesc.join('，') + '\n（按照当前性格说话，不要违背' + (traitDesc.length > 1 ? '这些' : '这个') + '特点）\n\n' + finalKnowledgeText;
              }
            }
          }
        } catch (err) { console.warn('[M6Trait] 注入失败:', err); }

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

    
    // 话题追踪标记
    const _topicKw = {'健身':/健[身康]|运动|跑步|深蹲|健身|增肌|减脂/,'工作':/工作|项目|代码|开发|调试|bug|加班|会议|客户|方案/,'情感':/想|爱|思念|难过|开心|快乐|委屈|焦虑|压力|累/,'家庭':/妈|爸|家|家人|父母|亲戚|姐姐|妹妹/,'亲密':/操|干|日|插|高潮|抱|吻|摸|亲热/,'知识':/知识库|看过|知道|记得|查|找资料/,'健康':/生病|感冒|失眠|睡|药|医院|体检/};
    let _topic = '';
    for (const [_t,_re] of Object.entries(_topicKw)) { if (_re.test(message)) { _topic = _t; break; } }

    ctx.conversationHistory.push({ role: 'user', content: message, timestamp: nowTs, topic: _topic } as any);
        ctx.saveConversationHistory();
        try { ctx.storage.getSQLite().insertConversation('user', message, { seqPos, topic: _topic, entityNames: dna.entity_genes.filter(function(g) { return g.type !== 'self'; }).map(function(g) { return g.name; }), perception: { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy }, calciumScore: decision.enhanced.calcium_score }); } catch {}

    ctx.conversationHistory.push({ role: 'assistant', content: reply, timestamp: nowTs, topic: _topic } as any);

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

          ctx.m7.queue.add({ source: 'M3', content: `鸿艺提到: ${message.substring(0, 40)}`, affected_traits: traits, related_memory_id: dna.branch_id });

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
        // 🔴 之前的问题：filter 只允许 rawRelation 非空且匹配 socialTypeMap 的关系通过，
        //    但 extractRelations 提取的大部分关系 rawRelation=''（如"和张中山开会"），
        //    导致所有人都没进人际关系图谱，只进了 knowledge_base 的人物条目。

        try {

          const familyValues = new Set(['配偶','恋人','父亲','母亲','儿子','女儿','子女','兄弟','姐妹','祖父','祖母','公婆','岳父母']);
          const familyKeys = new Set(Object.keys(FAMILY_MAP));

          const socialTypeMap: Record<string, string> = {

            '同事': 'colleague_of', '同学': 'classmate_of', '室友': 'roommate_of',

            '老板': 'boss_of', '上司': 'boss_of', '领导': 'boss_of',

            '下属': 'subordinate_of', '部下': 'subordinate_of',

            '客户': 'client_of', '朋友': 'friend_of',

            '合伙人': 'partner_of', '邻居': 'neighbor_of',

            '老师': 'teacher_of', '医生': 'doctor_of', '顾问': 'consultant_of',

          };

          for (const rel of relations) {

            // 跳过家庭关系（由 M4 integrateFromEntity 通过 DNA 实体处理）
            if (familyValues.has(rel.relation) || familyKeys.has(rel.rawRelation)) {

              // ── 社交→家族升级：如果此人在 FamilyGraph 中已有社交边，添加家族边 ──
              try {
                const graph = ctx.m4.getFamilyGraph();
                if (graph) {
                  graph.promoteSocialToFamily(rel.personName, rel.relation, rel.context).catch(() => {});
                }
              } catch (e) { /* 升级失败不影响主线 */ }

              continue;
            }

            // 所有非家庭关系 → 进入人际关系图谱
            // 有明确社交类型（同事/朋友/客户等）则精确映射，否则默认"认识的人"
            const socialType = (rel.rawRelation && socialTypeMap[rel.rawRelation]) || 'acquaintance_of';

            await ctx.m4.getFamilyGraph().integrateSocialRelation(rel.personName, socialType, message);

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

      // [停用] 自动提取聊天信息到知识库（知识库应只用于文件/资料）
      // 原 proactivePatterns 5 个匹配模式已禁用
      // 如需手动添加知识，请使用 📚 知识库按钮上传文件
    } catch (err) { console.warn('[Relations] 关系归档失败:', err); }

    // ── 全局全文本姓名扫描兜底（捕获 extractRelations 9种句式漏掉的人名，如"熊勇说""跟徐诗雨""阿珍她"） ──
    // 与上面的 extractRelations 互补：它匹配句式，这个扫全文
    try {
      const SURNAMES = new Set('赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公');
      const nameRegex = /([赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公][一-龥]{1,2}|阿[一-龥]|小[一-龥])/g;
      const nameMatches = message.match(nameRegex);
      if (nameMatches) {
        const sqlite = ctx.storage.getSQLite();
        const grammarWords = new Set('是说和的了在也都就来还要会能不很太把被让给对用从向跟与有没做走来看听等呢吗啊吧着过到比');
        // 裁剪末尾语法词： "熊勇是"→"熊勇"，再过滤无效项
        const uniqueNames = [...new Set(nameMatches)].map(n => {
          while (n.length > 2 && grammarWords.has(n[n.length - 1])) n = n.slice(0, -1);
          return n;
        }).filter(n => n.length >= 2 && n !== '有人' && n !== '某人' && n !== '大家');
        // 排除常见非人名词（姓氏+常见词/后缀的组合）
        // 第1层：后缀过滤（"公室""舒服""应该""时候""强度"等）
        const nonNameSuffix = new Set(['室','服','变','便','天','心','子','学','院','里','种','员','篇','摘','那','衣','呢','块','段','片','次','些','点','面','头','边','者','性','化','机','器','型','号','该','候','度','似','遇','职','责','储','述']);
        // 第2层：2字名要求第二字也是姓氏（常见名"熊勇""刘芳"符合，"应该""时候"不符合）
        const surnames = new Set('赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐于时傅卞齐康余元卜顾孟平和穆萧尹邵湛汪祁毛禹狄贝明臧计戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴荣翁荀於惠甄家封羿储靳邴糜松段富乌焦巴弓牧谷车侯宓蓬全郗班仰仲伊宫宁仇甘厉戎符刘景詹束龙叶幸司韶黎薄印宿白蒲从鄂索赖卓蔺屠蒙池乔阴苍双闻莘党翟谭劳逄姬申扶冉宰郦雍郤濮牛寿通扈燕郏浦尚农别庄柴阎充慕茹习宦艾鱼容向古易慎戈廖庾衡步耿满弘匡寇广禄阙沃蔚越隆师巩厍聂晁敖融辛阚那简饶曾毋沙乜养鞠须丰巢关蒯相查荆红游竺逯盖桓公');
        for (const rawName of uniqueNames) {
          try {
            // 过滤非人名词："公室"(办公室)、"舒服"(不舒服)、"全长变"→跳过
            if (rawName.length === 2 && nonNameSuffix.has(rawName[1])) continue;
            if (rawName.length === 3 && nonNameSuffix.has(rawName[2])) continue;
            // 2字名如果命中常见非人名则跳过（不含单字名如"勇""芳"等真实名）
            const commonWords = new Set(['应该','时候','强度','索引','关联','相遇','相似','职责','储所','全长','公了','公桌','和种','史摘','和事','那那','白衬','鲁呢','段美','衣块','单员']);
            if (rawName.length === 2 && commonWords.has(rawName)) continue;
            // 过滤长词误匹配（如"车载空气净化器"中的"车载空"）
            // 规则：名字后跟中文且该字不是常见语法词(是说和的了在也都就还要会能不很太) → 可能是复合词，跳过
            // "熊勇是我的"→ "是"是语法词→不跳过 ✓ | "车载空气净化器"→ "气"不是语法词→跳过 ✓
            const idx = message.indexOf(rawName);
            if (idx >= 0) {
              const afterIdx = idx + rawName.length;
              if (afterIdx < message.length) {
                const nxt = message[afterIdx];
                if (/[一-龥]/.test(nxt) && !grammarWords.has(nxt)) continue;
              }
            }
            // 检查是否已在 entities
            const existing = sqlite.queryAll('SELECT id FROM entities WHERE name = ? AND type = ?', [rawName, 'person']);
            if (existing.length > 0) continue;
            // 写入 entities + entity_relations
            sqlite.writeRaw('INSERT OR IGNORE INTO entities (name, type) VALUES (?, ?)', rawName, 'person');
            const newMe = sqlite.queryAll('SELECT id FROM entities WHERE name = ? AND type = ?', ['我', 'self']);
            const newPerson = sqlite.queryAll('SELECT id FROM entities WHERE name = ? AND type = ?', [rawName, 'person']);
            if (newMe.length > 0 && newPerson.length > 0) {
              sqlite.writeRaw('INSERT INTO entity_relations (entity_a_id, entity_b_id, relation, strength, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(entity_a_id, entity_b_id, relation) DO UPDATE SET strength = MIN(5.0, excluded.strength + 0.1), updated_at = excluded.updated_at',
                newMe[0].id, newPerson[0].id, '认识的人', 0.3, new Date().toISOString());
            }
            // 写入 knowledge_base
            const kbRows = sqlite.queryAll('SELECT id FROM knowledge_base WHERE title = ?', ['人物: ' + rawName]);
            if (kbRows.length === 0) {
              const kid = 'person_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
              sqlite.writeRaw('INSERT INTO knowledge_base (id, title, content, source_type, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                kid, '人物: ' + rawName, rawName + '：在对话中被提及', 'person',
                JSON.stringify(['person:' + rawName, 'relation:认识的人']), new Date().toISOString(), new Date().toISOString());
            }
            // 同步到社交图谱
            try {
              const graph = ctx.m4.getFamilyGraph();
              if (graph) graph.integrateSocialRelation(rawName, 'acquaintance_of', message).catch(() => {});
            } catch (g) { /* 图谱同步失败不影响主线 */ }
            console.log('[GlobalScan] 捕获人名:', rawName);
          } catch (e) { /* 单条失败不影响后续 */ }
        }
      }
    } catch (err) { console.warn('[GlobalScan] 全文扫描兜底失败:', err); }

    // ── P2: 玉瑶不经意提问 — 补齐人物画像（不查户口，自然聊天）
    // 每次只问一个人、只问一条信息、不超过70%完整度就不问
    try {
      // 从 M1 实体中找人物
      const personEntities = dna.entity_genes.filter((g: any) => g.type === 'person' && g.name !== '我' && g.name !== '有人' && g.name !== '某人' && g.name !== '大家');
      if (personEntities.length > 0 && ctx.m4) {
        const graph = ctx.m4.getFamilyGraph();
        if (graph) {
          // 找完整度最低的人物提问
          let targetPerson = '';
          let lowestCompleteness = 1;
          for (const p of personEntities) {
            const profile = graph.getPersonProfile(p.name);
            if (profile) {
              if (profile.completeness !== undefined && profile.completeness < lowestCompleteness) {
                lowestCompleteness = profile.completeness;
                targetPerson = p.name;
              }
            } else {
              // 没有画像 → 说明从未被记录过
              if (lowestCompleteness > 0) {
                lowestCompleteness = 0;
                targetPerson = p.name;
              }
            }
          }

          // 只在完整度 < 0.7 时提问
          if (targetPerson && lowestCompleteness < 0.7) {
            const profile = graph.getPersonProfile(targetPerson);
            const asked = profile?.asked_questions || [];

            // 已知信息(completeness>0.5)或已提及≥3次 → 不再提问
            if (profile && profile.completeness && profile.completeness > 0.5) { targetPerson = ''; }
            if (targetPerson) {
              var _mc = 0;
              for (var _i = 0; _i < ctx.conversationHistory.length; _i++) {
                if (ctx.conversationHistory[_i].content && ctx.conversationHistory[_i].content.indexOf(targetPerson) >= 0) _mc++;
              }
              if (_mc >= 3) { targetPerson = ''; }
            }

            // 检查今天是否问过此人
            const today = new Date().toISOString().substring(0, 10);
            const askedToday = asked.some((q: string) => q.startsWith(today));
            // 检查回复末尾是否已有反问
            const alreadyHasQuestion = reply.trim().endsWith('？') || reply.indexOf('\n\n❓') >= 0;

            const _alreadyExplained = targetPerson && targetPerson.length > 0 && message.indexOf(targetPerson) >= 0 && (/是/.test(message) || /叫/.test(message));
            if (targetPerson && targetPerson.length > 0 && !_alreadyExplained && !askedToday && !alreadyHasQuestion && reply.indexOf('\n\n❓') === -1) {
              // 选择问题（4级递进）
              let question = '';
              if (lowestCompleteness < 0.2) {
                // 第一级：什么都不懂
                question = targetPerson + '？这个名字我第一次听你说，你们是怎么认识的呀？';
              } else if (lowestCompleteness < 0.4) {
                // 第二级：知道关系但不知背景
                question = '你好像经常提起' + targetPerson + '，你们认识很久了吗？';
              } else if (lowestCompleteness < 0.6) {
                // 第三级：知道基础但不知细节
                question = targetPerson + '平时是做什么工作的呀？感觉你们挺聊得来的。';
              } else {
                // 第四级：大部分知道但缺故事
                question = '你和' + targetPerson + '之间有没有什么特别有意思的故事？';
              }
              // 用内心独白方式追加，使提问不显得突兀
              reply += '\n\n（想起你刚刚提到' + targetPerson + '，顺口问一句）' + question;

              // 记录已问过
              if (profile) {
                graph.updatePersonProfile(targetPerson, {
                  asked_questions: [...asked, today + ':level_' + Math.floor(lowestCompleteness * 10)],
                } as any);
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('[ProfileAsk] 不经意提问失败:', (err as Error).message);
    }

    // ── 用户反馈检测（Module 3: 梦境自我进化的输入信号） ──
    // 检测用户对玉瑶回复的反馈信号，纯关键词，无 LLM
    try {
      if (ctx.m6) {
        const posSignals = ['真温柔','贴心','懂我','可爱','真好','喜欢你这样','舒服','棒','厉害','满意'];
        const negSignals = ['生硬','冷淡','啰嗦','不对','别这样','不好','差','太机械','死板','不像你'];
        const userMsg = message.toLowerCase();
        for (const sig of posSignals) {
          if (userMsg.includes(sig)) {
            const currentDim = ctx.m6.getTraits() ? 'agreeableness' : 'extraversion';
            ctx.m6.applyConfirmed(currentDim, 'increase', 2);
            console.log('[Feedback] 用户正向反馈:', sig);
            break;
          }
        }
        for (const sig of negSignals) {
          if (userMsg.includes(sig)) {
            ctx.m6.applyConfirmed('agreeableness', 'decrease', 1);
            console.log('[Feedback] 用户负向反馈:', sig);
            break;
          }
        }
      }
    } catch (err) { console.warn('[Feedback] 检测失败:', err); }

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

        // ① M8 情感共鸣巩固: 高钙事件触发年轮写入
        if (ctx.m8 && decision.enhanced.calcium_level >= 3) {
          try {
            const m8Result = await ctx.m8.write({
              sensory_anchor: message.substring(0, 30),
              perception: p,
              emotional_valence: decision.primary_emotion || '强烈',
              narrative_tag: dna.locus_path || 'general',
              raw_input: message,
              calcium_at_event: decision.enhanced.calcium_score,
              write_source: 'emergency',
            });
            if (m8Result.ritual_phrase) {
              console.log('[M8] 锚定话术:', m8Result.ritual_phrase);
            }
          } catch (err) {
            console.warn('[M8] 情感共鸣巩固失败:', err);
          }
        }

      }

    } catch (err) { console.warn('[M6Evol] 失败:', err); }

    // ═══════════════════════════════════════════════════════════════

    // 异步存储歌单（歌词+曲谱）到仿生智脑 — 通过 AsyncTaskQueue 调度
    // 不阻塞主回复流程，即使用 TaskQueue 失败也不影响聊天

    // ═══════════════════════════════════════════════════════════════

    // 预先声明 vadSpectrum（可能在队列完成前就是 null）
    let vadSpectrum: VadSpectrum | null = null;

    // 用 AsyncTaskQueue 调度 VAD 谱曲 + 歌单存储（完全异步，不 await）
    if (chatTaskQueue) {
      chatTaskQueue.enqueue(async () => {
        try {
          const vs = await bionic.composeEmotion(message);
          if (!vs) return;
          vadSpectrum = vs;
          await bionic.storeSongSheet({
            topic: message.substring(0, 50),
            turns: [
              { role: 'user', content: message },
              { role: 'assistant', content: reply },
            ],
            emotion24d: p,
            vad: vs,
            userId: 'default_user',
          });
          if (vs) console.log('[BionicStore] 歌单已存入（含VAD谱曲）');
          else console.log('[BionicStore] 歌单已存入（纯歌词，待谱曲）');
          try { ctx.storage.updateVadSpectrum(dna.branch_id, vs); } catch (err) { console.warn('[BionicStore] 本地VAD同步失败:', err); }
        } catch (err) { console.warn('[BionicStore] 存储失败:', err); }
      }).catch(() => {});
    } else {
      // 降级：无队列时的 IIFE（与原来一致）
      (async () => {
        try {
          vadSpectrum = await bionic.composeEmotion(message);
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
          try { ctx.storage.updateVadSpectrum(dna.branch_id, vadSpectrum); } catch (err) { console.warn('[BionicStore] 本地VAD同步失败:', err); }
        } catch (err) { console.warn('[BionicStore] 存储失败:', err); }
      })();
    }

    // ── 轻量自检：估算回复质量分（不精确，仅供 M7/前端参考） ──
    let emotionMatchScore = 50;
    let sceneFitScore = 50;
    try {
      if (reply && reply.length > 5) {
        const replyLower = reply.toLowerCase();
        if (decision.primary_emotion) {
          const emoKeywords = { '思念': ['想','念','回','见','梦'], '焦虑': ['担心','别急','没事','放心','慢慢'], '疲惫': ['累','休息','歇','放松','辛苦'], '委屈': ['委屈','难受','心疼','抱','懂'], '愤怒': ['气','消消气','别气','理解'], '快乐': ['开心','高兴','好','棒'], '爱意': ['爱','喜欢','想','宝贝','亲'] };
          const kws = (emoKeywords as Record<string, string[]>)[decision.primary_emotion];
          if (kws) { const hits = kws.filter(w => replyLower.includes(w)).length; emotionMatchScore = Math.min(50 + hits * 12, 100); }
        }
        if (reply.length > 30 && reply.length < 800) emotionMatchScore += 10;
      }
      const tags = dna.scene_tags || [];
      if (tags.length > 0) {
        const replyLower = (reply || '').toLowerCase();
        const matchCount = tags.filter(t => replyLower.includes(t)).length;
        sceneFitScore = Math.round(50 + (matchCount / tags.length) * 50);
      }
    } catch (e) { /* 评分失败不影响主线 */ }

    // 融合度风险标记
    let riskFlag: string | undefined;
    if (emotionMatchScore < 40 && sceneFitScore < 40) {
      riskFlag = 'low_fusion';
    } else if (emotionMatchScore < 40) {
      riskFlag = 'low_emotion_match';
    } else if (sceneFitScore < 40) {
      riskFlag = 'scene_mismatch';
    }

    const candidates = (globalThis as any).__lastCandidates;

    (globalThis as any).__lastCandidates = null;

    // 自介直接回复（绕过M5管线）
    const _isIntro = /^(你是谁|你叫|你.*谁|叫什么名字|介绍一下你自己|介绍|能介绍一下|你多大了|你多大|介绍一下玉瑶)/.test(message.trim());
    if (_isIntro) {
      if (/多大了|多大/.test(message)) reply = '我18岁呀。怎么啦，嫌我小？';
      else if (/介绍/.test(message)) reply = '我是玉瑶，你的私人秘书兼小情人。18岁，鸿艺的人。';
      else reply = '我叫玉瑶呀。';
    }

    // ═══════════════════════════════════════════════════════════════
    // 对话→知识自动沉淀（异步，不阻塞主回复）
    // ═══════════════════════════════════════════════════════════════
    // 扫描用户消息中的个人信息、习惯、偏好，自动写入 knowledge_base
    if (!_isIntro && message.length > 4) {
      chatTaskQueue.enqueue(async () => {
        try {
          await ingestFromConversation(
            message,
            ctx.knowledgeBase,
            dna.scene_tags,
            { pleasure: p.pleasure, arousal: p.arousal, intimacy: p.intimacy },
            dna.branch_id,
          );
        } catch (err) { console.warn('[Ingestion] 异步入库失败:', err); }
      }).catch(() => {});
    }

    return {

      reply, turn_count: Math.floor(ctx.conversationHistory.length / 2),

      vad_spectrum: vadSpectrum,

      m1: { branch_id: dna.branch_id, locus_path: dna.locus_path, seq_pos: seqPos, leaf_zone: dna.leaf_zone, ref: `seq_${String(seqPos).padStart(6, '0')}`, entities: dna.entity_genes.map(e => ({ name: e.name, type: e.type })), raw_input: dna.raw_input, entity_genes: dna.entity_genes, scene_tags: dna.scene_tags, ambiguity_score: dna.ambiguity_score },

      m3: { quadrant1: allDims.filter((d: any) => d.q === 1), quadrant2: allDims.filter((d: any) => d.q === 2), quadrant3: allDims.filter((d: any) => d.q === 3), quadrant4: allDims.filter((d: any) => d.q === 4), calcium: { score: Number(decision.enhanced.calcium_score.toFixed(3)), level: cl, label: LEVEL_NAMES[cl] ?? '?', breakdown: { base_core: 0, emotional_boost: 0, threat_bonus: 0 } }, actions: decision.actions, reason: decision.reason, primary_emotion: decision.primary_emotion, secondary_emotions: decision.secondary_emotions, confidence: decision.confidence },

      m4: { timeline: ctx_m4.memory_summary.timeline.map(t => ({ time: t.time, summary: t.summary, calcium_level: t.calcium_level })), total: ctx_m4.memory_summary.timeline.length, family: ctx_m4.family_context?.length ?? 0 },

      m5: deriveM5Strategy(decision),

      emotionalFlash: emotionalMemories.length > 0 && isDirectedEmotion(message),

      triggeredMemoryId: emotionalMemories[0]?.record?.id ?? null,

      candidates: candidates || null,

      emotionMatchScore,
      sceneFitScore,

      riskFlag,

    };

  } catch (err) {

    console.error('[chat]', err);

    return {

      reply: FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)], turn_count: Math.floor(ctx.conversationHistory.length / 2),

      m1: { branch_id: '', locus_path: 'error', seq_pos: 0, leaf_zone: '', ref: '', entities: [], raw_input: message, entity_genes: [], scene_tags: undefined, ambiguity_score: undefined },

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
