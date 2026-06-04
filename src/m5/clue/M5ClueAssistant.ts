// M5ClueAssistant — 线索协助式回忆助理
// Ref: docs/M8-design-v1.md §4, docs/M7-design-v1.md §5
//
// 这是她的"嘴"——在线实时，≤200ms，不阻塞对话。
//
// 职责:
// 1. 检测用户是否在模糊回忆（"那个咖啡厅""上次的事"）
// 2. 生成特征选项式反问（"是有猫的那家还是靠海的那家？"）
// 3. 将用户提供的线索拼接为重写后的 Query
// 4. 调用 M8.matchByClue 并将结果传递给 M5 表达层
//
// 铁律:
// - 反问 ≤15字，带语气词，禁止书面语
// - composite_score < 0.3 时禁止输出检索结果
// - 用户补充线索后必须在 ≤200ms 内完成重写

import type { M8Engine } from '../../m8/M8Engine.js';
import type { ClueSearchResult } from '../../m8/types/index.js';
import { derivePhysiologicalSnapshot } from '../../m8/PhysiologicalDeriver.js';
import type { Perception24D } from '../../m3/types/perception.js';
import type { ClueTracker } from '../../m7/ClueTracker.js';
import type { InteractionLog } from '../../m7/types/index.js';

// ─── 特征选项池（按话题类型分类） ───
const FEATURE_OPTIONS: Record<string, string[]> = {
  scene: ['是不是有猫的那家？', '还是靠海的那家？', '是不是有落地窗的那个？'],
  person: ['是不是高高瘦瘦的那个？', '是戴眼镜的那个吗？', '是说话很快的那个？'],
  time: ['是不是下雨那天？', '还是大晴天那次？', '是不是晚上的？'],
  object: ['是不是有那只橘猫的？', '还是有一架钢琴的？', '是不是摆了很多书的？'],
};

/**
 * 线索询问配置
 */
export interface ClueQuestionConfig {
  /** 用户原始 Query */
  originalQuery: string;
  /** 可选的当前 M3 感知维度 */
  perception?: Perception24D;
  /** M8 引擎实例 */
  m8Engine: M8Engine;
}

/**
 * 线索反问结果
 */
export interface ClueQuestionResult {
  /** 是否需要反问（true = 模糊，需要继续问） */
  needsQuestion: boolean;
  /** 反问话术（给 M5 表达层使用的文本，≤15字） */
  questionText?: string;
  /** 检索结果（如已有足够置信度） */
  searchResult?: ClueSearchResult;
  /** 是否高置信度可输出 */
  isReady: boolean;
}

/**
 * 判断用户输入是否为模糊查询
 */
function isVagueQuery(text: string): boolean {
  return /那个|上次|那家|那次|那晚|某家|某次|之前|以前|有个/.test(text);
}

/**
 * 提取可能的线索类型
 */
function detectClueType(text: string): string[] {
  const types: string[] = [];
  if (/猫|狗|橘猫|钢琴|书|咖啡|窗/.test(text)) types.push('object');
  if (/男|女|戴眼镜|高|瘦|说话/.test(text)) types.push('person');
  if (/下雨|晴天|晚上|白天|那时/.test(text)) types.push('time');
  if (/店|厅|吧|馆|公园|海|山/.test(text)) types.push('scene');
  return types;
}

/**
 * M5 线索协助式回忆助理
 */
export class M5ClueAssistant {
  private m8Engine: M8Engine;
  private clueTracker: ClueTracker | null;
  private conversationBuffer: Array<{ role: 'user' | 'ai'; text: string; timestamp?: number }> = [];
  private readonly STALE_MS = 5 * 60 * 1000; // 5分钟超时

  constructor(m8Engine: M8Engine, clueTracker?: ClueTracker) {
    this.m8Engine = m8Engine;
    this.clueTracker = clueTracker ?? null;
  }

  /** 清除过期上下文 */
  private cleanStale(): void {
    if (this.conversationBuffer.length === 0) return;
    const now = Date.now();
    const last = this.conversationBuffer[this.conversationBuffer.length - 1];
    if (last.timestamp && (now - last.timestamp) > this.STALE_MS) {
      this.conversationBuffer = [];
    }
  }

