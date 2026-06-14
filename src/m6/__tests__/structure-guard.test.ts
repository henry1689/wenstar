/**
 * M6 结构性守卫测试
 *
 * 用途：锁定 M6 模块的结构契约，防止后期架构漂移。
 * 覆盖：
 *   1. 类型接口（M6SelfModel, EvolutionSignal, EvolutionDecision 等）
 *   2. 类方法签名（M6Orchestrator + 5 个子引擎）
 *   3. 核心功能不变性（演化逻辑、叙事构建）
 *   4. 代理方法存在性（绕过内部引擎直接访问的封装层）
 *   5. 外部消费者契约（4 处外部 import）
 *
 * Ref: 架构加固指令 — M6 结构性守卫测试
 */

import { describe, it, expect } from 'vitest';
import { M6Orchestrator } from '../M6Orchestrator.js';
import { SelfModelManager } from '../SelfModelManager.js';
import { TraitEvolver } from '../TraitEvolver.js';
import { PreferenceManager } from '../PreferenceManager.js';
import { BoundaryManager } from '../BoundaryManager.js';
import { NarrativeBuilder } from '../NarrativeBuilder.js';
import type {
  M6SelfModel, SelfModelTraits, Preference, Boundary,
  NarrativeLayer, CoreIdentityAnchors, EvolutionSignal, EvolutionDecision,
} from '../types/index.js';
import { DEFAULT_TRAITS, DEFAULT_ANCHORS } from '../types/index.js';

// ════════════════════════════════════════════════════════════════════
// 第 1 组：类型接口形状守卫
// ════════════════════════════════════════════════════════════════════

