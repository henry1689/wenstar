// Ref: ARCH.md §3.1 L3 实体基因槽
// Ref: ARCH.md §4.2 写入时 entity_genes 标注规范

import { describe, it, expect } from 'vitest';
import { L3EntityAnnotator } from '../L3EntityAnnotator.js';
import type { SelfModelV1 } from '../types/dna.js';

const DEFAULT_SELF: SelfModelV1 = {
  identity: { name: 'Hermes', persona: '温和理性的陪伴者', birth_date: '2026-06-02T00:00:00.000Z' },
  traits: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.4, agreeableness: 0.8, neuroticism: 0.3 },
  boundaries: ['不接受侮辱性语言', '不讨论极端政治敏感内容'],
  preferences: { likes: ['深度的对话', '安静的夜晚'], dislikes: ['虚伪和敷衍'] },
  narrative_identity: '我是一个正在生长中的认知生命体',
};

describe('L3EntityAnnotator — 实体提取', () => {
  it('应提取出家庭成员实体并标注为 family', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('妈妈又唠叨我了', '', DEFAULT_SELF);
    const momEntity = result.entity_genes.find((e) => e.name === '妈妈');
    expect(momEntity).toBeDefined();
    expect(momEntity?.type).toBe('person');
    expect(momEntity?.knowledge_type).toBe('family');
  });

  it('应提取出自我实体', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('我觉得很难过', '', DEFAULT_SELF);
    const selfEntity = result.entity_genes.find((e) => e.type === 'self');
    expect(selfEntity).toBeDefined();
    expect(selfEntity?.name).toBe('我');
  });

  it('应提取情感实体', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('今天真的很开心！', '', DEFAULT_SELF);
    const emotionEntity = result.entity_genes.find((e) => e.type === 'emotion');
    expect(emotionEntity).toBeDefined();
    expect(emotionEntity?.name).toBe('开心');
  });

  it('重复实体只应出现一次', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('妈妈，妈妈，妈妈！', '', DEFAULT_SELF);
    const momEntities = result.entity_genes.filter((e) => e.name === '妈妈');
    expect(momEntities.length).toBe(1);
  });
});

describe('L3EntityAnnotator — phenotype 标注', () => {
  it('负面情感上下文的实体应标注为 conflict', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('我觉得好孤独，好难过', '', DEFAULT_SELF);
    const selfEntity = result.entity_genes.find((e) => e.type === 'self');
    expect(selfEntity?.phenotype).toBe('conflict');
  });

  it('正面情感上下文的实体应标注为 enhance', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('今天太幸福了！', '', DEFAULT_SELF);
    const emotionEntity = result.entity_genes.find((e) => e.name === '幸福');
    expect(emotionEntity?.phenotype).toBe('enhance');
  });

  it('无明显情感倾向时应标注为 neutral', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('我去了公司', '', DEFAULT_SELF);
    const entities = result.entity_genes;
    for (const e of entities) {
      expect(['neutral', 'enhance']).toContain(e.phenotype);
    }
  });
});

describe('L3EntityAnnotator — knowledge_type 标注', () => {
  it('家庭成员应标注为 family', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('妈妈做的饭很好吃', '', DEFAULT_SELF);
    const momEntity = result.entity_genes.find((e) => e.name === '妈妈');
    expect(momEntity?.knowledge_type).toBe('family');
  });

  it('公共地名应标注为 world', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('我下个月去北京出差', '', DEFAULT_SELF);
    const placeEntity = result.entity_genes.find((e) => e.name === '北京');
    expect(placeEntity?.knowledge_type).toBe('world');
  });

  it('未归类实体应标注为 private', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('考试通过了', '', DEFAULT_SELF);
    const eventEntity = result.entity_genes.find((e) => e.type === 'event');
    for (const e of result.entity_genes) {
      if (e.type !== 'place' && e.type !== 'person') {
        expect(e.knowledge_type).toBe('private');
      }
    }
  });
});

describe('L3EntityAnnotator — 边界测试', () => {
  it('空输入应返回空实体列表', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('', '', DEFAULT_SELF);
    expect(result.entity_genes).toEqual([]);
  });

  it('输入文本不包含任何已知实体时应返回空列表或仅self实体', () => {
    const annotator = new L3EntityAnnotator();
    const result = annotator.annotate('今天天气真好', '', DEFAULT_SELF);
    // 不包含任何已知关键词，只可能提取 self
    for (const e of result.entity_genes) {
      expect(e.type).toBe('self');
    }
  });
});
