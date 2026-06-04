// Ref: ARCH.md §3.2 写入正向流 — 确定性断言
// Ref: 架构决策备忘录 v1.1 — 相同输入必须产生完全相同 locus_path

import { describe, it, expect } from 'vitest';
import { routeL0, loadTaxonomy } from '../L0Router.js';
import type { TaxonomyTree } from '../types/dna.js';

// 共享的测试用分类树（避免依赖文件系统）
const TEST_TAXONOMY: TaxonomyTree = {
  version: '1.0-test',
  description: '测试用分类树',
  tree: {
    user: {
      family: ['general', 'conflict', 'care'],
      emotion: ['positive', 'negative', 'neutral'],
      work: ['general', 'stress', 'achievement'],
      misc: ['default'],
    },
  },
};

describe('L0Router — 确定性', () => {
  it('相同输入100次应返回完全相同的结果', () => {
    const input = '今天工作压力好大，加班到很晚';
    const results = Array.from({ length: 100 }, () => routeL0(input, TEST_TAXONOMY));

    const first = results[0];
    for (const r of results) {
      expect(r.locus_path).toBe(first.locus_path);
      expect(r.rule_id).toBe(first.rule_id);
      expect(r.taxonomy_version).toBe(first.taxonomy_version);
      expect(r.is_fallback).toBe(first.is_fallback);
    }
  });

  it('空字符串输入应始终返回 misc.default', () => {
    const r1 = routeL0('', TEST_TAXONOMY);
    const r2 = routeL0('   ', TEST_TAXONOMY);
    expect(r1.locus_path).toBe('user.misc.default');
    expect(r1.is_fallback).toBe(true);
    expect(r2.locus_path).toBe('user.misc.default');
  });
});

describe('L0Router — 家庭话题路由', () => {
  it('冲突型家庭话题应路由到 family.conflict', () => {
    const result = routeL0('我妈又催我结婚了，烦死了', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.family.conflict');
    expect(result.is_fallback).toBe(false);
  });

  it('关爱型家庭话题应路由到 family.care', () => {
    const result = routeL0('想家了，想回去看看妈妈', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.family.care');
  });

  it('中性家庭话题应路由到 family.general', () => {
    const result = routeL0('我们家人周末聚会', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.family.general');
  });
});

describe('L0Router — 工作话题路由', () => {
  it('压力型工作话题应路由到 work.stress', () => {
    const result = routeL0('最近加班太多，压力真的很大', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.work.stress');
  });

  it('成就型工作话题应路由到 work.achievement', () => {
    const result = routeL0('我通过面试了！拿到了offer！', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.work.achievement');
  });

  it('中性工作话题应路由到 work.general', () => {
    const result = routeL0('今天在公司开了个会', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.work.general');
  });
});

describe('L0Router — 情绪话题路由', () => {
  it('强烈负面情绪应路由到 emotion.negative', () => {
    const result = routeL0('我觉得好难过，好孤独', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.emotion.negative');
  });

  it('强烈正面情绪应路由到 emotion.positive', () => {
    const result = routeL0('今天真的很开心！太幸福了！', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.emotion.positive');
  });
});

describe('L0Router — 兜底逻辑', () => {
  it('与任何规则都不匹配的话题应路由到 misc.default', () => {
    const result = routeL0('今天天气真好，适合出去走走', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.misc.default');
    expect(result.is_fallback).toBe(true);
    expect(result.rule_id).toBe('misc-default-fallback');
  });

  it('不存在的 domain 应降级到 misc.default', () => {
    // 创建一个没有 family 节点的树来测试 validatePath 的降级
    const brokenTree: TaxonomyTree = {
      version: '1.0-test',
      tree: { user: { emotion: ['positive'], misc: ['default'] } },
    };
    // 输入包含family关键词但分类树里没有family
    const result = routeL0('想家了，想回去看看妈妈', brokenTree);
    // 根据当前的规则路由逻辑，它还是会在家族相关规则中匹配
    // 但由于broken tree里没有family，validatePath会降级
    expect(result.locus_path).toBe('user.misc.default');
  });
});

describe('L0Router — 优先级', () => {
  it('冲突关键词优先级应高于同domain的general关键词', () => {
    const result = routeL0('家里又在吵架，烦死了', TEST_TAXONOMY);
    // "吵架" + "烦死了" 应匹配 family-conflict，优先级高于 family-general
    expect(result.locus_path).toBe('user.family.conflict');
  });

  it('优先级越高（数字越小）越优先', () => {
    // "加班" (work-stress, priority 1) vs "工作" (work-general, priority 4)
    const result = routeL0('今天加班好累', TEST_TAXONOMY);
    expect(result.locus_path).toBe('user.work.stress');
  });
});

describe('loadTaxonomy — 加载逻辑', () => {
  it('文件缺失时应使用内存默认树，不崩溃', () => {
    const taxonomy = loadTaxonomy('/nonexistent/path/taxonomy.json');
    expect(taxonomy.version).toBe('0.0-fallback');
    expect(taxonomy.tree.user.misc).toBeDefined();
  });
});
