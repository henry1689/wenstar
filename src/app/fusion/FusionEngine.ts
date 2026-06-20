/**
 * FusionEngine — 三源熔铸器（P0-1 增强版）
 *
 * 白皮书 §1.2 锚点5 要求的三源融合的意义熔铸：
 * "私人记忆 × 家族知识 × 世界知识在表达时被熔铸为有血有肉的个体化叙事"
 *
 * P0-1 新增能力:
 *   ① memoryFragments 按实体去重（同一实体只保留分数最高的）
 *   ② 可信度排序：黑钻 > 金库 > 知识库 > 砂金库
 *   ③ 超过 6000 字符从低分源截断
 *
 * 零 LLM 调用，纯规则。
 *
 * Ref: docs/project-spec-v1.md §1.2 锚点5
 */
import type { Perception24D } from '../../m3/types/perception.js';
import type { MemorySummary } from '../../m4/types/index.js';

/** P1-5: 语义融合 LLM 回调 */
export type SemanticFusionCallback = (prompt: string) => Promise<string>;

/** 熔铸器输入 */
export interface FusionInput {
  perception: Perception24D;
  /** 已拼接的 knowledgeBaseText（关键词搜索+实体重叠+VAD谱曲） */
  knowledgeBaseText: string;
  /** M4 记忆摘要 */
  memorySummary: MemorySummary;
  /** M4 家族上下文 */
  familyContext?: Array<{ entity: string; relation: string; related_entity: string }>;
  /** P0-1: 记忆碎片数组（用于去重+可信度排序） */
  memoryFragments?: string[];
  /** P1-5: 是否启用语义融合（默认false） */
  enableSemanticFusion?: boolean;
  /** P1-5: LLM 生成回调（语义融合需要） */
  llmGenerate?: SemanticFusionCallback;
}

/** 熔铸结果 */
export interface FusionResult {
  fusedText: string;
  decision: string;
}

// ─── P0-1: 可信度等级 ───
const CREDIBILITY_MAP: Array<{ prefix: string; score: number }> = [
  { prefix: '【珍藏记忆】', score: 10 },   // 黑钻库
  { prefix: '【用户曾提到】', score: 7 },  // 情感记忆（金库）
  { prefix: '【核心解答】', score: 5 },    // 知识库
  { prefix: '【关联知识】', score: 5 },
  { prefix: '【时间检索】', score: 3 },    // 时间导航
  { prefix: '【内心独白】', score: 3 },
  { prefix: '【玉瑶想起】', score: 4 },
  { prefix: '【用户状态】', score: 3 },    // 躯体感知
  { prefix: '【线索参考】', score: 2 },    // 线索检索
  { prefix: '【知识库补充】', score: 5 },
  { prefix: '【性格】', score: 6 },        // M6 人格
];

/** 判断一条碎片的可信度 */
function scoreFragment(frag: string): number {
  for (const rule of CREDIBILITY_MAP) {
    if (frag.startsWith(rule.prefix)) return rule.score;
  }
  return 1; // 默认低分
}

/** 提取碎片中的人名实体（用于去重） */
function extractEntities(text: string): string[] {
  const names: string[] = [];
  // 匹配「X」格式人名
  const quoted = text.match(/[「「"]([一-龥]{2,4})[」」"]/g);
  if (quoted) {
    for (const q of quoted) {
      const n = q.replace(/[「「""」」]/g, '');
      if (!names.includes(n)) names.push(n);
    }
  }
  return names;
}

/**
 * P0-1: 对 memoryFragments 做去重+可信度排序
 * 同一条实体的多条碎片只保留分数最高的那条。
 */
function dedupAndSortFragments(fragments: string[]): string[] {
  if (fragments.length <= 1) return fragments;

  // 先按可信度降序排序
  const scored = fragments.map(f => ({ text: f, score: scoreFragment(f) }))
    .sort((a, b) => b.score - a.score);

  // 去重：同实体只保留第一条（分数最高的）
  const seenEntities = new Set<string>();
  const deduped: string[] = [];
  for (const frag of scored) {
    const entities = extractEntities(frag.text);
    // 如果没有实体（纯文本碎片），看整句是否相似
    if (entities.length === 0) {
      // 检查是否已有语义相近的碎片（简单子串匹配）
      const isDuplicate = deduped.some(d => d.includes(frag.text.substring(0, 20)));
      if (!isDuplicate) deduped.push(frag.text);
    } else {
      // 有实体：如果该实体已被更高分碎片覆盖则跳过
      const alreadyCovered = entities.some(e => seenEntities.has(e));
      if (!alreadyCovered) {
        entities.forEach(e => seenEntities.add(e));
        deduped.push(frag.text);
      }
    }
  }
  return deduped;
}

/**
 * P0-1: 总长度超过 maxChars 时从最低分源截断
 */
function truncateByCredibility(fragments: string[], maxChars: number): string[] {
  let totalLen = fragments.reduce((s, f) => s + f.length, 0);
  if (totalLen <= maxChars) return fragments;

  // 从低分到高分排序，逐步移除直到达标
  const withScore = fragments.map(f => ({ text: f, score: scoreFragment(f) }));
  withScore.sort((a, b) => a.score - b.score); // 低分在前

  let removed = 0;
  for (const item of withScore) {
    if (totalLen <= maxChars) break;
    totalLen -= item.text.length;
    removed++;
  }

  const keptFragments = fragments.filter(f => {
    const score = scoreFragment(f);
    // 保留所有分数高于被移除的最低分段的
    const minKeptScore = withScore[removed]?.score ?? 0;
    return score >= minKeptScore;
  });

  // 如果过滤后还超长，从最低分逐个截断内容
  if (keptFragments.reduce((s, f) => s + f.length, 0) > maxChars) {
    const kept = [...keptFragments];
    kept.sort((a, b) => scoreFragment(a) - scoreFragment(b));
    while (kept.reduce((s, f) => s + f.length, 0) > maxChars && kept.length > 1) {
      kept.shift(); // 移除最低分
    }
    return kept;
  }
  return keptFragments;
}