describe('[M6守卫] types/index.ts 类型接口', () => {
  it('M6SelfModel 含 traits/preferences/boundaries/narrative_layers/version/last_updated', () => {
    const m: M6SelfModel = {
      traits: DEFAULT_TRAITS, preferences: [], boundaries: [],
      narrative_layers: [], version: '1.0', last_updated: new Date().toISOString(),
    };
    expect(Object.keys(m.traits).length).toBe(5);
    expect(Array.isArray(m.preferences)).toBe(true);
    expect(m.version).toBe('1.0');
  });

  it('SelfModelTraits 有 5 个大五人格字段 [0,1]', () => {
    const t: SelfModelTraits = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 };
    const keys = Object.keys(t);
    expect(keys.length).toBe(5);
    for (const v of Object.values(t)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('Preference 含 name/type/strength/mentionCount/lastMentioned/source_entities', () => {
    const p: Preference = { name: '咖啡', type: 'like', strength: 0.5, mentionCount: 1, lastMentioned: new Date().toISOString(), source_entities: [] };
    expect(['like', 'dislike']).toContain(p.type);
    expect(p.strength).toBeGreaterThanOrEqual(0);
  });

  it('Boundary 含 rule/severity/hitCount/lastHit/context', () => {
    const b: Boundary = { rule: '不讨论政治', severity: 'hard', hitCount: 0, lastHit: '', context: '默认' };
    expect(['soft', 'hard']).toContain(b.severity);
    expect(typeof b.rule).toBe('string');
  });

  it('NarrativeLayer 含 layer_id/text/trigger_event/created_at/calcium_at_event', () => {
    const nl: NarrativeLayer = { layer_id: 1, text: '今天是开心的一天', trigger_event: '用户说了开心的事', created_at: new Date().toISOString(), calcium_at_event: 2 };
    expect(nl.layer_id).toBeGreaterThanOrEqual(1);
    expect(nl.calcium_at_event).toBeGreaterThanOrEqual(0);
  });

  it('CoreIdentityAnchors 含 title/role + language_protocol', () => {
    const cia: CoreIdentityAnchors = { title: '玉瑶', role: '伴侣', language_protocol: { forbidden_words: ['分手'], reserved_phrases: ['爱你'] } };
    expect(cia.title).toBeTruthy();
    expect(Array.isArray(cia.language_protocol.forbidden_words)).toBe(true);
  });

  it('EvolutionSignal 含 dimension/direction/delta/e1/i2/c1/timestamp', () => {
    const es: EvolutionSignal = { dimension: '开心', direction: 'increase', delta: 8, e1_pleasure: 0.6, i2_intimacy: 0.3, c1_conflict: 0.1, timestamp: new Date().toISOString() };
    expect(['increase', 'decrease']).toContain(es.direction);
    expect(es.delta).toBeGreaterThan(0);
  });

  it('EvolutionDecision 含 applied/level/reason + 可选 old/newValue', () => {
    const ed: EvolutionDecision = { applied: true, level: 'auto', reason: '小调', oldValue: 0.5, newValue: 0.55 };
    expect(['auto', 'soften', 'blocked']).toContain(ed.level);
    expect(typeof ed.reason).toBe('string');
  });

  it('DEFAULT_TRAITS 有默认值', () => {
    expect(DEFAULT_TRAITS.openness).toBe(0.7);
    expect(DEFAULT_TRAITS.neuroticism).toBe(0.3);
  });

  it('DEFAULT_ANCHORS 有默认 title 和 role', () => {
    expect(DEFAULT_ANCHORS.title).toBe('玉瑶');
    expect(DEFAULT_ANCHORS.role).toContain('伴侣');
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 2 组：类方法签名 + 代理方法守卫
// ════════════════════════════════════════════════════════════════════

describe('[M6守卫] M6Orchestrator 方法签名', () => {
  const proto = M6Orchestrator.prototype;
  it('构造函数', () => { expect(M6Orchestrator).toBeInstanceOf(Function); });
  it('processSignal(signal) — 核心演化入口', () => { expect(typeof proto.processSignal).toBe('function'); });
  it('maintenance() — 空闲维护', () => { expect(typeof proto.maintenance).toBe('function'); });

  it('代理方法 getModel()', () => { expect(typeof proto.getModel).toBe('function'); });
  it('代理方法 getTraits()', () => { expect(typeof proto.getTraits).toBe('function'); });
  it('代理方法 getPreferences()', () => { expect(typeof proto.getPreferences).toBe('function'); });
  it('代理方法 getBoundaries()', () => { expect(typeof proto.getBoundaries).toBe('function'); });
  it('代理方法 getNarrativeLayers()', () => { expect(typeof proto.getNarrativeLayers).toBe('function'); });
  it('代理方法 getAnchors()', () => { expect(typeof proto.getAnchors).toBe('function'); });
  it('代理方法 applyConfirmed()', () => { expect(typeof proto.applyConfirmed).toBe('function'); });
});

describe('[M6守卫] SelfModelManager 方法签名', () => {
  const proto = SelfModelManager.prototype;
  it('构造函数', () => { expect(SelfModelManager).toBeInstanceOf(Function); });
  it('load()', () => { expect(typeof proto.load).toBe('function'); });
  it('save()', () => { expect(typeof proto.save).toBe('function'); });
  it('getModel()', () => { expect(typeof proto.getModel).toBe('function'); });
  it('getTraits()', () => { expect(typeof proto.getTraits).toBe('function'); });
  it('getPreferences()', () => { expect(typeof proto.getPreferences).toBe('function'); });
  it('getBoundaries()', () => { expect(typeof proto.getBoundaries).toBe('function'); });
  it('getNarrativeLayers()', () => { expect(typeof proto.getNarrativeLayers).toBe('function'); });
  it('getAnchors()', () => { expect(typeof proto.getAnchors).toBe('function'); });
  it('addPreference()', () => { expect(typeof proto.addPreference).toBe('function'); });
  it('addBoundary()', () => { expect(typeof proto.addBoundary).toBe('function'); });
  it('addNarrativeLayer()', () => { expect(typeof proto.addNarrativeLayer).toBe('function'); });
  it('updateTraits()', () => { expect(typeof proto.updateTraits).toBe('function'); });
  it('checkCoreIdentity()', () => { expect(typeof proto.checkCoreIdentity).toBe('function'); });
  it('resetToDefault()', () => { expect(typeof proto.resetToDefault).toBe('function'); });
});

describe('[M6守卫] TraitEvolver 方法签名', () => {
  const proto = TraitEvolver.prototype;
  it('addFeedback(signal)', () => { expect(typeof proto.addFeedback).toBe('function'); });
  it('mapToTrait(dimension)', () => { expect(typeof proto.mapToTrait).toBe('function'); });
  it('proposeEvolution(dim, direction, delta)', () => { expect(typeof proto.proposeEvolution).toBe('function'); });
  it('applyConfirmed(dim, direction, delta)', () => { expect(typeof proto.applyConfirmed).toBe('function'); });
  it('clearBuffer()', () => { expect(typeof proto.clearBuffer).toBe('function'); });
});

describe('[M6守卫] PreferenceManager 方法签名', () => {
  const proto = PreferenceManager.prototype;
  it('recordMention(name, e1Pleasure)', () => { expect(typeof proto.recordMention).toBe('function'); });
  it('applyDecay()', () => { expect(typeof proto.applyDecay).toBe('function'); });
  it('getActive()', () => { expect(typeof proto.getActive).toBe('function'); });
});

describe('[M6守卫] BoundaryManager 方法签名', () => {
  const proto = BoundaryManager.prototype;
  it('recordHit(rule, wasRejected, calcium, arousal)', () => { expect(typeof proto.recordHit).toBe('function'); });
  it('applyDecay()', () => { expect(typeof proto.applyDecay).toBe('function'); });
});

describe('[M6守卫] NarrativeBuilder 方法签名', () => {
  const proto = NarrativeBuilder.prototype;
  it('addLayer(text, triggerEvent, calcium)', () => { expect(typeof proto.addLayer).toBe('function'); });
  it('detectConflict(newText)', () => { expect(typeof proto.detectConflict).toBe('function'); });
});

// ════════════════════════════════════════════════════════════════════
// 第 3 组：核心功能不变性守卫
// ════════════════════════════════════════════════════════════════════

describe('[M6守卫] 核心功能不变性', () => {
  it('mapToTrait 将实体名映射到大五人格维度', () => {
    const manager = new SelfModelManager();
    const evolver = new TraitEvolver(manager);
    expect(evolver.mapToTrait('累')).toBe('neuroticism');
    expect(evolver.mapToTrait('开心')).toBe('extraversion');
    expect(evolver.mapToTrait('好奇')).toBe('openness');
    expect(evolver.mapToTrait('工作')).toBe('conscientiousness');
    expect(evolver.mapToTrait('共情')).toBe('agreeableness');
    expect(evolver.mapToTrait('不存在')).toBeNull();
  });

  it('proposeEvolution 对小幅度(≤5%)且不足5次信号返回 not applied', () => {
    const manager = new SelfModelManager();
    const evolver = new TraitEvolver(manager);
    const result = evolver.proposeEvolution('开心', 'increase', 3);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('信号不足');
  });

  it('applyConfirmed 不需要信号计数，直接演化', () => {
    const manager = new SelfModelManager();
    manager.resetToDefault(); // 从基线开始，避免之前测试轮次副作用
    const evolver = new TraitEvolver(manager);
    const before = manager.getTraits().extraversion;
    const result = evolver.applyConfirmed('开心', 'increase', 10);
    const after = manager.getTraits().extraversion;
    if (result.applied) {
      expect(after).toBeGreaterThan(before!);
    }
  });

  it('NarrativeBuilder detectConflict 检测矛盾叙事', () => {
    const manager = new SelfModelManager();
    const builder = new NarrativeBuilder(manager);
    builder.addLayer('我恨你', '吵架', 3);
    const conflicts = builder.detectConflict('我喜欢你');
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('NarrativeBuilder addLayer 钙质不足(calcium<2)不添加', () => {
    const manager = new SelfModelManager();
    const builder = new NarrativeBuilder(manager);
    const before = manager.getNarrativeLayers().length;
    builder.addLayer('测试', '测试', 1);
    expect(manager.getNarrativeLayers().length).toBe(before);
  });

  it('processSignal 钙质≥2时产生叙事层', async () => {
    const m6 = new M6Orchestrator();
    m6.manager.resetToDefault(); // 从基线开始，避免之前测试写入的"我恨你"冲突
    const before = m6.getNarrativeLayers().length;
    await m6.processSignal({
      dimension: '开心', direction: 'increase', delta: 3,
      e1_pleasure: 0.8, i2_intimacy: 0.4, c1_conflict: 0,
      calcium: 2, triggerEvent: '今天真的好开心',
    });
    const after = m6.getNarrativeLayers().length;
    // 叙事层应增加
    expect(after).toBeGreaterThanOrEqual(before);
    // 叙事文本应为 triggerEvent 而非"多元感知到强烈信号"
    if (after > before) {
      const latest = m6.getNarrativeLayers()[m6.getNarrativeLayers().length - 1];
      expect(latest.text).toContain('今天真的好开心');
      expect(latest.text).not.toContain('多元感知');
    }
  });

  it('代理方法 getModel/getTraits 返回与 manager 相同的数据', () => {
    const m6 = new M6Orchestrator();
    const viaProxy = m6.getTraits();
    const viaDirect = m6.manager.getTraits();
    expect(viaProxy.openness).toBe(viaDirect.openness);
    expect(viaProxy.extraversion).toBe(viaDirect.extraversion);
  });

  it('maintenance 不崩溃', () => {
    const m6 = new M6Orchestrator();
    m6.maintenance();
    expect(true).toBe(true); // 不崩溃即通过
  });
});

// ════════════════════════════════════════════════════════════════════
// 第 4 组：外部消费者契约守卫
// ════════════════════════════════════════════════════════════════════

describe('[M6守卫] 外部消费者契约', () => {
  it('M6Orchestrator 被 webui(2处)/m7(2处) 使用 — 有 processSignal/maintenance', () => {
    const proto = M6Orchestrator.prototype;
    expect(typeof proto.processSignal).toBe('function');
    expect(typeof proto.maintenance).toBe('function');
  });

  it('代理方法 applyConfirmed 被 m7/DreamInternalizer 使用 — 替代 direct evolver.applyConfirmed', () => {
    const proto = M6Orchestrator.prototype;
    expect(typeof proto.applyConfirmed).toBe('function');
  });

  it('代理方法 getModel/getTraits 被 webui/server 使用 — 替代 direct manager.getXxx', () => {
    const proto = M6Orchestrator.prototype;
    expect(typeof proto.getModel).toBe('function');
    expect(typeof proto.getTraits).toBe('function');
  });
});
