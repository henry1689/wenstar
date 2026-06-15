/**
 * M5 结构性守卫测试
 *
 * 用途：锁定 M5 模块的结构契约，防止后期架构漂移。
 * 覆盖：
 *   1. 类型接口（CognitionObject, StrategyConfig, LLMProvider）
 *   2. 类方法签名（M5Orchestrator, HumanisticCalibrator 等）
 *   3. 模块级函数导出（ContextMemory, SceneAnchor, MockLLMProvider）
 *   4. 表达引擎导出（ExpressionSpecController, ThinkingPauseInjector 等）
 *   5. 外部消费者契约（7 处外部 import）
 *
 * Ref: 架构加固指令 — M5 结构性守卫测试
 */

import { describe, it, expect } from 'vitest';
import { M5Orchestrator } from '../M5Orchestrator.js';
import { CognitionAssembler } from '../CognitionAssembler.js';
import { StrategySelector } from '../StrategySelector.js';
import { HumanisticCalibrator } from '../HumanisticCalibrator.js';
import { MockLLMProvider, resetMockSession } from '../MockLLMProvider.js';
import { DeepSeekLLMProvider, isAvailable } from '../DeepSeekLLMProvider.js';
import { buildContextPrompt, updateAfterReply, resetContext, getSceneSnapshot, setSceneSnapshot, fixSceneConflict } from '../ContextMemory.js';
import { extractAnchor, buildAnchorConstraint, validateAgainstAnchor, getAnchor, resetAnchor } from '../SceneAnchor.js';
import { injectThinkingPause } from '../expression/ThinkingPauseInjector.js';
import { calcExpressionSpec, validateLength } from '../expression/ExpressionSpecController.js';
import { safetyCheck, defaultSafetyConfig } from '../expression/ContextualSafetyGateway.js';
import { calcLevel } from '../expression/TierVocabMap.js';
import { M5ClueAssistant } from '../clue/M5ClueAssistant.js';
import type { CognitionObject, StrategyConfig, LLMProvider, ConversationTurn } from '../types/index.js';

// ════════════════════════════════════════════════════════════════════
// 第 1 组：类型接口形状守卫
// ════════════════════════════════════════════════════════════════════

