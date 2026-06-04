-- Hermes Fusion Memory Schema v1.0
-- SQLite 作为情感记忆系统的主存储
-- JSON Zone 保留为人类可读的原文备份

-- 核心记忆表
CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    seq_pos INTEGER UNIQUE NOT NULL,
    created_at TEXT NOT NULL,

    -- 24维情感向量 (JSON数组, sql.js 支持读取)
    perception_json TEXT NOT NULL,

    -- 钙化（缓存加速）
    calcium_score REAL NOT NULL,
    calcium_level INTEGER NOT NULL CHECK(calcium_level BETWEEN 0 AND 3),

    -- 内容次级索引
    locus_path TEXT NOT NULL,
    leaf_zone TEXT NOT NULL,
    raw_input TEXT NOT NULL,

    -- 记忆动力学
    recall_count INTEGER DEFAULT 0,
    last_recalled_at TEXT,
    reinforcement_accumulator REAL DEFAULT 0.0,
    effective_strength REAL DEFAULT 1.0,
    strength_updated_at TEXT NOT NULL,

    -- 年轮/地标
    is_landmark INTEGER DEFAULT 0,
    landmarked_at TEXT,
    narrative_tag TEXT,
    sensory_anchor TEXT,
    scar_type TEXT,
    scar_healed INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memories_calcium ON memories(calcium_score DESC);
CREATE INDEX IF NOT EXISTS idx_memories_strength ON memories(effective_strength DESC);
CREATE INDEX IF NOT EXISTS idx_memories_locus ON memories(locus_path);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_landmarks ON memories(is_landmark) WHERE is_landmark = 1;

-- 实体表
CREATE TABLE IF NOT EXISTS entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('person','place','event','emotion','object','self')),
    UNIQUE(name, type)
);

-- 记忆-实体关联
CREATE TABLE IF NOT EXISTS memory_entities (
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    allele TEXT,
    phenotype TEXT CHECK(phenotype IN ('enhance','conflict','neutral')),
    knowledge_type TEXT CHECK(knowledge_type IN ('private','family','world')),
    PRIMARY KEY (memory_id, entity_id)
);

-- 实体关系图（轻量级）
CREATE TABLE IF NOT EXISTS entity_relations (
    entity_a_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    entity_b_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    strength REAL DEFAULT 1.0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entity_a_id, entity_b_id, relation)
);

-- 高阶归纳（日/周/月摘要）
CREATE TABLE IF NOT EXISTS inductions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type TEXT NOT NULL CHECK(period_type IN ('daily','weekly','monthly','hourly')),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    source_record_count INTEGER,
    dominant_mood TEXT,
    trait_updates TEXT,
    created_at TEXT NOT NULL
);

-- 知识库（上传文件 → 永久记忆）
CREATE TABLE IF NOT EXISTS knowledge_base (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text',
    source_name TEXT,
    file_size INTEGER DEFAULT 0,
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    locked INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_base(created_at DESC);

-- 知识-记忆关联
CREATE TABLE IF NOT EXISTS knowledge_memories (
    knowledge_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    relevance REAL DEFAULT 1.0,
    PRIMARY KEY (knowledge_id, memory_id)
);

-- 知识分块（用于向量搜索）
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    kn_id TEXT NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding TEXT
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_kn_id ON knowledge_chunks(kn_id);

-- 衰减日志
CREATE TABLE IF NOT EXISTS decay_log (
    memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL,
    strength_before REAL,
    strength_after REAL,
    days_elapsed REAL,
    PRIMARY KEY (memory_id, checked_at)
);
