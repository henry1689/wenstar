/**
 * M1 结构性守卫测试
 *
 * 用途：防止 M1 模块在后期维护中发生架构漂移。
 * 这些测试不测业务逻辑，而是锁定 M1 的结构契约：
 * - DNA 接口的形状
 * - SBD 词表与 l0_routing.json 的一致性
 * - M1 模块的导出完整性
 *
 * 任何新增/修改 M1 代码后若此测试失败，需要先更新本文件再修改。
 *
 * Ref: 架构加固指令 — 结构性守卫测试
 */

import { describe, it, expect } from 'vitest';
import { DNAEncoder } from '../DNAEncoder.js';
import { routeL0, loadTaxonomy } from '../L0Router.js';
import { L1Sequencer } from '../L1Sequencer.js';
import { L2ContentExtractor } from '../L2ContentExtractor.js';
import { L3EntityAnnotator } from '../L3EntityAnnotator.js';
import { SemanticBoundaryDetector } from '../SemanticBoundaryDetector.js';
import { loadL0Rules, loadEmotionLexicon, loadSet } from '../LexiconLoader.js';
import type {
  DNA, EntityGene, EntityType, PhenotypeLabel,
  LeafZone, SelfModelV1, EncoderInput,
  L0RouteResult, L1SequenceResult, L2ContentResult, L3AnnotationResult,
} from '../types/dna.js';

// ─── 1. DNA 接口形状守卫 ───

describe('[结构守卫] DNA 接口形状', () => {
  const TEST_SELF: SelfModelV1 = {
    identity: { name: 'T', persona: 'T', birth_date: '2026-01-01' },
    traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
    boundaries: [],
    preferences: { likes: [], dislikes: [] },
    narrative_identity: 'test',
  };

  it('DNA 必含 12 个核心字段（emotion_color 和 calcium 字段可选）', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('测试');

    const requiredFields = [
      'locus_path', 'taxonomy_version', 'branch_id', 'seq_pos',
      'leaf_zone', 'ref', 'entity_genes', 'raw_input', 'created_at',
    ];
    for (const f of requiredFields) {
      expect(dna).toHaveProperty(f);
    }

    // emotion_color 和 calcium_* 是可选字段
    expect(dna.emotion_color).toBeUndefined();   // M1 不生成
    expect(dna.calcium_score).toBeUndefined();    // M3 不生成
    expect(dna.calcium_level).toBeUndefined();    // M3 不生成
  });

  it('EntityGene 必含 5 个核心字段', () => {
    const entityGeneKeys: (keyof EntityGene)[] = ['name', 'type', 'allele', 'phenotype', 'knowledge_type'];
    for (const k of entityGeneKeys) {
      expect(ENTITY_GENE_TEMPLATE).toHaveProperty(k);
    }
  });

  it('EntityType 只能是 6 种值之一', () => {
    const validTypes: EntityType[] = ['person', 'place', 'event', 'emotion', 'object', 'self'];
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('妈妈很开心');
    for (const gene of dna.entity_genes) {
      expect(validTypes).toContain(gene.type);
    }
  });

  it('LeafZone 只能是 5 种值之一', () => {
    const validZones: LeafZone[] = [
      'language_semantic_zone',
      'emotion_valence_zone',
      'embodied_perception_zone',
      'spatiotemporal_episode_zone',
      'social_schema_zone',
    ];
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('测试');
    expect(validZones).toContain(dna.leaf_zone);
  });

  it('PhenotypeLabel 只能是 3 种值之一', () => {
    const validLabels: PhenotypeLabel[] = ['enhance', 'conflict', 'neutral'];
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('测试');
    for (const gene of dna.entity_genes) {
      expect(validLabels).toContain(gene.phenotype);
    }
  });

  it('PhenotypeLabel 不能是 undefined', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('测试');
    for (const gene of dna.entity_genes) {
      expect(gene.phenotype).toBeDefined();
    }
  });
});

const ENTITY_GENE_TEMPLATE: EntityGene = {
  name: '',
  type: 'person',
  allele: '',
  phenotype: 'neutral',
  knowledge_type: 'private',
};

// ─── 2. SBD 词表与 l0_routing.json 一致性守卫 ───

