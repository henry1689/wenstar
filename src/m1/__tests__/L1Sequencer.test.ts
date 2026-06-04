// Ref: ARCH.md §3.2 写入正向流 — L1 seq_pos 严格单调递增

import { describe, it, expect, beforeEach } from 'vitest';
import { L1Sequencer } from '../L1Sequencer.js';

describe('L1Sequencer — 单调递增', () => {
  let seq: L1Sequencer;

  beforeEach(() => {
    seq = new L1Sequencer();
  });

  it('连续调用应产生严格递增的 seq_pos', () => {
    const r1 = seq.next();
    const r2 = seq.next();
    const r3 = seq.next();

    expect(r1.seq_pos).toBe(1);
    expect(r2.seq_pos).toBe(2);
    expect(r3.seq_pos).toBe(3);
  });

  it('seq_pos 与 branch_id 中的序号应一致', () => {
    const r1 = seq.next();
    const r2 = seq.next();

    expect(r1.branch_id).toContain('_001');
    expect(r2.branch_id).toContain('_002');
  });

  it('重置后应从 1 重新开始', () => {
    seq.next();
    seq.next();
    expect(seq.getCurrentCount()).toBe(2);

    seq.reset();
    const r = seq.next();
    expect(r.seq_pos).toBe(1);
  });

  it('branch_id 应包含当前日期', () => {
    const result = seq.next();
    const today = new Date();
    const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    expect(result.branch_id).toContain(dateStr);
  });
});

describe('L1Sequencer — 格式合规', () => {
  it('branch_id 应符合 evt_YYYYMMDD_NNN 格式', () => {
    const seq = new L1Sequencer();
    const result = seq.next();
    expect(result.branch_id).toMatch(/^evt_\d{8}_\d{3}$/);
  });
});