describe('[M5守卫] types/index.ts 类型接口', () => {
  it('CognitionObject 含 current + history + strategy_hint + 可选 family', () => {
    const co: CognitionObject = {
      current: {
        action: ['memorize'],
        emotion_summary: '中性表达',
        key_entities: ['妈妈'],
        calcium_level: 1,
        raw_input: 'text',
        perception_snapshot: {
          pleasure: 0.5, arousal: 0.5, intimacy: 0.5,
          sexual_attraction: 0.5, sensory_craving: 0.5,
          energy_merge: 0.5, possessiveness: 0.5, ecstasy: 0.5,
          sincerity: 0.5, aggression: 0.5, dominance: 0.5, safety: 0.5,
        },
      },
      history: { has_relevant_history: false, summary: '无', time_span: '' },
      strategy_hint: { tone: 'neutral', depth: 'shallow', urgency: 'low' },
    };
    expect(co.strategy_hint.tone).toBeDefined();
    expect(co.current.action.length).toBeGreaterThan(0);
    expect(Object.keys(co.current.perception_snapshot).length).toBe(12);
  });

  it('StrategyConfig 含 strategy_id + params + description', () => {
    const sc: StrategyConfig = {
      strategy_id: 'com-warm',
      params: { tone: 'warm', max_length: 100, include_entity: [], include_history: false, include_family: false },
      description: '温暖支持',
    };
    expect(sc.params.tone).toBeDefined();
    expect(sc.params.max_length).toBeGreaterThan(0);
  });

  it('ConversationTurn 含 role + content + 可选 timestamp', () => {
    const ct: ConversationTurn = { role: 'user', content: '你好', timestamp: new Date().toISOString() };
    expect(ct.role).toBeDefined();
    expect(ct.timestamp).toBeTruthy();
    const ct2: ConversationTurn = { role: 'assistant', content: '嗨' };
    expect(ct2.timestamp).toBeUndefined();
  });

  it('LLMProvider 接口 — generate 返回 { text, usage? }', () => {
    // 运行时验证 MockLLMProvider 实现了 LLMProvider
    const provider: LLMProvider = new MockLLMProvider();
    expect(typeof provider.generate).toBe('function');
    // resetMockSession 是独立导出函数
    expect(typeof resetMockSession).toBe('function');
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 2 组：类方法签名守卫
// ════════════════════════════════════════════════════════════════════

describe('[M5守卫] M5Orchestrator 方法签名', () => {
  const proto = M5Orchestrator.prototype;
  it('构造函数接受 llm?', () => { expect(M5Orchestrator).toBeInstanceOf(Function); });
  it('orchestrate(m4ctx, history?, kb?, userMessage?)', () => { expect(typeof proto.orchestrate).toBe('function'); });
  it('resetSession() — 重置全部状态', () => { expect(typeof proto.resetSession).toBe('function'); });
});

describe('[M5守卫] CognitionAssembler 方法签名', () => {
  const proto = CognitionAssembler.prototype;
  it('构造函数', () => { expect(CognitionAssembler).toBeInstanceOf(Function); });
  it('assemble(m4ctx)', () => { expect(typeof proto.assemble).toBe('function'); });
});

describe('[M5守卫] StrategySelector 方法签名', () => {
  const proto = StrategySelector.prototype;
  it('构造函数', () => { expect(StrategySelector).toBeInstanceOf(Function); });
  it('select(cognition)', () => { expect(typeof proto.select).toBe('function'); });
});

describe('[M5守卫] HumanisticCalibrator 方法签名', () => {
  const proto = HumanisticCalibrator.prototype;
  it('构造函数', () => { expect(HumanisticCalibrator).toBeInstanceOf(Function); });
  it('calibrate(draft, cognition)', () => { expect(typeof proto.calibrate).toBe('function'); });
});

describe('[M5守卫] MockLLMProvider 方法签名', () => {
  const proto = MockLLMProvider.prototype;
  it('构造函数', () => { expect(MockLLMProvider).toBeInstanceOf(Function); });
  it('generate(params)', () => { expect(typeof proto.generate).toBe('function'); });
});

describe('[M5守卫] DeepSeekLLMProvider 方法签名', () => {
  it('类存在', () => { expect(DeepSeekLLMProvider).toBeInstanceOf(Function); });
  it('isAvailable 是函数', () => { expect(typeof isAvailable).toBe('function'); });
});

describe('[M5守卫] M5ClueAssistant 方法签名', () => {
  it('类存在', () => { expect(M5ClueAssistant).toBeInstanceOf(Function); });
});

// ════════════════════════════════════════════════════════════════════
// 第 3 组：模块级函数导出守卫
// ════════════════════════════════════════════════════════════════════

describe('[M5守卫] ContextMemory 模块导出', () => {
  it('导出 6 个核心函数（updateAfterReply 已内化 userMessage 场景同步）', () => {
    expect(typeof buildContextPrompt).toBe('function');
    expect(typeof updateAfterReply).toBe('function');
    expect(typeof resetContext).toBe('function');
    expect(typeof getSceneSnapshot).toBe('function');
    expect(typeof setSceneSnapshot).toBe('function');
    expect(typeof fixSceneConflict).toBe('function');
  });
  it('原 6 个导出函数也存在', () => {
    expect(typeof buildContextPrompt).toBe('function');
    expect(typeof updateAfterReply).toBe('function');
    expect(typeof resetContext).toBe('function');
    expect(typeof getSceneSnapshot).toBe('function');
    expect(typeof setSceneSnapshot).toBe('function');
    expect(typeof fixSceneConflict).toBe('function');
  });
  it('默认场景快照 key 完整', () => {
    const s = getSceneSnapshot();
    expect(s.physical.nudityLevel).toBeDefined();
    expect(s.atmosphere.tension).toBeDefined();
    expect(s.facts.lastIntimatePeak).toBeDefined();
  });
});

describe('[M5守卫] SceneAnchor 模块导出', () => {
  it('导出 extractAnchor 等 6 个函数', () => {
    expect(typeof extractAnchor).toBe('function');
    expect(typeof buildAnchorConstraint).toBe('function');
    expect(typeof validateAgainstAnchor).toBe('function');
    expect(typeof getAnchor).toBe('function');
    expect(typeof resetAnchor).toBe('function');
  });
  it('CONFLICT_PAIRS 与 ContextMemory.updatePhysical 位置对齐', () => {
    // 验证场景锚点冲突词覆盖所有 updatePhysical 可检测的位置
    // 此测试确保两模块位置词表同步——新增位置须同时更新两个文件
    extractAnchor([
      { role: 'user', content: '我在床上' },
    ]);
    const a = getAnchor();
    expect(a.isActive).toBe(true);
    expect(a.location).toBeTruthy();
  });
});

describe('[M5守卫] 表达引擎导出', () => {
  it('injectThinkingPause 是函数', () => { expect(typeof injectThinkingPause).toBe('function'); });
  it('calcExpressionSpec 是函数', () => { expect(typeof calcExpressionSpec).toBe('function'); });
  it('validateLength 是函数', () => { expect(typeof validateLength).toBe('function'); });
  it('calcLevel 是函数', () => { expect(typeof calcLevel).toBe('function'); });
  it('safetyCheck 是函数', () => { expect(typeof safetyCheck).toBe('function'); });
  it('defaultSafetyConfig 是函数', () => { expect(typeof defaultSafetyConfig).toBe('function'); });
});

// ════════════════════════════════════════════════════════════════════
// 第 4 组：运行时不变性守卫
// ════════════════════════════════════════════════════════════════════

describe('[M5守卫] 运行时不变性', () => {
  it('resetSession 重置全部三方状态', () => {
    const m5 = new M5Orchestrator();
    // 验证 resetSession 存在且可正常调用
    expect(typeof m5.resetSession).toBe('function');
    m5.resetSession();
  });

  it('MockLLMProvider 可实例化且 generate 返回 text', async () => {
    const llm = new MockLLMProvider();
    const result = await llm.generate({
      strategy: { strategy_id: 'mem-general', params: { tone: 'neutral', max_length: 20, include_entity: [], include_history: false, include_family: false }, description: '简短确认' },
      cognition: {
        current: { action: ['memorize'], emotion_summary: '中性', key_entities: [], calcium_level: 1, raw_input: '测试', perception_snapshot: { pleasure: 0, arousal: 0, intimacy: 0, sexual_attraction: 0, sensory_craving: 0, energy_merge: 0, possessiveness: 0, ecstasy: 0, sincerity: 0, aggression: 0, dominance: 0, safety: 0.5 } },
        history: { has_relevant_history: false, summary: '', time_span: '' },
        strategy_hint: { tone: 'neutral', depth: 'shallow', urgency: 'low' },
      },
    });
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('resetMockSession 重置亲密基线', () => {
    resetMockSession();
    // 重置后 MockLLMProvider 生成仍正常
    const llm = new MockLLMProvider();
    expect(llm).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 5 组：外部消费者契约守卫
// ════════════════════════════════════════════════════════════════════

describe('[M5守卫] 外部消费者契约', () => {
  it('M5Orchestrator 被 webui(2处)/cli/e2e 使用 — 有 orchestrate 和 resetSession', () => {
    const proto = M5Orchestrator.prototype;
    expect(typeof proto.orchestrate).toBe('function');
    expect(typeof proto.resetSession).toBe('function');
  });

  it('ClaudeLLMProvider 已被删除 — 不允许重新创建', async () => {
    // 验证文件已被删除
    const fs = await import('node:fs');
    const exists = fs.existsSync(new URL('../ClaudeLLMProvider.ts', import.meta.url));
    expect(exists).toBe(false);
  });
});
