// Ref: ARCH.md §3.2 写入正向流 — L0→L1→L2→L3 逐层
// Ref: ARCH.md §3.2 无DNA不写入
// Ref: 架构决策备忘录 v1.3 — 最小语义单位边界

import { describe, it, expect, beforeEach } from 'vitest';
import { DNAEncoder } from '../DNAEncoder.js';
import type { SelfModelV1 } from '../types/dna.js';

const TEST_SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '测试人格', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  boundaries: [],
  preferences: { likes: [], dislikes: [] },
  narrative_identity: '我是测试自我',
};

// ─── 基础编码（encodeSingle / encodeBatch）───
// Ref: ARCH.md §3.2 写入正向流
describe('DNAEncoder — encodeSingle 基础编码', () => {
  let encoder: DNAEncoder;

  beforeEach(() => {
    encoder = new DNAEncoder(TEST_SELF);
  });

  it('编码结果应包含完整的 L0-L3 字段', () => {
    const dna = encoder.encodeSingle('今天工作压力好大');
    expect(dna).toBeDefined();
    expect(dna.locus_path).toBeTruthy();
    expect(dna.taxonomy_version).toBeTruthy();
    expect(dna.branch_id).toBeTruthy();
    expect(dna.seq_pos).toBeGreaterThanOrEqual(1);
    expect(dna.leaf_zone).toBeTruthy();
    expect(dna.ref).toBeTruthy();
    expect(dna.entity_genes).toBeDefined();
    expect(dna.raw_input).toBe('今天工作压力好大');
    expect(dna.created_at).toBeTruthy();
  });

  it('L0 路由结果应影响 leaf_zone 映射', () => {
    const dnaEmotion = encoder.encodeSingle('我好难过');
    expect(dnaEmotion.leaf_zone).toBe('emotion_valence_zone');

    const dnaWork = encoder.encodeSingle('今天加班到很晚');
    expect(dnaWork.leaf_zone).toBe('language_semantic_zone');
  });

  it('序列号应严格递增', () => {
    const d1 = encoder.encodeSingle('第一条');
    const d2 = encoder.encodeSingle('第二条');
    const d3 = encoder.encodeSingle('第三条');

    expect(d2.seq_pos).toBe(d1.seq_pos + 1);
    expect(d3.seq_pos).toBe(d2.seq_pos + 1);
  });

  it('空输入应路由到 misc.default 但 DNA 结构完整', () => {
    const dna = encoder.encodeSingle('');
    expect(dna.locus_path).toBe('user.misc.default');
    expect(dna.branch_id).toBeTruthy();
    expect(dna.entity_genes).toEqual([]);
  });
});

// ─── 批量编码 ───
describe('DNAEncoder — encodeBatch 批量编码', () => {
  it('批量编码应返回等量结果', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const inputs = [
      { utterance: '今天很开心' },
      { utterance: '工作好累' },
      { utterance: '天气不错' },
    ];
    const results = encoder.encodeBatch(inputs);
    expect(results).toHaveLength(3);
    // seq_pos 全局递增
    expect(results[1].seq_pos).toBe(results[0].seq_pos + 1);
    expect(results[2].seq_pos).toBe(results[1].seq_pos + 1);
  });
});

// ─── 流式 push / flush ───
// Ref: 架构决策备忘录 v1.3
describe('DNAEncoder — push/flush 流式缓冲', () => {
  let encoder: DNAEncoder;

  beforeEach(() => {
    encoder = new DNAEncoder(TEST_SELF);
  });

  it('push 后应缓冲，getBufferSize 返回正确', () => {
    expect(encoder.getBufferSize()).toBe(0);
    encoder.push('第一条');
    expect(encoder.getBufferSize()).toBe(1);
    encoder.push('还是同一条');
    expect(encoder.getBufferSize()).toBe(2);
  });

  it('flush 应返回合并后的完整文本', () => {
    encoder.push('今天工作压力好大');
    encoder.push('老板又给了新任务');
    encoder.push('同事也都在加班');

    const dna = encoder.flush();
    expect(dna).not.toBeNull();
    expect(dna!.raw_input).toBe('今天工作压力好大 老板又给了新任务 同事也都在加班');
    expect(dna!.seq_pos).toBe(1);
  });

  it('连续两次 push+flush 应得到两条独立的 DNA', () => {
    const e1 = encoder.push('第一条');
    const d1 = encoder.flush();
    expect(d1).not.toBeNull();
    expect(d1!.seq_pos).toBe(1);
    expect(d1!.raw_input).toBe('第一条');

    const d2 = encoder.flush(); // 缓冲已空
    expect(d2).toBeNull();

    encoder.push('第二条');
    const d3 = encoder.flush();
    expect(d3).not.toBeNull();
    expect(d3!.seq_pos).toBe(2);
    expect(d3!.raw_input).toBe('第二条');
  });

  it('空缓冲时 flush 应返回 null', () => {
    const encoder2 = new DNAEncoder(TEST_SELF);
    expect(encoder2.flush()).toBeNull();
  });

  it('flush 后缓冲应清空', () => {
    encoder.push('测试');
    encoder.flush();
    expect(encoder.getBufferSize()).toBe(0);
  });
});

