// Hook: 降级兜底测试 — 验证异常条件下的系统行为
// Ref: 开发执行协议 §2 — 降级兜底测试
//   - 故意注入故障/超时，验证模块是否正确触发降级策略而非崩溃

import { describe, it, expect } from 'vitest';
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { loadTaxonomy } from '../src/m1/L0Router.js';
import type { SelfModelV1 } from '../src/m1/types/dna.js';

const SELF: SelfModelV1 = {
  identity: { name: 'T', persona: 't', birth_date: '2026-01-01T00:00:00.000Z' },
  traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  boundaries: [],
  preferences: { likes: [], dislikes: [] },
  narrative_identity: 't',
};

describe('[FALLBACK] taxonomy.json缺失', () => {
  it('taxonomy文件缺失时应使用内存默认树，不崩溃', () => {
    const taxonomy = loadTaxonomy('/tmp/nonexistent_taxonomy.json');
    expect(taxonomy).toBeDefined();
    expect(taxonomy.version).toBe('0.0-fallback');
    expect(taxonomy.tree.user.misc).toBeDefined();
  });

  it('taxonomy损坏时应使用内存默认树，不崩溃', () => {
    const taxonomy = loadTaxonomy('/tmp');
    expect(taxonomy).toBeDefined();
  });
});

describe('[FALLBACK] 空输入', () => {
  it('空字符串输入不应崩溃，应路由到misc.default', () => {
    const encoder = new DNAEncoder(SELF);
    const dna = encoder.encodeSingle('');
    expect(dna.locus_path).toBe('user.misc.default');
    expect(dna.entity_genes).toEqual([]);
    // DNA结构仍然完整
    expect(dna.branch_id).toBeTruthy();
    expect(dna.created_at).toBeTruthy();
  });

  it('flush空缓冲应返回null，不崩溃', () => {
    const encoder = new DNAEncoder(SELF);
    expect(encoder.flush()).toBeNull();
  });
});

describe('[FALLBACK] 未知话题', () => {
  it('与任何规则都不匹配的话题应路由到misc兜底', () => {
    const encoder = new DNAEncoder(SELF);
    const dna = encoder.encodeSingle('这台新设备的量子纠缠效率提升了30%');
    expect(dna.locus_path).toBe('user.misc.default');
  });
});

describe('[FALLBACK] 边界输入', () => {
  it('超长输入不应崩溃', () => {
    const encoder = new DNAEncoder(SELF);
    const longText = '测试'.repeat(10000);
    const dna = encoder.encodeSingle(longText);
    expect(dna.locus_path).toBeTruthy();
    expect(dna.branch_id).toBeTruthy();
  });

  it('极端情绪词汇不应崩溃', () => {
    const encoder = new DNAEncoder(SELF);
    const extremeInputs = ['%^&*()', '😡😭😤🔥', '!' .repeat(1000)];
    for (const text of extremeInputs) {
      const dna = encoder.encodeSingle(text);
      expect(dna).toBeDefined();
    }
  });

  it('连续极端输入经 push/flush 不应崩溃', () => {
    const encoder = new DNAEncoder(SELF);
    encoder.push('%^&*()');
    encoder.push('😡😭😤🔥');
    const dna = encoder.flush();
    expect(dna).not.toBeNull();
  });
});

describe('[FALLBACK] 实体提取', () => {
  it('不包含任何已知实体的文本不崩溃', () => {
    const encoder = new DNAEncoder(SELF);
    const dna = encoder.encodeSingle('这台机器的涡轮增压器需要校准');
    expect(dna.entity_genes).toBeDefined();
  });

  it('生僻字符组合不应阻塞编码', () => {
    const encoder = new DNAEncoder(SELF);
    const dna = encoder.encodeSingle('a'.repeat(100) + '1'.repeat(100) + ' '.repeat(50));
    expect(dna).toBeDefined();
  });
});
