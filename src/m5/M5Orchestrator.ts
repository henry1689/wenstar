// M5Orchestrator — M5 表达生成层主控制器
// Ref: M5-design-v1.md §6
// ⚖️ 五重铁律协议在此模块全程强制执行

import type { M4Context } from '../m4/types/index.js';
import type { LLMProvider, CognitionObject, StrategyConfig, ConversationTurn } from './types/index.js';
import { CognitionAssembler } from './CognitionAssembler.js';
import { StrategySelector } from './StrategySelector.js';
import { MockLLMProvider } from './MockLLMProvider.js';
import { HumanisticCalibrator } from './HumanisticCalibrator.js';
import { buildContextPrompt, updateFromUserMessage, updateAfterReply, resetContext } from './ContextMemory.js';
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

    // Step 2.55: 从用户消息更新场景（修复：ContextMemory只看draft不看用户消息）
    // 用户说"这是在办公室"→更新ContextMemory→buildContextPrompt返回正确场景
    updateFromUserMessage(userMessage || '');

    // Step 2.6: 注入场景上下文记忆
    const sceneContext = buildContextPrompt();
    const combinedKnowledge = [
      anchorConstraint,
      sceneContext,
      knowledgeBase || '',
    ].filter(Boolean).join('\n');

    // Step 3: LLM 受控生成（唯一LLM调用点）
    let draft: string;
    try {
      const currentTime = new Date().toISOString();
      const result = await this.llm.generate({ strategy, cognition, conversationHistory, knowledgeBase: combinedKnowledge, currentTime });
      draft = result.text;
    } catch (err) {
      console.error('[M5] LLM生成失败:', err);
      draft = '';
    }

    // Step 4: 场景锚点校验（替换冲突词）→ 人文校准 → 降级兜底
    const anchorValidated = validateAgainstAnchor(draft);
    const calibrated = this.calibrator.calibrate(anchorValidated, cognition);

    // Step 5: 更新场景记忆（供下一轮使用）
    updateAfterReply(calibrated, userMessage || '', strategy.params.tone, cognition.current.perception_snapshot);

    return calibrated;
  }

  /** 重置整个 M5 流水线的会话状态（对话重置时调用） */
  resetSession(): void {
    resetContext();       // ContextMemory 场景状态
    resetAnchor();        // SceneAnchor 锚点
    resetMockSession();   // MockLLMProvider 亲密基线
  }
}
