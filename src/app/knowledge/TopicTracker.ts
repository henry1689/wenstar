/**
 * TopicTracker — 高频话题追踪器
 *
 * 监听聊天内容，统计话题出现频率。
 * 当某个话题被反复提及但知识库中没有时，标记为"待研究"。
 * "纳米技术"和"纳米机器人"通过前两字归并为同一话题"纳米"。
 */
import type { SQLiteAdapter } from '../../m2/SQLiteAdapter.js';

interface TrackedTopic {
  keyword: string;
  count: number;
  firstMentioned: number;
  lastMentioned: number;
  inKnowledgeBase: boolean;
  researched: boolean;
  researchEntryId?: string;
}

export class TopicTracker {
  private topics = new Map<string, TrackedTopic>();
  private sqlite: SQLiteAdapter;
  private readonly RESEARCH_THRESHOLD = 3;
  private readonly MAX_TOPICS = 50;

  constructor(sqlite: SQLiteAdapter) {
    this.sqlite = sqlite;
  }

  /** 记录消息中提取的话题 */
  record(message: string): void {
    const now = Date.now();
    const rawKeywords = this.extractKeywords(message);
    // 使用完整词（修复: 之前取前2字导致"陈都灵"变成"陈都"、研究条目变垃圾）
    // 复合词合并: "纳米技术"+"纳米机器人"→提取公共前缀"纳米"作为同一话题
    const merged = new Map<string, string[]>();
    for (const kw of rawKeywords) {
      if (kw.length < 2) continue;
      let parent = kw;
      for (const existing of merged.keys()) {
        if (kw.startsWith(existing) && kw.length > existing.length + 1) { parent = existing; break; }
        if (existing.startsWith(kw) && existing.length > kw.length + 1) { merged.delete(existing); break; }
      }
      if (!merged.has(parent)) merged.set(parent, []);
      merged.get(parent)!.push(kw);
    }
    for (const [root, children] of merged) {
      const existing = this.topics.get(root);
      if (existing) {
        existing.count += children.length;
        existing.lastMentioned = now;
        if (existing.count >= this.RESEARCH_THRESHOLD && !existing.inKnowledgeBase) {
          existing.inKnowledgeBase = this.checkKnowledgeBase(root);
        }
      } else {
        this.topics.set(root, {
          keyword: root, count: children.length,
          firstMentioned: now, lastMentioned: now,
          inKnowledgeBase: this.checkKnowledgeBase(root),
          researched: false,
        });
      }
    }
    if (this.topics.size > this.MAX_TOPICS) {
      const sorted = [...this.topics.entries()].sort((a, b) => b[1].lastMentioned - a[1].lastMentioned);
      this.topics.clear();
      for (const [k, v] of sorted.slice(0, this.MAX_TOPICS)) this.topics.set(k, v);
    }
  }

  /** 获取待研究话题 */
  getTopicsNeedingResearch(): string[] {
    const needs: string[] = [];
    for (const [word, topic] of this.topics) {
      if (topic.count >= this.RESEARCH_THRESHOLD && !topic.inKnowledgeBase && !topic.researched) {
        topic.inKnowledgeBase = this.checkKnowledgeBase(word);
        if (!topic.inKnowledgeBase) needs.push(word);
      }
    }
    return needs;
  }

  /** 标记已研究 */
  markResearched(keyword: string, entryId: string): void {
    const topic = this.topics.get(keyword);
    if (topic) { topic.researched = true; topic.researchEntryId = entryId; topic.inKnowledgeBase = true; }
  }

  /** 检查消息是否匹配已研究话题 */
  getResearchResult(message: string): { keyword: string; content: string } | null {
    for (const [_word, topic] of this.topics) {
      if (topic.researched && topic.researchEntryId && message.includes(topic.keyword)) {
        const rows = this.sqlite.queryAll(`SELECT content FROM knowledge_base WHERE id = ?`, [topic.researchEntryId]);
        if (rows.length > 0) return { keyword: topic.keyword, content: rows[0].content as string };
      }
    }
    return null;
  }

  getStats(): { tracked: number; pendingResearch: number; researched: number } {
    let pending = 0, researched = 0;
    for (const t of this.topics.values()) {
      if (t.count >= this.RESEARCH_THRESHOLD && !t.inKnowledgeBase && !t.researched) pending++;
      if (t.researched) researched++;
    }
    return { tracked: this.topics.size, pendingResearch: pending, researched };
  }

  private extractKeywords(text: string): string[] {
    const words = new Set<string>();
    const cnMatches = text.match(/[一-龥]{2,4}/g);
    if (cnMatches) {
      const stop = new Set(['一个', '这个', '那个', '什么', '怎么', '这样', '那样', '这里', '那里', '我们', '你们', '他们', '自己', '没有', '可以', '知道', '觉得', '因为', '所以', '但是', '如果', '虽然', '而且', '然后', '最后', '开始', '已经', '不会', '还是', '就是', '只是', '可是', '不是', '是的', '时候', '东西', '朋友', '真的', '一直', '到底是', '在医学', '有什么用']);
      for (const w of cnMatches) { if (!stop.has(w)) words.add(w); }
    }
    const phraseMatches = text.match(/[一-龥]{6,10}/g);
    if (phraseMatches) { for (const p of phraseMatches) words.add(p); }
    return [...words];
  }

  private checkKnowledgeBase(keyword: string): boolean {
    try {
      const rows = this.sqlite.queryAll(
        `SELECT COUNT(*) as cnt FROM knowledge_base WHERE content LIKE ? OR title LIKE ? LIMIT 1`,
        [`%${keyword}%`, `%${keyword}%`],
      );
      return rows.length > 0 && (rows[0].cnt as number) > 0;
    } catch (err) { console.warn("[TopicTracker] KB检查失败:", err); return false; }
  }
}
