/**
 * WikiStore — 语义词条层
 *
 * 管理 wiki_entries 表，存储语义化知识词条。
 * 支持按标签、实体、关键词检索。
 */

import type { DatabaseAdapter } from './Migration.js';

export interface WikiEntry {
  id?: number;
  dna_root_id: string;
  title: string;
  type: string;
  content: string;
  summary?: string;
  calcium?: number;
  entities?: string;
  tags?: string;
  source_dna?: string;
  recall_count?: number;
  is_promoted?: number;
  created_at?: string;
  updated_at?: string;
}

export interface WikiSearchOptions {
  query?: string;
  tags?: string[];
  type?: string;
  minCalcium?: number;
  page?: number;
  pageSize?: number;
}

export class WikiStore {
  constructor(private db: DatabaseAdapter) {}

  async create(entry: WikiEntry): Promise<number> {
    return this.db.run(
      `INSERT INTO wiki_entries (dna_root_id, title, type, content, summary, calcium, entities, tags, source_dna)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.dna_root_id,
      entry.title,
      entry.type,
      entry.content,
      entry.summary ?? null,
      entry.calcium ?? 1.0,
      entry.entities ?? null,
      entry.tags ?? null,
      entry.source_dna ?? null,
    );
  }

  async getByDna(dnaRootId: string): Promise<WikiEntry | null> {
    const rows = await this.db.queryAll(
      'SELECT * FROM wiki_entries WHERE dna_root_id = ?',
      [dnaRootId],
    );
    return (rows as any[])[0] as WikiEntry ?? null;
  }

  async getById(id: number): Promise<WikiEntry | null> {
    const rows = await this.db.queryAll(
      'SELECT * FROM wiki_entries WHERE id = ?',
      [id],
    );
    return (rows as any[])[0] as WikiEntry ?? null;
  }

  async update(entry: Partial<WikiEntry> & { dna_root_id: string }): Promise<boolean> {
    const fields: string[] = [];
    const values: any[] = [];

    if (entry.title !== undefined) { fields.push('title = ?'); values.push(entry.title); }
    if (entry.content !== undefined) { fields.push('content = ?'); values.push(entry.content); }
    if (entry.summary !== undefined) { fields.push('summary = ?'); values.push(entry.summary); }
    if (entry.tags !== undefined) { fields.push('tags = ?'); values.push(entry.tags); }
    if (entry.type !== undefined) { fields.push('type = ?'); values.push(entry.type); }
    if (entry.calcium !== undefined) { fields.push('calcium = ?'); values.push(entry.calcium); }

    if (fields.length === 0) return false;

    fields.push("updated_at = datetime('now','localtime')");
    values.push(entry.dna_root_id);

    const result = await this.db.run(
      `UPDATE wiki_entries SET ${fields.join(', ')} WHERE dna_root_id = ?`,
      ...values,
    );
    return (result as any)?.changes > 0;
  }

  async deleteByDna(dnaRootId: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM wiki_entries WHERE dna_root_id = ?',
      dnaRootId,
    );
    return (result as any)?.changes > 0;
  }

  async search(options: WikiSearchOptions): Promise<{ entries: WikiEntry[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (options.query) {
      conditions.push('(title LIKE ? OR content LIKE ? OR summary LIKE ?)');
      const q = `%${options.query}%`;
      values.push(q, q, q);
    }

    if (options.tags && options.tags.length > 0) {
      const tagConds = options.tags.map(() => 'tags LIKE ?');
      conditions.push(`(${tagConds.join(' OR ')})`);
      values.push(...options.tags.map(t => `%${t}%`));
    }

    if (options.type) {
      conditions.push('type = ?');
      values.push(options.type);
    }

    if (options.minCalcium !== undefined) {
      conditions.push('calcium >= ?');
      values.push(options.minCalcium);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 20;
    const offset = (page - 1) * pageSize;

    const countRows = await this.db.queryAll(`SELECT COUNT(*) as count FROM wiki_entries ${where}`, ...values);
    const total = (countRows as any[])[0]?.count ?? 0;

    const entries = await this.db.queryAll(
      `SELECT * FROM wiki_entries ${where} ORDER BY calcium DESC, updated_at DESC LIMIT ? OFFSET ?`,
      ...values, pageSize, offset,
    );

    return { entries: entries as WikiEntry[], total };
  }

  async markPromoted(dnaRootId: string): Promise<void> {
    await this.db.run(
      "UPDATE wiki_entries SET is_promoted = 1, updated_at = datetime('now','localtime') WHERE dna_root_id = ?",
      dnaRootId,
    );
  }

  async incrementRecall(dnaRootId: string): Promise<void> {
    await this.db.run(
      "UPDATE wiki_entries SET recall_count = recall_count + 1, updated_at = datetime('now','localtime') WHERE dna_root_id = ?",
      dnaRootId,
    );
  }

  async count(): Promise<number> {
    const rows = await this.db.queryAll('SELECT COUNT(*) as count FROM wiki_entries');
    return (rows as any[])[0]?.count ?? 0;
  }
}
