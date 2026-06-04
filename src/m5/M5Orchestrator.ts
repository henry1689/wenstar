// M5Orchestrator — M5 表达生成层主控制器
// Ref: M5-design-v1.md §6

import type { M4Context } from '../m4/types/index.js';
import type { LLMProvider, CognitionObject, StrategyConfig, ConversationTurn } from './types/index.js';
import { CognitionAssembler } from './CognitionAssembler.js';
import { StrategySelector } from './StrategySelector.js';
import { MockLLMProvider } from './MockLLMProvider.js';
import { HumanisticCalibrator } from './HumanisticCalibrator.js';

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
   * @param conversationHistory 最近对话轮次（用于 LLM 上下文记忆）
   * @param knowledgeBase 知识库内容（注入到系统提示层）
   */
  async orchestrate(m4ctx: M4Context, conversationHistory?: ConversationTurn[], knowledgeBase?: string): Promise<string> {
    // Step 1: 认知组装（纯函数）
    const cognition = this.assembler.assemble(m4ctx);

    // Step 2: 策略选择（规则引擎）
    const strategy = this.selector.select(cognition);

    // Step 3: LLM 受控生成（唯一LLM调用点）
    let draft: string;
    try {
      const result = await this.llm.generate({ strategy, cognition, conversationHistory, knowledgeBase });
      draft = result.text;
    } catch (err) {
      console.error('[M5] LLM生成失败:', err);
      draft = '';
    }

    // Step 4: 人文校准 + 降级兜底
    return this.calibrator.calibrate(draft, cognition);
  }
}