// ─── 原感知驱动策略 ───

const KNOWLEDGE_PREFIXES = ['【核心解答】', '【关联知识】', '【玉瑶想起】', '【知识库补充】', '【情感曲谱库】'];

function isKnowledgeLine(line: string): boolean {
  return KNOWLEDGE_PREFIXES.some(p => line.startsWith(p));
}

export function fuseSources(input: FusionInput): FusionResult {
  const { perception, knowledgeBaseText, memorySummary, familyContext, memoryFragments } = input;
  const p = perception;
  const decisions: string[] = [];

  // ═══ P0-1: memoryFragments 去重+排序+裁剪 ═══
  let processedFragments: string[] = [];
  if (memoryFragments && memoryFragments.length > 0) {
    const deduped = dedupAndSortFragments(memoryFragments);
    const truncated = truncateByCredibility(deduped, 3000); // 碎片区最多 3000 字符
    processedFragments = truncated;
    if (deduped.length !== memoryFragments.length) {
      decisions.push(`碎片去重: ${memoryFragments.length}→${deduped.length}`);
    }
    if (truncated.length !== deduped.length) {
      decisions.push(`碎片裁剪: 超3000字符`);
    }
  }

  // ═══ P1-5: 语义融合（可选，默认关） ═══
  // 当启用时，为 LLM 提供融合指令而非简单拼接，减少 token 占用
  if (input.enableSemanticFusion && processedFragments.length >= 2) {
    const semanticHint = '\n（📌 以上几条记忆是同一话题的相关碎片，请自然融合成一段连贯的回忆来回应，不要逐条罗列。）';
    processedFragments = [processedFragments.join('\n') + semanticHint];
    decisions.push('语义融合↑（碎片合并+融合指令）');
  }

  // ═══ 原感知驱动策略 ═══
  const isIntimate = p.intimacy > 0.4;
  const isDistressed = p.pleasure < -0.2;
  const isFactual = p.factual > 0.5 && p.intimacy < 0.3 && p.pleasure > -0.1;
  const isNeutral = !isIntimate && !isDistressed && !isFactual;

  const parts: string[] = [];

  // P0-1: 去重排序后的 memoryFragments 优先注入
  if (processedFragments.length > 0) {
    parts.push(processedFragments.join('\n'));
  }

  // 原行为：感知驱动知识过滤
  if (knowledgeBaseText) {
    if (isNeutral) {
      parts.push(knowledgeBaseText);
      decisions.push('neutral');
    } else if (isIntimate) {
      const filtered = knowledgeBaseText
        .split('\n')
        .filter(line => !isKnowledgeLine(line) || /情感|曲谱|VAD/.test(line))
        .join('\n');
      if (filtered.trim()) {
        parts.push(filtered);
        decisions.push('亲密度↑，过滤知识');
      }
    } else if (isDistressed) {
      const filtered = knowledgeBaseText
        .split('\n')
        .filter(line => !isKnowledgeLine(line) || /安慰|陪伴|温暖|支持/.test(line))
        .join('\n');
      if (filtered.trim()) {
        parts.push(filtered);
        decisions.push('低落↑，保留温柔内容');
      }
    } else {
      parts.push(knowledgeBaseText);
    }
  }

  // 私人记忆注入（感知驱动）
  if (isIntimate || isDistressed) {
    const recentMemories = memorySummary.timeline.slice(0, 2);
    if (recentMemories.length > 0) {
      const memoryBlock = recentMemories
        .map(m => `📖 ${m.summary}`)
        .join('\n');
      parts.push(`【我想起的】\n${memoryBlock}`);
      decisions.push(`记忆权重↑ (${isIntimate ? '亲密' : '低落'})`);
    }
  }

  // 家族上下文注入
  if (familyContext && familyContext.length > 0 && (isIntimate || isDistressed)) {
    const familyBlock = familyContext
      .map(f => `👤 ${f.entity}（你的${f.relation}）`)
      .join('\n');
    parts.push(`【家人】\n${familyBlock}`);
    decisions.push('家族权重↑');
  }

  // ═══ P0-1: 最终总长裁剪 ═══
  let fusedText = parts.join('\n\n');
  if (fusedText.length > 6000) {
    // 从低分段落裁剪
    const paragraphs = fusedText.split('\n\n');
    let totalLen = fusedText.length;
    // 按段落可信度从低到高移除
    const paraScores = paragraphs.map(p => ({
      text: p,
      score: scoreFragment(p),
    }));
    paraScores.sort((a, b) => a.score - b.score);

    for (const para of paraScores) {
      if (totalLen <= 6000) break;
      totalLen -= para.text.length + 2; // +2 for \n\n
      fusedText = fusedText.replace(para.text, '');
    }
    decisions.push(`总长裁剪: 超6000字符`);
    fusedText = fusedText.replace(/\n{3,}/g, '\n\n').trim();
  }

  return {
    fusedText,
    decision: decisions.join('; ') || '原始传递',
  };
}
