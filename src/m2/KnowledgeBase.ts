/**
 * KnowledgeBase — 兼容层（委托到 app/knowledge/KnowledgeEngine）
 *
 * @deprecated 阶段 2 后统一使用 app/knowledge/KnowledgeEngine
 *
 * 保留此类仅为了不修改 server.ts 等 8 处调用点的 import 路径。
 */
import { createKnowledgeEngine } from '../app/knowledge/KnowledgeEngine.js';
import type { SQLiteAdapter } from './SQLiteAdapter.js';
import type { KnowledgeItem } from '../app/knowledge/types.js';

export { KnowledgeItem };

export class KnowledgeBase {
  private engine: ReturnType<typeof createKnowledgeEngine>;

  constructor(sqlite: SQLiteAdapter) {
    this.engine = createKnowledgeEngine(sqlite);
  }

  async add(params: {
    title: string; content: string; source_type?: string;
    source_name?: string; file_size?: number; tags?: string[];
    emotionalContext?: { pleasure: number; arousal: number; intimacy: number };
    dna_id?: string; scene_tags?: string | string[];
    interaction_type?: string; emotion_vector?: string;
    classification?: string;
  }): Promise<KnowledgeItem> { return this.engine.add(params); }

  list(limit = 50): KnowledgeItem[] { return this.engine.list(limit); }

  getById(id: string): KnowledgeItem | null { return this.engine.getById(id); }

  searchByScene(sceneTags: string[], limit = 5, emotionType?: string): KnowledgeItem[] {
    return this.engine.searchByScene(sceneTags, limit, emotionType);
  }

  searchByInteraction(interactionType: string, limit = 10): KnowledgeItem[] {
    return this.engine.searchByInteraction(interactionType, limit);
  }

  async update(id: string, params: {
    title?: string; content?: string; tags?: string[]; locked?: boolean;
  }): Promise<boolean> { return this.engine.update(id, params); }

  delete(id: string): boolean { return this.engine.delete(id); }

  async search(keyword: string, limit = 10, emotionalContext?: { pleasure: number; arousal: number; intimacy: number }): Promise<KnowledgeItem[]> {
    return this.engine.search(keyword, limit, emotionalContext);
  }

  async weightedSearch(
    keyword: string,
    sceneTags: string[],
    perception?: { pleasure: number; arousal: number; intimacy: number },
    limit = 5,
  ): Promise<Array<KnowledgeItem & { matchScore: number; breakdown: { scene: number; emotion: number; text: number } }>> {
    return this.engine.weightedSearch(keyword, sceneTags, perception, limit);
  }

  count(): number { return this.engine.count(); }

  async upload(buffer: Buffer, fileName: string, mimeType: string): Promise<KnowledgeItem> {
    return this.engine.upload(buffer, fileName, mimeType);
  }

  async updateClassification(id: string, classification: string): Promise<boolean> {
    return this.engine.updateClassification(id, classification);
  }

  getUnclassified(limit = 10): KnowledgeItem[] {
    return this.engine.getUnclassified(limit);
  }

  getUnclassifiedOlderThan(days: number, limit = 5): KnowledgeItem[] {
    return this.engine.getUnclassifiedOlderThan(days, limit);
  }

  deleteExpiredUnclassified(maxAgeDays: number): number {
    return this.engine.deleteExpiredUnclassified(maxAgeDays);
  }
}
