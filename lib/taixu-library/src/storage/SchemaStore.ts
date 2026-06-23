/**
 * SchemaStore — 结构化索引层
 *
 * 管理 schema_index 表，存储关键词、实体关系、主题聚类。
 * 作为语义检索的高性能索引层。
 */

import type { DatabaseAdapter } from './Migration.js';

export interface SchemaIndex {
  id?: number;
  dna_root_id: string;
  wiki_dna: string;
  keywords: string;
  entities: string;
  topics: string;
  relations?: string;
  vector_embedding?: string;
  created_at?: string;
}

export class SchemaStore {
  constructor(private db: DatabaseAdapter) {}

  async create(index: SchemaIndex): Promise<number> {
    return this.db.run(
      `INSERT INTO schema_index (dna_root_id, wiki_dna, keywords, entities, topics, relations, vector_embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      index.dna_root_id,
      index.wiki_dna,
      index.keywords,
      index.entities,
      index.topics,
      index.relations ?? null,
      index.vector_embedding ?? null,
    );
  }

  async getByDna(dnaRootId: string): Promise<SchemaIndex | null> {
    const rows = await this.db.queryAll(
      'SELECT * FROM schema_index WHERE dna_root_id = ?',
      [dnaRootId],
    );
    return (rows as any[])[0] as SchemaIndex ?? null;
  }

  async findByKeyword(keyword: string): Promise<SchemaIndex[]> {
    return this.db.queryAll(
      'SELECT * FROM schema_index WHERE keywords LIKE ? ORDER BY created_at DESC LIMIT 20',
      `%${keyword}%`,
    ) as Promise<SchemaIndex[]>;
  }

  async findByEntity(entityName: string): Promise<SchemaIndex[]> {
    return this.db.queryAll(
      'SELECT * FROM schema_index WHERE entities LIKE ? ORDER BY created_at DESC LIMIT 20',
      `%${entityName}%`,
    ) as Promise<SchemaIndex[]>;
  }

  async findByTopic(topic: string): Promise<SchemaIndex[]> {
    return this.db.queryAll(
      'SELECT * FROM schema_index WHERE topics LIKE ? ORDER BY created_at DESC LIMIT 20',
      `%${topic}%`,
    ) as Promise<SchemaIndex[]>;
  }

  async deleteByDna(dnaRootId: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM schema_index WHERE dna_root_id = ?',
      dnaRootId,
    );
    return (result as any)?.changes > 0;
  }

  async count(): Promise<number> {
    const rows = await this.db.queryAll('SELECT COUNT(*) as count FROM schema_index');
    return (rows as any[])[0]?.count ?? 0;
  }
}
