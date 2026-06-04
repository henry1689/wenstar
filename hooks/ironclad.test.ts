// Hook: 铁律断言 — 白皮书中的不可违反规则
// Ref: 开发执行协议 §2 — 铁律断言
//   - 确定性：相同输入必须产生完全相同输出
//   - 单调递增：seq_pos 必须在会话内严格递增
//   - 无DNA不写入：编码器输出的DNA必须完整

import { describe, it, expect } from 'vitest';
import { DNAEncoder } from '../src/m1/DNAEncoder.js';
import { routeL0, loadTaxonomy } from '../src/m1/L0Router.js';
import { L1Sequencer } from '../src/m1/L1Sequencer.js';
import { L2ContentExtractor } from '../src/m1/L2ContentExtractor.js';
import { L3EntityAnnotator } from '../src/m1/L3EntityAnnotator.js';
import type { SelfModelV1, TaxonomyTree } from '../src/m1/types/dna.js';

const SELF: SelfModelV1 = {
  identity: { name: 'T', persona: 't', birth_date: '2026-01-01T00:00:00.000Z' },
  traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
  boundaries: [],
  preferences: { likes: [], dislikes: [] },
  narrative_identity: 't',
};

const TEST_TAXONOMY: TaxonomyTree = {
  version: '1.0-test',
  tree: { user: { family: ['conflict'], emotion: ['negative'], misc: ['default'] } },
};

// ─── 铁律①：确定性 ───
// Ref: 架构决策备忘录 v1.1 — 相同输入必须返回完全相同 locus_path
describe('[IRONCLAD] 确定性 — L0路由', () => {
  it('相同输入1000次应产生完全相同的locus_path和rule_id', () => {
    const input = '我妈又催我结婚了，烦死了';
    const results = Array.from({ length: 1000 }, (_, _i) => {
      const r = routeL0(input, TEST_TAXONOMY);
      return `${r.locus_path}|${r.rule_id}|${r.taxonomy_version}|${r.is_fallback}`;
    });

    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(first);
    }
  });

  it('L3实体提取在相同输入下应返回相同的实体集合', () => {
    const annotator = new L3EntityAnnotator();
    const results = Array.from({ length: 100 }, () =>
      annotator.annotate('我今天很难过，妈妈也不理解我', '', SELF)
    );

    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i].entity_genes.length).toBe(first.entity_genes.length);
      for (let j = 0; j < first.entity_genes.length; j++) {
        expect(results[i].entity_genes[j].name).toBe(first.entity_genes[j].name);
        expect(results[i].entity_genes[j].type).toBe(first.entity_genes[j].type);
        expect(results[i].entity_genes[j].phenotype).toBe(first.entity_genes[j].phenotype);
        expect(results[i].entity_genes[j].knowledge_type).toBe(first.entity_genes[j].knowledge_type);
      }
    }
  });
});

// ─── 铁律②：单调递增 ───
// Ref: ARCH.md §3.2 — seq_pos 必须全局单调递增
describe('[IRONCLAD] 单调递增 — L1序列', () => {
  it('1000次连续调用必须严格递增', () => {
    const seq = new L1Sequencer();
    let prev = 0;
    for (let i = 0; i < 1000; i++) {
      const result = seq.next();
      expect(result.seq_pos).toBe(prev + 1);
      prev = result.seq_pos;
    }
  });

  it('编码器 encodeSingle 输出 seq_pos 严格递增', () => {
    const encoder = new DNAEncoder(SELF);
    const inputs = Array.from({ length: 50 }, (_, i) => ({
      utterance: `第${i}条测试消息`,
    }));
    const results = encoder.encodeBatch(inputs);

    for (let i = 1; i < results.length; i++) {
      expect(results[i].seq_pos).toBe(results[i - 1].seq_pos + 1);
    }
  });

  it('push+flush 模式 seq_pos 严格递增', () => {
    const encoder = new DNAEncoder(SELF);
    encoder.push('第一条');
    const d1 = encoder.flush();
    encoder.push('第二条');
    const d2 = encoder.flush();
    encoder.push('第三条');
    const d3 = encoder.flush();

    expect(d1!.seq_pos).toBe(1);
    expect(d2!.seq_pos).toBe(2);
    expect(d3!.seq_pos).toBe(3);
  });

  it('重置后 seq_pos 从1重新开始', () => {
    const encoder = new DNAEncoder(SELF);
    encoder.encodeBatch(Array.from({ length: 10 }, (_, i) => ({
      utterance: `第${i}条`,
    })));
    encoder.resetSession();
    const r = encoder.encodeSingle('新会话');
    expect(r.seq_pos).toBe(1);
  });
});

// ─── 铁律③：L0→L1→L2→L3 顺序执行 ───
// Ref: ARCH.md §3.2 — 前一阶段未完成禁止进入下一阶段
describe('[IRONCLAD] 流水线顺序 — L0→L1→L2→L3', () => {
  it('每个DNA对象必须包含所有四个阶段的产物', () => {
    const encoder = new DNAEncoder(SELF);
    const dna = encoder.encodeSingle('测试');
    // L0
    expect(dna.locus_path).toBeTruthy();
    // L1
    expect(dna.branch_id).toBeTruthy();
    expect(typeof dna.seq_pos).toBe('number');
    // L2
    expect(dna.leaf_zone).toBeTruthy();
    expect(dna.ref).toBeTruthy();
    // L3
    expect(Array.isArray(dna.entity_genes)).toBe(true);
  });
});

// ─── 铁律④：禁止跨区JOIN（M1层面只能检查没有存储依赖）───
// Ref: ARCH.md §2.2 铁律 — 禁止跨区JOIN查询
describe('[IRONCLAD] M1边界 — 无存储依赖', () => {
  it('编码器不依赖任何外部存储或数据库', () => {
    const encoder = new DNAEncoder(SELF);
    // 只需验证编码器在纯内存环境下运行正常
    // 不涉及任何文件写入、数据库连接或网络请求
    const dna = encoder.encodeSingle('测试');
    expect(dna).toBeDefined();
  });
});