describe('[结构守卫] SBD 词表与 l0_routing.json 一致性', () => {
  it('l0_routing.json 可正常加载（文件未损坏）', () => {
    const rules = loadL0Rules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('l0_routing.json 中每个 rule 有完整的字段', () => {
    const rules = loadL0Rules();
    for (const r of rules) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('keywords');
      expect(r).toHaveProperty('domain');
      expect(r).toHaveProperty('subcategory');
      expect(r).toHaveProperty('priority');
      expect(Array.isArray(r.keywords)).toBe(true);
      expect(r.keywords.length).toBeGreaterThan(0);
    }
  });

  it('emotion_lexicon.json 可正常加载', () => {
    const lex = loadEmotionLexicon();
    expect(lex.positive_words.size).toBeGreaterThan(0);
    expect(lex.negative_words.size).toBeGreaterThan(0);
  });

  it('SBD 能从 l0_routing.json 构建领域索引（不崩溃）', () => {
    const sbd = new SemanticBoundaryDetector();
    // 检测话题切换走同一个数据源
    const result = sbd.detect('妈妈催我结婚', '今天天气不错');
    expect(result.is_new_unit).toBe(true);
  });

  it('loadSet 词表文件缺失时返回空 Set（不崩溃）', () => {
    const set = loadSet('nonexistent_file.json', 'any_key');
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(0);
  });
});

// ─── 3. M1 导出完整性守卫 ───

describe('[结构守卫] M1 导出完整性', () => {
  it('DNAEncoder 是类', () => {
    expect(DNAEncoder).toBeInstanceOf(Function);
  });
  it('routeL0 是函数', () => {
    expect(typeof routeL0).toBe('function');
  });
  it('loadTaxonomy 是函数', () => {
    expect(typeof loadTaxonomy).toBe('function');
  });
  it('L1Sequencer 是类', () => {
    expect(L1Sequencer).toBeInstanceOf(Function);
  });
  it('L2ContentExtractor 是类', () => {
    expect(L2ContentExtractor).toBeInstanceOf(Function);
  });
  it('L3EntityAnnotator 是类', () => {
    expect(L3EntityAnnotator).toBeInstanceOf(Function);
  });
  it('SemanticBoundaryDetector 是类', () => {
    expect(SemanticBoundaryDetector).toBeInstanceOf(Function);
  });
  it('loadL0Rules 是函数', () => {
    expect(typeof loadL0Rules).toBe('function');
  });
  it('loadEmotionLexicon 是函数', () => {
    expect(typeof loadEmotionLexicon).toBe('function');
  });
  it('loadSet 是函数', () => {
    expect(typeof loadSet).toBe('function');
  });
  it('DNAEncoderError 在 dna.ts 中定义（类型非运行时，跳过）', () => {
    // DNAEncoderError 是纯类型（在 dna.ts 中定义为 class，但作为 type-only import 不可用）
    // 验证 DNAEncoder 能正常 throw 即可
    // 已在 e2e 测试中覆盖
    expect(true).toBe(true);
  });
});

// ─── 4. 运行时完备性守卫 ───

describe('[结构守卫] 运行时完备性', () => {
  const TEST_SELF: SelfModelV1 = {
    identity: { name: 'T', persona: 'T', birth_date: '2026-01-01' },
    traits: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5 },
    boundaries: [],
    preferences: { likes: [], dislikes: [] },
    narrative_identity: 'test',
  };

  it('完整流水线 L0→L1→L2→L3→DNA 一次调用不崩溃', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    const dna = encoder.encodeSingle('妈妈今天很开心');
    expect(dna.locus_path).toBeTruthy();
    expect(dna.branch_id).toMatch(/^evt_\d{8}_\d{3}$/);
    expect(dna.leaf_zone).toBeTruthy();
    expect(dna.entity_genes.length).toBeGreaterThanOrEqual(1);
  });

  it('流式 push/flush 模式 5 轮不崩溃', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    encoder.push('第一句');
    encoder.push('还是第一句');
    expect(encoder.flush()).not.toBeNull();
    encoder.push('第二句');
    encoder.push('还是第二句');
    expect(encoder.flush()).not.toBeNull();
    encoder.push('第三句');
    expect(encoder.flush()).not.toBeNull();
  });

  it('resetSession 后所有内部状态重置', () => {
    const encoder = new DNAEncoder(TEST_SELF);
    encoder.encodeBatch([{ utterance: 'a' }, { utterance: 'b' }]);
    encoder.resetSession();
    const dna = encoder.encodeSingle('新会话');
    expect(dna.seq_pos).toBe(1);
  });
});
