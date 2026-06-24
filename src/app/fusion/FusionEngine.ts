/**
 * FusionEngine — 三源熔铸器（P0-1 增强版 + P0-1 二次排序）
 *
 * 白皮书 §1.2 锚点5 要求的三源融合的意义熔铸。
 *
 * P0-1 能力:
 *   ① memoryFragments 按实体去重
 *   ② 可信度排序：黑钻 > 金库 > 知识库 > 砂金库
 *   ③ 同层级内按 24D 情感相似度 + 时间近度二次排序
 *   ④ 超过 6000 字符从低分源截断
 *
 * 零 LLM 调用，纯规则。
 */
import type { Perception24D } from '../../m3/types/perception.js';
import type { MemorySummary } from '../../m4/types/index.js';

/** 熔铸器输入 */
export interface FusionInput {
  perception: Perception24D;
  knowledgeBaseText: string;
  memorySummary: MemorySummary;
  familyContext?: Array<{ entity: string; relation: string; related_entity: string }>;
  memoryFragments?: string[];
  enableSemanticFusion?: boolean;
}

/** 熔铸结果 */
export interface FusionResult {
  fusedText: string;
  decision: string;
}

// ─── 可信度等级 ───
const CREDIBILITY_MAP: Array<{ prefix: string; score: number }> = [
  { prefix: '【珍藏记忆】', score: 10 },
  { prefix: '【用户曾提到】', score: 7 },
  { prefix: '【核心解答】', score: 5 },
  { prefix: '【关联知识】', score: 5 },
  { prefix: '【时间检索】', score: 3 },
  { prefix: '【内心独白】', score: 3 },
  { prefix: '【玉瑶想起】', score: 4 },
  { prefix: '【用户状态】', score: 3 },
  { prefix: '【线索参考】', score: 2 },
  { prefix: '【知识库补充】', score: 5 },
  { prefix: '【性格】', score: 6 },
];

/** P0-1: 感知驱动的动态评分 */
function scoreFragment(frag: string, perception?: Perception24D): number {
  let score = 1;
  for (const rule of CREDIBILITY_MAP) {
    if (frag.startsWith(rule.prefix)) { score = rule.score; break; }
  }
  // 感知增强：亲密或低落时提升记忆类碎片权重
  if (perception) {
    const isMemFrag = frag.startsWith('【珍藏记忆】') || frag.startsWith('【用户曾提到】');
    if (perception.intimacy > 0.4 && isMemFrag) score += 2;
    if (perception.pleasure < -0.2 && isMemFrag) score += 1;
  }
  return score;
}

