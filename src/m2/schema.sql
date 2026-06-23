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
    promoted_to_diamond INTEGER DEFAULT 0,
    last_recalled_at TEXT,
    reinforcement_accumulator REAL DEFAULT 0.0,
    effective_strength REAL DEFAULT 1.0,
    strength_updated_at TEXT NOT NULL,

    -- VAD 谱曲（情感谱曲引擎产出，JSON字符串，可为NULL表示待谱曲）
    vad_spectrum TEXT,

    -- 年轮/地标
    is_landmark INTEGER DEFAULT 0,
    landmarked_at TEXT,
    narrative_tag TEXT,
    sensory_anchor TEXT,
    scar_type TEXT,
    scar_healed INTEGER,
    primary_emotion TEXT,
    secondary_emotions TEXT
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
    locked INTEGER DEFAULT 0,
    -- 知识分类（铁律：无分类不检索）
    classification TEXT,
    classification_pending INTEGER DEFAULT 1,
    dna_id TEXT,
    scene_tags TEXT,
    interaction_type TEXT DEFAULT 'other',
    emotion_vector TEXT
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

-- P0-5: 情感检索加速复合索引
CREATE INDEX IF NOT EXISTS idx_memories_calcium_strength ON memories(calcium_level, effective_strength);

-- 黑钻库（精选歌单·永恒珍藏 — 景幻仙姑管理）
CREATE TABLE IF NOT EXISTS black_diamond (
    id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    emotion_tag TEXT,
    source_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
    calcium_level INTEGER DEFAULT 1,
    recall_count INTEGER DEFAULT 0,
    tags TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    emotion_vector TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_black_diamond_emotion ON black_diamond(emotion_tag);
CREATE INDEX IF NOT EXISTS idx_black_diamond_created ON black_diamond(created_at DESC);

-- S3-3: 黑钻倒排索引（替代 FTS5——sql.js 不内建 FTS5）
CREATE TABLE IF NOT EXISTS black_diamond_terms (
    term TEXT NOT NULL,
    bd_id TEXT NOT NULL,
    position INTEGER DEFAULT 0,
    PRIMARY KEY (term, bd_id)
);
CREATE INDEX IF NOT EXISTS idx_bd_terms_term ON black_diamond_terms(term);
CREATE INDEX IF NOT EXISTS idx_bd_terms_bd_id ON black_diamond_terms(bd_id);

-- AQC质检表（砂金质检员 / 金库质检员 — 独立标记，不阻塞现有流程）
CREATE TABLE IF NOT EXISTS aqc_records (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL CHECK(source_type IN ('sand','gold')),
    source_id TEXT NOT NULL,
    content_snippet TEXT,
    calcium_level INTEGER DEFAULT 0,
    entity_count INTEGER DEFAULT 0,
    recall_count INTEGER DEFAULT 0,
    score REAL DEFAULT 0.0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    tags TEXT,
    created_at TEXT NOT NULL,
    evaluated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_aqc_status ON aqc_records(status);
CREATE INDEX IF NOT EXISTS idx_aqc_source ON aqc_records(source_type, status);


-- 景幻仙姑 · 三库操作日志（提炼追溯/批量操作审计）
CREATE TABLE IF NOT EXISTS vault_log (
    id TEXT PRIMARY KEY,
    operation TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    target_id TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_log_op ON vault_log(operation);
CREATE INDEX IF NOT EXISTS idx_vault_log_time ON vault_log(created_at);
-- ═══════════════════════════════════════════════════
-- 砂金库 — 全量对话活档案（取代内存数组+JSON）
-- ═══════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    seq_pos INTEGER,
    topic TEXT,
    entity_names TEXT,
    perception_summary TEXT,
    calcium_score REAL DEFAULT 0,
    is_summary INTEGER DEFAULT 0,
    summary_of_range TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_timestamp ON conversations(timestamp);
CREATE INDEX IF NOT EXISTS idx_conv_topic ON conversations(topic);
CREATE INDEX IF NOT EXISTS idx_conv_seq ON conversations(seq_pos);
CREATE INDEX IF NOT EXISTS idx_conv_summary ON conversations(is_summary);

-- ═══════════════════════════════════════════════════
-- 主人大脑镜像 — 主人的完整个人世界
-- ═══════════════════════════════════════════════════

-- 主观世界：精神/内心/感官/生活/娱乐/健康/学习
CREATE TABLE IF NOT EXISTS master_profile (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    subcategory TEXT,
    content TEXT NOT NULL,
    source TEXT,
    confidence REAL DEFAULT 0.5,
    calcium_score REAL DEFAULT 0,
    mention_count INTEGER DEFAULT 1,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    tags TEXT
);
CREATE INDEX IF NOT EXISTS idx_profile_category ON master_profile(category);
CREATE INDEX IF NOT EXISTS idx_profile_confidence ON master_profile(confidence DESC);

-- 客观世界：工作/商业/事务
CREATE TABLE IF NOT EXISTS master_affairs (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    description TEXT,
    related_persons TEXT,
    priority TEXT DEFAULT 'medium',
    start_date TEXT,
    end_date TEXT,
    next_action TEXT,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_affairs_status ON master_affairs(status);
CREATE INDEX IF NOT EXISTS idx_affairs_category ON master_affairs(category);

-- 客观世界：人脉/社交资本
CREATE TABLE IF NOT EXISTS master_network (
    id TEXT PRIMARY KEY,
    person_name TEXT NOT NULL,
    relation_type TEXT,
    organization TEXT,
    role TEXT,
    context TEXT,
    importance INTEGER DEFAULT 3,
    last_contact TEXT,
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_network_name ON master_network(person_name);
CREATE INDEX IF NOT EXISTS idx_network_importance ON master_network(importance DESC);

-- 客观世界：主人人生重要事件
CREATE TABLE IF NOT EXISTS master_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    date TEXT,
    emotion_tag TEXT,
    calcium_score REAL,
    summary TEXT,
    related_persons TEXT,
    impact TEXT DEFAULT 'medium',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON master_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_date ON master_events(date);

-- P0-3: 幻觉校验日志（自省模块输入源）
CREATE TABLE IF NOT EXISTS hallucination_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reply_hash TEXT NOT NULL,
    reply_preview TEXT NOT NULL,
    hallucinated_names TEXT NOT NULL,
    known_names TEXT,
    severity TEXT NOT NULL DEFAULT 'low',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hallucination_created ON hallucination_log(created_at);