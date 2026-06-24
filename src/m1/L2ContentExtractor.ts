// Ref: ARCH.md §3.1 L2 叶节点指针 — leaf_zone + ref
// Ref: ARCH.md §2.2 五大语义功能区

import type { L2ContentResult, LeafZone } from './types/dna.js';

/**
 * L2 内容提取器
 *
 * 根据 L0 路由结果的话题类型，映射到目标语义区（leaf_zone）。
 * 生成一个临时引用ID（ref），M2 持久化时会被替换为真实物理地址。
 *
 * 映射规则：
 * - family / work 话题 → 语言语义区（对话原文）
 * - emotion 话题 → 情感效价区（情感数据）
 * - misc → 语言语义区（默认）
 *
 * Ref: ARCH.md §2.2 五大语义功能区规范
 */
export class L2ContentExtractor {
  private refCounter = 0;

  /**
   * 根据 locus_path 映射到 LeafZone
   * Ref: ARCH.md §2.2 表：五大语义功能区
   */
  private mapZone(locusPath: string, entityTypes?: string[], rawInput?: string): LeafZone {
    // ① 优先按 locus_path 路由（与原始行为一致）
    if (locusPath.startsWith('user.emotion')) {
      return 'emotion_valence_zone';
    }
    if (locusPath.startsWith('user.family')) {
      return 'social_schema_zone';
    }
    if (locusPath.startsWith('user.work')) {
      return 'language_semantic_zone';
    }
    // ② 按实体类型辅助判定（扩展至 5 区 — 白皮书 §2.2）
    if (entityTypes && entityTypes.length > 0 && rawInput) {
      const typeSet = new Set(entityTypes);
      // 具身感知区：身体感受/生理信号
      if (typeSet.has('emotion') && /身体|皮肤|体温|心跳|呼吸|肌肉|神经|疼|痛|麻|痒|酸|胀|累|汗|眼泪|发抖|颤抖/.test(rawInput)) {
        return 'embodied_perception_zone';
      }
      // 社会图式区：人物关系/社会角色
      if (typeSet.has('person') && !typeSet.has('self') && /关系|朋友|同事|家人|社会|角色|身份|职责|尊重|信任|合作/.test(rawInput)) {
        return 'social_schema_zone';
      }
      // 时空情景区：时间/地点/事件
      if (typeSet.has('event') || typeSet.has('place')) {
        const hasTimePlace = /今天|昨天|明天|时候|期间|地点|地方|位置|附近|那里|这里|事件|发生|经过|当时/.test(rawInput);
        const hasEntityRef = entityTypes.filter(t => t === 'event' || t === 'place').length >= 1;
        if (hasTimePlace || hasEntityRef) {
          return 'spatiotemporal_episode_zone';
        }
      }
    }
    // ③ 默认使用语言语义区
    return 'language_semantic_zone';
  }

  /**
   * 提取内容元数据
   * @param locusPath L0路由结果
   * @param rawInput 原始用户输入
   * @returns L2内容提取结果
   */
  extract(locusPath: string, rawInput: string, entityTypes?: string[]): L2ContentResult {
    // P1: 输入守卫
    if (!rawInput) {
      return { leaf_zone: 'language_semantic_zone', ref: 'tmp_empty' };
    }
    this.refCounter++;
    const leafZone = this.mapZone(locusPath, entityTypes, rawInput);

    // 生成临时引用ID
    // 格式：tmp_<zone缩写>_<序列号>
    const zonePrefix = leafZone === 'emotion_valence_zone' ? 'emo'
      : leafZone === 'language_semantic_zone' ? 'lang'
      : leafZone === 'embodied_perception_zone' ? 'body'
      : leafZone === 'spatiotemporal_episode_zone' ? 'space'
      : 'soc';

    const ref = `tmp_${zonePrefix}_${String(this.refCounter).padStart(5, '0')}`;

    return {
      leaf_zone: leafZone,
      ref,
    };
  }

  /**
   * 重置计数器（用于测试）
   */
  reset(): void {
    this.refCounter = 0;
  }
}