  /**
   * 处理用户输入，判断是否需要线索协助
   *
   * 流程:
   * 1. 检测是否为模糊查询
   * 2. 如有缓存线索 → 直接检索 M8
   * 3. 如无缓存线索 → 生成特征反问
   * 4. 返回结果给 M5 表达层
   */
  async processUserInput(config: ClueQuestionConfig): Promise<ClueQuestionResult> {
    this.cleanStale();
    const { originalQuery, perception } = config;
    const now = Date.now();
    const prevAiMessage = this.conversationBuffer
      .filter((m) => m.role === 'ai')
      .pop()?.text ?? '';

    // 检测上一轮是否为反问
    const lastWasQuestion = /是不是|还是说|是有/.test(prevAiMessage);
    const lastWasLowConfidence = prevAiMessage.includes('低置信度');

    // 如果上一轮是反问，用户本轮提供的可能是线索词
    if (lastWasQuestion || lastWasLowConfidence) {
      // 用用户本轮输入作为 clue 进行检索
      const searchResult = await this.searchWithClue({
        originalQuery: this.extractOriginalQuery(),
        userClue: originalQuery,
        perception,
      });

      if (searchResult.entries.length > 0 && searchResult.entries[0].composite_score >= 0.3) {
        this.conversationBuffer.push({ role: 'user', text: originalQuery, timestamp: now });
        return {
          needsQuestion: false,
          searchResult,
          isReady: true,
        };
      }

      // 置信度不够，再问一轮
      const followUp = this.generateFollowUp(originalQuery);
      this.conversationBuffer.push({ role: 'user', text: originalQuery, timestamp: now });
      this.conversationBuffer.push({ role: 'ai', text: followUp, timestamp: now });
      return {
        needsQuestion: true,
        questionText: followUp,
        isReady: false,
      };
    }

    // 初次检测是否为模糊查询
    if (isVagueQuery(originalQuery)) {
      const question = this.generateQuestion(originalQuery);
      this.conversationBuffer.push({ role: 'user', text: originalQuery, timestamp: now });
      this.conversationBuffer.push({ role: 'ai', text: question, timestamp: now });
      return {
        needsQuestion: true,
        questionText: question,
        isReady: false,
      };
    }

    // 非模糊查询，不需要线索协助
    return { needsQuestion: false, isReady: true };
  }

  /**
   * 用线索检索 M8
   */
  private async searchWithClue(params: {
    originalQuery: string;
    userClue: string;
    perception?: Perception24D;
  }): Promise<ClueSearchResult> {
    const physiologicalState = params.perception
      ? derivePhysiologicalSnapshot({
          pleasure: params.perception.pleasure,
          arousal: params.perception.arousal,
          intimacy: params.perception.intimacy,
          sexual_attraction: params.perception.sexual_attraction,
          sensory_craving: params.perception.sensory_craving,
          energy_merge: params.perception.energy_merge,
          ecstasy: params.perception.ecstasy,
          safety: params.perception.safety || 0.5,
        })
      : undefined;

    const result = await this.m8Engine.matchByClue({
      original_query: params.originalQuery,
      user_clue: params.userClue,
      current_physiological_state: physiologicalState,
      limit: 5,
    });

    // 记录线索检索到 ClueTracker（无论是否命中，用于统计）
    if (this.clueTracker) {
      const types = detectClueType(params.userClue);
      const clueType = types[0] ?? 'general';
      if (result.entries.length > 0) {
        for (const entry of result.entries) {
          const log: InteractionLog = {
            user_clue: params.userClue,
            original_query: params.originalQuery,
            rewritten_query: '',
            clue_type: clueType,
            composite_score: entry.composite_score,
            success: entry.composite_score >= 0.3,
            timestamp: new Date().toISOString(),
          };
          this.clueTracker.record(log);
        }
      } else {
        // 无结果也记录（用于统计用户有多少次模糊查询无匹配）
        this.clueTracker.record({
          user_clue: params.userClue,
          original_query: params.originalQuery,
          rewritten_query: '',
          clue_type: clueType,
          composite_score: 0,
          success: false,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return result;
  }

  /**
   * 生成特征选项式反问
   * ≤15字，带语气词
   */
  private generateQuestion(text: string): string {
    const types = detectClueType(text);
    if (types.length > 0) {
      const pool = FEATURE_OPTIONS[types[0]] ?? FEATURE_OPTIONS['scene'];
      return pool[Math.floor(Math.random() * pool.length)];
    }
    const fallbacks = ['是下雨那天吗？', '是有猫的那家吗？'];
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  }

  /**
   * 低置信度时的追问
   */
  private generateFollowUp(userText: string): string {
    if (/猫|狗|橘猫/.test(userText)) return '那是有大海景的那家吗？';
    if (/咖啡|窗|书/.test(userText)) return '是在巷子里的那家吗？';
    return '嗯…还有别的线索吗？';
  }

  /**
   * 提取原始 Query（取对话缓存中最近一条用户消息，非首条）
   */
  private extractOriginalQuery(): string {
    const msgs = this.conversationBuffer.filter((m) => m.role === 'user');
    return msgs.length > 0 ? msgs[msgs.length - 1].text : '';
  }

  /**
   * 重置对话缓存
   */
  reset(): void {
    this.conversationBuffer = [];
  }
}