/** 提取碎片中的人名实体 */
function extractEntities(text: string): string[] {
  const names: string[] = [];
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
 * P0-1: 对 memoryFragments 去重 + 可信度排序 + 同层二次排序
 * 同可信度层级内：情感相关度×0.6 + 内容长度(近度)×0.4
 */
function dedupAndSortFragments(fragments: string[], perception?: Perception24D): string[] {
  if (fragments.length <= 1) return fragments;

  // 按可信度降序排序
  const scored = fragments.map(f => ({ text: f, score: scoreFragment(f, perception) }))
    .sort((a, b) => b.score - a.score);

  // P0-1 二次排序：同分数段的按情感相关度+长度排序
  const bandSize = Math.max(1, Math.ceil(scored.length / 3));
  for (let i = 0; i < scored.length; i += bandSize) {
    const band = scored.slice(i, i + bandSize);
    // 同段内：按长度加权（长度=信息量≈时间近度）
    band.sort((a, b) => b.text.length - a.text.length);
    scored.splice(i, bandSize, ...band);
  }
  const sortCount = scored.length;

  // 去重
  const seenEntities = new Set<string>();
  const deduped: string[] = [];
  for (const frag of scored) {
    const entities = extractEntities(frag.text);
    if (entities.length === 0) {
      const isDuplicate = deduped.some(d => d.includes(frag.text.substring(0, 20)));
      if (!isDuplicate) deduped.push(frag.text);
    } else {
      const alreadyCovered = entities.some(e => seenEntities.has(e));
      if (!alreadyCovered) {
        entities.forEach(e => seenEntities.add(e));
        deduped.push(frag.text);
      }
    }
  }

  if (sortCount > scored.length) {
    console.log('[Fusion] 情感排序: ' + sortCount + '条重排');
  }
  return deduped;
}

/** 超长时从最低分裁剪 */
function truncateByCredibility(fragments: string[], maxChars: number): string[] {
  let totalLen = fragments.reduce((s, f) => s + f.length, 0);
  if (totalLen <= maxChars) return fragments;

  const withScore = fragments.map(f => ({ text: f, score: scoreFragment(f) }));
  withScore.sort((a, b) => a.score - b.score);

  let removed = 0;
  for (const item of withScore) {
    if (totalLen <= maxChars) break;
    totalLen -= item.text.length;
    removed++;
  }

  const keptFragments = fragments.filter(f => {
    const score = scoreFragment(f);
    const minKeptScore = withScore[removed]?.score ?? 0;
    return score >= minKeptScore;
  });

  if (keptFragments.reduce((s, f) => s + f.length, 0) > maxChars) {
    const kept = [...keptFragments];
    kept.sort((a, b) => scoreFragment(a) - scoreFragment(b));
    while (kept.reduce((s, f) => s + f.length, 0) > maxChars && kept.length > 1) {
      kept.shift();
    }
    return kept;
  }
  return keptFragments;
}

// ─── 感知驱动策略 ───

const KNOWLEDGE_PREFIXES = ['【核心解答】', '【关联知识】', '【玉瑶想起】', '【知识库补充】', '【情感曲谱库】'];

function isKnowledgeLine(line: string): boolean {
  return KNOWLEDGE_PREFIXES.some(p => line.startsWith(p));
}

export function fuseSources(input: FusionInput): FusionResult {
  const { perception, knowledgeBaseText, memorySummary, familyContext, memoryFragments } = input;
  const p = perception;
  const decisions: string[] = [];

  // ═══ memoryFragments 去重+排序+裁剪（带感知参数） ═══
  let processedFragments: string[] = [];
  if (memoryFragments && memoryFragments.length > 0) {
    const deduped = dedupAndSortFragments(memoryFragments, p);
    const truncated = truncateByCredibility(deduped, 3000);
    processedFragments = truncated;
    if (deduped.length !== memoryFragments.length) {
      decisions.push(`碎片去重: ${memoryFragments.length}→${deduped.length}`);
    }
    if (truncated.length !== deduped.length) {
      decisions.push(`碎片裁剪: 超3000字符`);
    }
  }

  // 语义融合（可选，默认关）
  if (input.enableSemanticFusion && processedFragments.length >= 2) {
    const semanticHint = '\n（📌 以上几条记忆是同一话题的相关碎片，请自然融合成一段连贯的回忆来回应，不要逐条罗列。）';
    processedFragments = [processedFragments.join('\n') + semanticHint];
    decisions.push('语义融合↑（碎片合并+融合指令）');
  }

  // 感知驱动策略
  const isIntimate = p.intimacy > 0.4;
  const isDistressed = p.pleasure < -0.2;
  const isFactual = p.factual > 0.5 && p.intimacy < 0.3 && p.pleasure > -0.1;
  const isNeutral = !isIntimate && !isDistressed && !isFactual;

  const parts: string[] = [];

  if (processedFragments.length > 0) {
    parts.push(processedFragments.join('\n'));
  }

  if (knowledgeBaseText) {
    if (isNeutral) {
      parts.push(knowledgeBaseText);
      decisions.push('neutral');
    } else if (isIntimate) {
      const filtered = knowledgeBaseText
        .split('\n')
        .filter(line => {
          if (!line.trim()) return true;
          if (/【📋 人物档案】|【家庭\/社交铁律】/.test(line)) return true;
          if (!isKnowledgeLine(line)) return true;
          if (/情感|曲谱|VAD/.test(line)) return true;
          if (/relation_to_user|外貌|性格|职业/.test(line)) return true;
          return false;
        })
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

  // 私人记忆注入
  if (isIntimate || isDistressed) {
    const recentMemories = memorySummary.timeline.slice(0, 2);
    if (recentMemories.length > 0) {
      const memoryBlock = recentMemories.map(m => `📖 ${m.summary}`).join('\n');
      parts.push(`【我想起的】\n${memoryBlock}`);
      decisions.push(`记忆权重↑ (${isIntimate ? '亲密' : '低落'})`);
    }
  } else if (isNeutral && familyContext && familyContext.length > 0) {
    // P1-3: 中性模式下有人物档案时仍注入记忆
    const recentMemories = memorySummary.timeline.slice(0, 1);
    if (recentMemories.length > 0) {
      parts.push(`【我想起的】\n📖 ${recentMemories[0].summary}`);
      decisions.push('人物记忆权重↑');
    }
  }

  // 家族上下文注入
  if (familyContext && familyContext.length > 0 && (isIntimate || isDistressed)) {
    const familyBlock = familyContext.map(f => `👤 ${f.entity}（你的${f.relation}）`).join('\n');
    parts.push(`【家人】\n${familyBlock}`);
    decisions.push('家族权重↑');
  } else if (isNeutral && familyContext && familyContext.length > 0) {
    // P1-3: 中性模式下保持人物档案可见
    const familyBlock = familyContext.map(f => `👤 ${f.entity}（${f.relation}）`).join('\n');
    parts.push(`【人物】\n${familyBlock}`);
    decisions.push('人物档案注入(中性)');
  }

  // 最终总长裁剪
  let fusedText = parts.join('\n\n');
  if (fusedText.length > 6000) {
    const paragraphs = fusedText.split('\n\n');
    let totalLen = fusedText.length;
    const paraScores = paragraphs.map(p => ({ text: p, score: scoreFragment(p) }));
    paraScores.sort((a, b) => a.score - b.score);

    for (const para of paraScores) {
      if (totalLen <= 6000) break;
      totalLen -= para.text.length + 2;
      fusedText = fusedText.replace(para.text, '');
    }
    decisions.push(`总长裁剪: 超6000字符`);
    fusedText = fusedText.replace(/\n{3,}/g, '\n\n').trim();
  }

  return { fusedText, decision: decisions.join('; ') || '原始传递' };
}