// ─── 语义边界自动 flush ───
// Ref: 架构决策备忘录 v1.3 — 话题切换、情感翻转、时间间隔
describe('DNAEncoder — 语义边界自动 flush', () => {
  let encoder: DNAEncoder;

  beforeEach(() => {
    encoder = new DNAEncoder(TEST_SELF);
  });

  it('话题切换应触发自动 flush', () => {
    // 第一条：家庭话题
    const r1 = encoder.push('妈妈又催我结婚了，烦死了');
    expect(r1).toBeNull();
    expect(encoder.getBufferSize()).toBe(1);

    // 第二条：完全不同的话题 → 触发自动 flush
    const r2 = encoder.push('今天天气不错，想去散步');
    expect(r2).not.toBeNull();           // 被 flush 出来的上一条 DNA
    expect(r2!.locus_path).toContain('family');
    expect(r2!.raw_input).toBe('妈妈又催我结婚了，烦死了');
    expect(encoder.getBufferSize()).toBe(1); // 新话题进入缓冲

    // flush 当前缓冲
    const r3 = encoder.flush();
    expect(r3).not.toBeNull();
    expect(r3!.raw_input).toBe('今天天气不错，想去散步');
  });

  it('同一话题内连续话语应合并为一条 DNA', () => {
    encoder.push('我妈又催婚了');
    encoder.push('她说我不小了');
    const dna = encoder.flush();
    expect(dna).not.toBeNull();
    expect(dna!.raw_input).toContain('我妈又催婚了');
    expect(dna!.raw_input).toContain('她说我不小了');
    expect(dna!.locus_path).toBe('user.family.conflict');
  });

  it('情感极性翻转应触发自动 flush', () => {
    encoder.push('今天真的好开心！');
    expect(encoder.getBufferSize()).toBe(1);

    // 强烈负面情感 → 极性翻转
    const auto = encoder.push('可是现在好难过');
    expect(auto).not.toBeNull();
    expect(auto!.locus_path).toContain('emotion.positive');
    expect(encoder.getBufferSize()).toBe(1); // 负面情感已缓冲
  });

  it('时间间隔超30分钟应触发自动 flush', () => {
    encoder.push({ utterance: '早上好', timestamp: '2026-06-02T08:00:00.000Z' });
    expect(encoder.getBufferSize()).toBe(1);

    const auto = encoder.push({
      utterance: '晚上好',
      timestamp: '2026-06-02T21:00:00.000Z',
    });
    expect(auto).not.toBeNull(); // 时间差13小时 → 自动 flush
    expect(auto!.raw_input).toBe('早上好');
  });
});

// ─── 上下文传递 ───
describe('DNAEncoder — 上下文传递', () => {
  it('context 应传递给 L3 用于 phenotype 判断', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('妈妈', ['我妈对我真好，我很感动']);
    const momEntity = dna.entity_genes.find((e) => e.name === '妈妈');
    if (momEntity) {
      expect(['enhance', 'neutral', 'conflict']).toContain(momEntity.phenotype);
    }
  });

  it('flush 时话题相同的话语应合并', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    // 两条都是工作压力相关，属于同一话题
    encoder.push({ utterance: '工作压力好大', context: ['连续加班'] });
    encoder.push({ utterance: '老板又给了新任务', context: ['有点撑不住'] });
    const dna = encoder.flush();
    expect(dna).not.toBeNull();
    expect(dna!.raw_input).toContain('工作压力好大');
    expect(dna!.raw_input).toContain('老板又给了新任务');
  });
});

// ─── 会话重置 ───
describe('DNAEncoder — 会话重置', () => {
  it('重置后 seq_pos 应从 1 重新开始', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    encoder.encodeBatch([
      { utterance: '第1条' },
      { utterance: '第2条' },
    ]);
    encoder.resetSession();

    const dna = encoder.encodeSingle('新会话');
    expect(dna.seq_pos).toBe(1);
  });

  it('重置后缓冲应清空', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    encoder.push('缓冲中');
    encoder.resetSession();
    expect(encoder.getBufferSize()).toBe(0);
    expect(encoder.flush()).toBeNull();
  });
});

// ─── 本体-标签分离原则验证 ───
// Ref: 架构纠偏指令 — emotion_color 移除后 DNA 仍可正常解析、排序、去重
describe('[本体-标签分离] emotion_color 不影响 DNA 核心标识', () => {
  it('删除 emotion_color 后 branch_id 和 seq_pos 仍正常', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('测试');

    // 模拟 M4/M5 阶段赋值 emotion_color
    (dna as any).emotion_color = '#E74C3C';

    // 核心标识不变
    expect(dna.branch_id).toMatch(/^evt_\d{8}_\d{3}$/);
    expect(typeof dna.seq_pos).toBe('number');

    // 删除 emotion_color → 核心标识不受影响
    delete (dna as any).emotion_color;
    expect(dna.branch_id).toMatch(/^evt_\d{8}_\d{3}$/);
    expect(typeof dna.seq_pos).toBe('number');
  });

  it('seq_pos 排序不依赖 emotion_color', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dnas = [
      encoder.encodeSingle('第一条'),
      encoder.encodeSingle('第二条'),
      encoder.encodeSingle('第三条'),
    ];

    // 无论 emotion_color 如何赋值，seq_pos 始终递增
    expect(dnas[1].seq_pos).toBe(dnas[0].seq_pos + 1);
    expect(dnas[2].seq_pos).toBe(dnas[1].seq_pos + 1);
  });

  it('M1 编码结果中 emotion_color 默认为 undefined', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('今天天气真好');
    // M1 不负责情感分析，emotion_color 应为 undefined
    expect(dna.emotion_color).toBeUndefined();
  });
});
