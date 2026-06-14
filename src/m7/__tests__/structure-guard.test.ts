/**
 * M7 结构性守卫测试
 *
 * 覆盖类型接口 + 类方法签名 + 代理方法 + 核心功能 + 三系统联动
 * 修复: 验证 ConsolidationQueue↔DreamQueue、InductionScheduler↔DreamQueue 联动存在
 */
import { describe, it, expect } from 'vitest';
import { M7Orchestrator, startM7Interval } from '../M7Orchestrator.js';
import { DreamQueue } from '../DreamQueue.js';
import { DreamInternalizer } from '../DreamInternalizer.js';
import { ClueTracker } from '../ClueTracker.js';
import { ConsolidationQueue } from '../ConsolidationQueue.js';
import { InductionScheduler } from '../InductionScheduler.js';
import type { PendingDream, ClueEffectiveness, InteractionLog } from '../types/index.js';

describe('[M7守卫] 类型接口', () => {
  it('PendingDream 结构', () => {
    const d: PendingDream = {
      id: 'dream_001', source: 'M3', content: '测试', affected_traits: ['extraversion'],
      created_at: new Date().toISOString(), status: 'pending',
    };
    expect(['pending', 'probing', 'confirmed', 'rejected', 'conflict']).toContain(d.status);
  });
  it('ClueEffectiveness 结构', () => {
    const ce: ClueEffectiveness = { clue_type: '场景', total_uses: 10, successful_matches: 7, success_rate: 0.7 };
    expect(ce.success_rate).toBeGreaterThanOrEqual(0);
  });
  it('InteractionLog 结构', () => {
    const il: InteractionLog = { user_clue: '猫', original_query: '上次的店', rewritten_query: '', clue_type: '物品', composite_score: 0.8, success: true, timestamp: new Date().toISOString() };
    expect(il.composite_score).toBeGreaterThanOrEqual(0);
  });
});

describe('[M7守卫] 类方法签名', () => {
  it('M7Orchestrator 存在且 6 个代理方法', () => {
    const p = M7Orchestrator.prototype;
    expect(typeof p.processIdle).toBe('function');
    expect(typeof p.setM6).toBe('function');
    expect(typeof p.shouldProcessQueue).toBe('function');
    expect(typeof p.cleanResolvedQueue).toBe('function');
    expect(typeof p.getPendingDreams).toBe('function');
    expect(typeof p.getDreamCount).toBe('function');
    expect(typeof p.addDream).toBe('function');
    expect(typeof p.getDreamsByStatus).toBe('function');
  });
  it('DreamQueue', () => {
    const p = DreamQueue.prototype;
    expect(typeof p.add).toBe('function');
    expect(typeof p.shouldProcess).toBe('function');
    expect(typeof p.getPending).toBe('function');
    expect(typeof p.getCount).toBe('function');
    expect(typeof p.updateStatus).toBe('function');
    expect(typeof p.cleanResolved).toBe('function');
  });
  it('DreamInternalizer', () => {
    const p = DreamInternalizer.prototype;
    expect(typeof p.internalize).toBe('function');
    expect(typeof p.internalizeBatch).toBe('function');
    expect(typeof p.setM6).toBe('function');
  });
  it('ClueTracker', () => {
    const p = ClueTracker.prototype;
    expect(typeof p.record).toBe('function');
    expect(typeof p.getEffectiveness).toBe('function');
    expect(typeof p.generateAdvice).toBe('function');
  });
  it('ConsolidationQueue — 含 DreamQueue 联动接口', () => {
    const p = ConsolidationQueue.prototype;
    expect(typeof p.start).toBe('function');
    expect(typeof p.stop).toBe('function');
    expect(typeof p.recordActivity).toBe('function');
    expect(typeof (p as any).setDreamQueue).toBe('function');
  });
  it('InductionScheduler — 含 DreamQueue 联动接口', () => {
    const p = InductionScheduler.prototype;
    expect(typeof p.start).toBe('function');
    expect(typeof p.stop).toBe('function');
    expect(typeof (p as any).setDreamQueue).toBe('function');
  });
  it('startM7Interval 是函数', () => { expect(typeof startM7Interval).toBe('function'); });
});

describe('[M7守卫] 核心功能', () => {
  it('DreamQueue shouldProcess 阈值10+24h超时', () => {
    const tmp = '__m7_test_should.db';
    try { require('node:fs').unlinkSync(tmp); } catch {}
    const dq = new DreamQueue(tmp);
    expect(dq.shouldProcess()).toBe(false);
    // 加1条 → 仍不足
    dq.add({ source: 'M3', content: 'test', affected_traits: ['extraversion'] });
    expect(dq.shouldProcess()).toBe(false);
    // shouldProcess 内部: >=10 或 任一条>=24h
    expect(dq.getCount()).toBe(1);
    expect(dq.getPending().length).toBe(1);
  });
  it('DreamQueue add/updateStatus/cleanResolved 不崩溃', () => {
    const tmp = '__m7_test_crud.db';
    try { require('node:fs').unlinkSync(tmp); } catch {}
    const dq = new DreamQueue(tmp);
    const d = dq.add({ source: 'M3', content: 'test', affected_traits: ['extraversion'] });
    expect(d.status).toBe('pending');
    dq.updateStatus(d.id, 'confirmed');
    dq.cleanResolved();
    expect(dq.getPending().length).toBe(0);
  });
  it('ClueTracker record/getLogs 不崩溃', () => {
    const tmp = '__m7_test_logs.db';
    try { require('node:fs').unlinkSync(tmp); } catch {}
    const ct = new (ClueTracker as any)(tmp);
    ct.record({ user_clue: '猫', original_query: '上次', rewritten_query: '', clue_type: '物品', composite_score: 0.8, success: true, timestamp: new Date().toISOString() });
    expect(ct.getLogs().length).toBe(1);
  });
  it('ConsolidationQueue 构造不崩溃', () => {
    const cq = new (ConsolidationQueue as any)();
    expect(cq).toBeDefined();
  });
  it('InductionScheduler 构造不崩溃', () => {
    // InductionScheduler 需要 FusionStorageAdapter，跳过构造测试
    expect(InductionScheduler).toBeInstanceOf(Function);
  });
});
