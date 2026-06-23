-- 太虚图书馆 · SQLite Schema
-- 三层存储: raw_attachments / wiki_entries / schema_index

-- Layer 1: 原始附件层
CREATE TABLE IF NOT EXISTS raw_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dna_root_id TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_path TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    sha256_hash TEXT NOT NULL,
    original_content TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_raw_dna ON raw_attachments(dna_root_id);

-- Layer 2: 语义词条层
CREATE TABLE IF NOT EXISTS wiki_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dna_root_id TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'note',
    content TEXT NOT NULL,
    summary TEXT,
    calcium REAL DEFAULT 1.0,
    entities TEXT,
    tags TEXT,
    source_dna TEXT,
    recall_count INTEGER DEFAULT 0,
    is_promoted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_wiki_dna ON wiki_entries(dna_root_id);
CREATE INDEX IF NOT EXISTS idx_wiki_calcium ON wiki_entries(calcium);
CREATE INDEX IF NOT EXISTS idx_wiki_promoted ON wiki_entries(is_promoted);

-- Layer 3: 结构化索引层
CREATE TABLE IF NOT EXISTS schema_index (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dna_root_id TEXT NOT NULL UNIQUE,
    wiki_dna TEXT NOT NULL,
    keywords TEXT NOT NULL,
    entities TEXT NOT NULL,
    topics TEXT NOT NULL,
    relations TEXT,
    vector_embedding TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_schema_dna ON schema_index(dna_root_id);
CREATE INDEX IF NOT EXISTS idx_schema_wiki ON schema_index(wiki_dna);

-- 配置表
CREATE TABLE IF NOT EXISTS library_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- 同步日志
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,      -- 'to_main' | 'from_main'
    entry_dna TEXT NOT NULL,
    status TEXT NOT NULL,         -- 'success' | 'failed'
    message TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
