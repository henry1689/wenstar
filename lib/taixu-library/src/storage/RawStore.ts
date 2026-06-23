/**
 * RawStore — 原始附件层
 *
 * 管理 raw_attachments 表，存储原始文件的元数据和文本内容。
 */

import type { DatabaseAdapter } from './Migration.js';

export interface RawAttachment {
  id?: number;
  dna_root_id: string;
  file_name: string;
  file_path: string;
  original_path: string;
  file_size: number;
  mime_type: string;
  sha256_hash: string;
  original_content?: string;
  created_at?: string;
}

export class RawStore {
  constructor(private db: DatabaseAdapter) {}

  async create(attachment: RawAttachment): Promise<number> {
    return this.db.run(
      `INSERT INTO raw_attachments (dna_root_id, file_name, file_path, original_path, file_size, mime_type, sha256_hash, original_content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      attachment.dna_root_id,
      attachment.file_name,
      attachment.file_path,
      attachment.original_path,
      attachment.file_size,
      attachment.mime_type,
      attachment.sha256_hash,
      attachment.original_content ?? null,
    );
  }

  async getByDna(dnaRootId: string): Promise<RawAttachment | null> {
    const rows = await this.db.queryAll(
      'SELECT * FROM raw_attachments WHERE dna_root_id = ?',
      [dnaRootId],
    );
    return (rows as any[])[0] as RawAttachment ?? null;
  }

  async getById(id: number): Promise<RawAttachment | null> {
    const rows = await this.db.queryAll(
      'SELECT * FROM raw_attachments WHERE id = ?',
      [id],
    );
    return (rows as any[])[0] as RawAttachment ?? null;
  }

  async deleteByDna(dnaRootId: string): Promise<boolean> {
    const result = await this.db.run(
      'DELETE FROM raw_attachments WHERE dna_root_id = ?',
      dnaRootId,
    );
    return (result as any)?.changes > 0;
  }

  async listAll(): Promise<RawAttachment[]> {
    return this.db.queryAll('SELECT * FROM raw_attachments ORDER BY created_at DESC') as Promise<RawAttachment[]>;
  }

  async count(): Promise<number> {
    const rows = await this.db.queryAll('SELECT COUNT(*) as count FROM raw_attachments');
    return (rows as any[])[0]?.count ?? 0;
  }
}
