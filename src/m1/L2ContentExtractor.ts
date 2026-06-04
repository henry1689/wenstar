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
  private mapZone(locusPath: string): LeafZone {
    if (locusPath.startsWith('user.emotion')) {
      return 'emotion_valence_zone';
    }
    if (locusPath.startsWith('user.family') || locusPath.startsWith('user.work')) {
      return 'language_semantic_zone';
    }
    // 默认使用语言语义区
    return 'language_semantic_zone';
  }

  /**
   * 提取内容元数据
   * @param locusPath L0路由结果
   * @param rawInput 原始用户输入
   * @returns L2内容提取结果
   */
  extract(locusPath: string, rawInput: string): L2ContentResult {
    this.refCounter++;
    const leafZone = this.mapZone(locusPath);

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
