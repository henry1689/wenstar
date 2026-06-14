/**
 * FusionEngine — 三源熔铸器
 *
 * 白皮书 §1.2 锚点5 要求的三源融合的意义熔铸：
 * "私人记忆 × 家族知识 × 世界知识在表达时被熔铸为有血有肉的个体化叙事"
 *
 * 当前 chat.ts 中将三源拼接为字符串的做法是"三源拼接"而非"三源熔铸"。
 * 本引擎在不修改任何现有代码路径的前提下，在最终组合 knowledgeBaseText
 * 之前增加一道"感知驱动的动态权重"工序：
 *
 *   ① 根据 M3 感知维度决定三类知识的优先级和表达方式
 *   ② 情绪低落时 → 优先温暖记忆，压缩知识条目
 *   ③ 亲密度高时 → 优先私人回忆，关闭百科条目
 *   ④ 认知/事实性强时 → 优先知识库
 *   ⑤ 中性状态 → 保持原有拼接行为（零改动）
 *
 * 使用方式:
 *   import { fuseSources } from '../app/fusion/FusionEngine.js';
 *   knowledgeBaseText = fuseSources({
 *     perception, knowledgeBaseText, memorySummary, familyContext
 *   });
 *
 * Ref: docs/project-spec-v1.md §1.2 锚点5
 * Ref: 战略性改善建议 — 三源熔铸器
 */

import type { Perception24D } from '../../m3/types/perception.js';
import type { MemorySummary } from '../../m4/types/index.js';

/** 熔铸器输入 */
export interface FusionInput {
  /** M3 24D 感知向量（用于决策三类知识的优先级） */
  perception: Perception24D;
  /** 当前已拼接的 knowledgeBaseText（含关键词搜索+实体重叠+VAD谱曲） */
  knowledgeBaseText: string;
  /** M4 记忆摘要（时间线上的私人记忆） */
  memorySummary: MemorySummary;
  /** M4 家族上下文（可选） */
  familyContext?: Array<{ entity: string; relation: string; related_entity: string }>;
}

/** 熔铸结果 */
export interface FusionResult {
  /** 熔铸后的 knowledgeBaseText（兼容原接口，直接替换原值） */
  fusedText: string;
  /** 熔铸决策说明（供调试面板） */
  decision: string;
}

/**
 * 熔铸三类知识源——感知驱动的动态权重。
 *
 * 策略矩阵（非破坏性——neutral 时保持原行为）:
 *
 * | 感知特征 | 记忆权重 | 知识权重 | 家族权重 | 行为 |
 * |:---------|:---------|:---------|:---------|:-----|
 * | intimacy > 0.4 | ↑↑ | ↓ | ↑ | 优先私人回忆 |
 * | pleasure < -0.2 | ↑ | ↓↓ | ↑ | 优先温暖/安慰 |
 * | factual > 0.5 | ↓ | ↑↑ | — | 优先知识库 |
 * | 中性（默认） | — | — | — | 原样传递（不熔铸） |
 */
export function fuseSources(input: FusionInput): FusionResult {
  const { perception, knowledgeBaseText, memorySummary, familyContext } = input;
  const p = perception;

  // ── 策略判定（多条可同时激活，优先级: intimacy > negative > factual > neutral） ──

  const isIntimate = p.intimacy > 0.4;
  const isDistressed = p.pleasure < -0.2;
  const isFactual = p.factual > 0.5 && p.intimacy < 0.3 && p.pleasure > -0.1;
  const isNeutral = !isIntimate && !isDistressed && !isFactual;

  // 中性 → 不熔铸，保持原样
  if (isNeutral || !knowledgeBaseText) {
    return { fusedText: knowledgeBaseText, decision: 'neutral: 三源拼接传递' };
  }

  const parts: string[] = [];
  const decisions: string[] = [];

  // ── ① 私人记忆（感知驱动强度） ──
  if (isIntimate || isDistressed) {
    const recentMemories = memorySummary.timeline.slice(0, 3);
    if (recentMemories.length > 0) {
      const memoryBlock = recentMemories
        .map(m => `📖 ${m.summary}`)
        .join('\n');
      parts.push(`【我想起的】\n${memoryBlock}`);
      decisions.push(`记忆权重↑ (${isIntimate ? '亲密' : '低落'}模式)`);
    }
  }

  // ── ② 家族上下文 ──
  if (familyContext && familyContext.length > 0 && (isIntimate || isDistressed)) {
    const familyBlock = familyContext
      .map(f => `👤 ${f.entity}（你的${f.relation}）`)
      .join('\n');
    parts.push(`【家人】\n${familyBlock}`);
    decisions.push(`家族权重↑`);
  }

  // ── ③ 知识+谱曲（感知驱动过滤） ──
  if (isFactual) {
    // 事实性高 → 优先知识
    parts.push(knowledgeBaseText);
    decisions.push(`知识权重↑ (事实模式)`);
  } else if (isIntimate) {
    // 亲密模式 → 过滤百科类知识，保留情感曲谱
    const filtered = knowledgeBaseText
      .split('\n')
      .filter(line => !line.startsWith('📄') || /情感|曲谱|VAD/.test(line))
      .join('\n');
    if (filtered.trim()) {
      parts.push(filtered);
      decisions.push(`知识过滤(亲密模式): 保留情感曲谱`);
    }
  } else if (isDistressed) {
    // 低落模式 → 保留安慰相关的知识，过滤纯信息条目
    const filtered = knowledgeBaseText
      .split('\n')
      .filter(line => !line.startsWith('📄') || /安慰|陪伴|温暖|支持/.test(line))
      .join('\n');
    if (filtered.trim()) {
      parts.push(filtered);
      decisions.push(`知识过滤(低落模式): 保留温柔内容`);
    }
  } else {
    // 默认 → 原样
    parts.push(knowledgeBaseText);
  }

  const fusedText = parts.join('\n\n');
  return {
    fusedText,
    decision: decisions.join('; ') || '默认拼接',
  };
}
