// Ref: ARCH.md §2.2 五大语义功能区映射规范

import { describe, it, expect } from 'vitest';
import { L2ContentExtractor } from '../L2ContentExtractor.js';

describe('L2ContentExtractor — zone 映射', () => {
  it('emotion 话题应映射到 emotion_valence_zone', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.emotion.negative', '我好难过');
    expect(result.leaf_zone).toBe('emotion_valence_zone');
  });

  it('family 话题应映射到 language_semantic_zone', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.family.conflict', '家里吵架');
    expect(result.leaf_zone).toBe('language_semantic_zone');
  });

  it('work 话题应映射到语言语义区', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.work.stress', '加班好累');
    expect(result.leaf_zone).toBe('language_semantic_zone');
  });

  it('misc 话题应默认映射到语言语义区', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.misc.default', '今天天气真好');
    expect(result.leaf_zone).toBe('language_semantic_zone');
  });
});

describe('L2ContentExtractor — ref 格式', () => {
  it('ref 应以 tmp_ 开头', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.family.general', '测试');
    expect(result.ref).toMatch(/^tmp_/);
  });

  it('连续调用应生成递增的 ref 序列', () => {
    const extractor = new L2ContentExtractor();
    const r1 = extractor.extract('user.misc.default', 'a');
    const r2 = extractor.extract('user.misc.default', 'b');
    expect(r1.ref).toContain('00001');
    expect(r2.ref).toContain('00002');
  });

  it('emotion zone 的 ref 应包含 emo 缩写', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.emotion.positive', '开心');
    expect(result.ref).toContain('emo');
  });

  it('重置后 ref 应从 1 重新开始', () => {
    const extractor = new L2ContentExtractor();
    extractor.extract('user.misc.default', 'a');
    extractor.reset();
    const result = extractor.extract('user.misc.default', 'b');
    expect(result.ref).toContain('00001');
  });
});


// ─── 新增：5 区异构映射测试（白皮书 §2.2）───

describe('L2ContentExtractor — 5区扩展映射', () => {
  it('身体感受+emotion类型 → embodied_perception_zone', () => {
    const extractor = new L2ContentExtractor();
    // 使用 daily 话题（不触发原2区规则），emotion 类型+身体词 → 命中具身区
    const result = extractor.extract('user.daily.health', '心跳加速，呼吸急促', ['emotion']);
    expect(result.leaf_zone).toBe('embodied_perception_zone');
  });

  it('人物+社会关系 → social_schema_zone', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.misc.default', '我和同事的关系很好', ['person']);
    expect(result.leaf_zone).toBe('social_schema_zone');
  });

  it('事件/地点 → spatiotemporal_episode_zone', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.misc.default', '昨天在公园发生了那件事', ['event', 'place']);
    expect(result.leaf_zone).toBe('spatiotemporal_episode_zone');
  });

  it('不传 entityTypes 时保持原行为（不进入5区判定）', () => {
    const extractor = new L2ContentExtractor();
    const result = extractor.extract('user.misc.default', '心跳加速，呼吸急促');
    expect(result.leaf_zone).toBe('language_semantic_zone');
  });

  it('zone 缩写对应正确（body/space/soc）', () => {
    const extractor = new L2ContentExtractor();
    const r1 = extractor.extract('user.daily.health', '全身酸痛', ['emotion']);
    expect(r1.ref).toContain('body');
    const r2 = extractor.extract('user.misc.default', '昨天在公园', ['event', 'place']);
    expect(r2.ref).toContain('space');
    const r3 = extractor.extract('user.misc.default', '我的领导很信任我', ['person']);
    expect(r3.ref).toContain('soc');
  });
});
