// M5Orchestrator — M5 表达生成层主控制器
// Ref: M5-design-v1.md §6
// ⚖️ 五重铁律协议在此模块全程强制执行

import type { M4Context } from '../m4/types/index.js';
import type { LLMProvider, CognitionObject, StrategyConfig, ConversationTurn } from './types/index.js';
import { CognitionAssembler } from './CognitionAssembler.js';
import { StrategySelector } from './StrategySelector.js';
import { MockLLMProvider } from './MockLLMProvider.js';
import { HumanisticCalibrator } from './HumanisticCalibrator.js';
import { buildContextPrompt, updateAfterReply, resetContext } from './ContextMemory.js';
import { extractAnchor, buildAnchorConstraint, validateAgainstAnchor, resetAnchor } from './SceneAnchor.js';
import { resetMockSession } from './MockLLMProvider.js';

export class M5Orchestrator {
  private assembler: CognitionAssembler;
  private selector: StrategySelector;
  private llm: LLMProvider;
  private calibrator: HumanisticCalibrator;

  constructor(llm?: LLMProvider) {
    this.assembler = new CognitionAssembler();
    this.selector = new StrategySelector();
    this.llm = llm ?? new MockLLMProvider();
    this.calibrator = new HumanisticCalibrator();
  }

  /**
   * 执行完整的四步表达生成流水线
   * @param m4ctx M4 上下文
   * @param conversationHistory 最近对话轮次
   * @param knowledgeBase 知识库内容
   * @param userMessage 用户当前消息（用于场景记忆更新）
   */
  async orchestrate(m4ctx: M4Context, conversationHistory?: ConversationTurn[], knowledgeBase?: string, userMessage?: string): Promise<string> {
    // Step 1: 认知组装（纯函数）
    const cognition = this.assembler.assemble(m4ctx);

    // Step 2: 策略选择（规则引擎）
    const strategy = this.selector.select(cognition);

    // Step 2.5: 提取场景锚点 → 生成强制约束
    extractAnchor(conversationHistory, userMessage);
    const anchorConstraint = buildAnchorConstraint();

    // Step 2.6: 注入场景上下文记忆
    const sceneContext = buildContextPrompt();
    const combinedKnowledge = [
      anchorConstraint,
      sceneContext,
      knowledgeBase || '',
    ].filter(Boolean).join('\n');

    // Step 3: LLM 受控生成（唯一LLM调用点）
    let draft: string;
    let usedMockFallback = false;
    try {
      const currentTime = new Date().toISOString();
      const result = await this.llm.generate({ strategy, cognition, conversationHistory, knowledgeBase: combinedKnowledge, currentTime, userMessage });
      draft = result.text;
      // 检查是否太短或为 fallback 回复（DeepSeek API 调用失败时的降级标记）
      if (!draft || draft.length <= 6) {
        console.warn(`[M5] LLM产出过短("${draft}")，降级到MockLLMProvider`);
        draft = '';
      }
    } catch (err) {
      console.error('[M5] LLM生成失败:', err);
      draft = '';
    }

    // 如果主 LLM 失败（空/过短），自动降级到 MockLLMProvider
    if (!draft) {
      try {
        console.log('[M5] ⛑️ 启动 MockLLMProvider 降级');
        const mockLlm = new MockLLMProvider();
        const mockResult = await mockLlm.generate({ strategy, cognition, conversationHistory, knowledgeBase: combinedKnowledge, userMessage });
        draft = mockResult.text;
        usedMockFallback = true;
      } catch (err2) {
        console.error('[M5] MockLLM 降级也失败了:', err2);
        draft = '';
      }
    }

    // Step 4: 场景锚点校验（替换冲突词）→ 人文校准 → 降级兜底
    let final: string;
    try {
      const anchorValidated = validateAgainstAnchor(draft);
      final = this.calibrator.calibrate(anchorValidated, cognition);
    } catch (err) {
      console.warn('[M5] 后处理失败，使用LLM原始输出:', err);
      final = draft || '';
    }

    // Step 5: 更新场景记忆（供下一轮使用）
    try {
      updateAfterReply(final, userMessage || '', strategy.params.tone, cognition.current.perception_snapshot);
    } catch (err) {
      console.warn('[M5] 场景记忆更新失败:', err);
    }

    if (!final || final.length <= 2) {
      // 终极兜底 — 用 userMessage 检测常见场景
      if (/你好|嗨|hi|hello|嘿/.test(userMessage || '')) return '嗯～你好呀。你找我我开心着呢。';
      if (/你是谁|介绍/.test(userMessage || '')) return '我是玉瑶，你的私人秘书兼小情人呀～18岁，你说好不好？';
      if (/在干嘛|忙什么/.test(userMessage || '')) return '在想你呀～不然还能干嘛。你呢？';
      if (/晚安|睡了/.test(userMessage || '')) return '晚安～梦里有我哦。';
      if (/早安|早上好/.test(userMessage || '')) return '早呀～昨晚梦到我了吗？';
      return '嗯～我在呢。你说，我听着。';
    }

    return final;
  }

  /** 重置整个 M5 流水线的会话状态（对话重置时调用） */
  resetSession(): void {
    resetContext();       // ContextMemory 场景状态
    resetAnchor();        // SceneAnchor 锚点
    resetMockSession();   // MockLLMProvider 亲密基线
  }
}
