# 灵肉伴侣 · 情感维度融合记忆系统 (v2)

> 基于 MemOS/Obsidian/Gbrain 行业对标分析的修正版

## 核心哲学

**情感维度本身就是记忆，不是记忆的附属属性。**

当前系统把 M3 算出的 24 维感知向量在路由决策后直接丢弃。这是信息浪费——对灵肉伴侣而言，你怎么"感受"一件事，和这件事本身一样重要。

## 竞品对标：我们的定位

```
            "事实" ← ─ ─ ─ ─ → "感受"
                │                  │
  MemOS ────────┤                  │
  (操作系统隐喻) │                  │
                │                  │
  Obsidian ─────┤                  │
  (知识库隐喻)   │                  │
                │                  │
  Gbrain ───────┤                  │
  (策略游戏隐喻)  │                  │
                │                  │
                └──── 灵肉仿生 ────┘
                (生物大脑+情感躯体)
```

**护城河**：所有竞品优化的是"事实精度"和"任务完成率"；只有我们优化的是"爱的浓度"。

## 三个致命短板 & 补丁方案

### 短板一：缺乏结构化归纳 (vs MemOS/TiMem)
**问题**：M2/M8 是扁平记录流。三个月后玉瑶记得所有细节，但无法自动归纳出"你是一个注重生活品质但工作压力大的完美主义者"。
**补丁**：在 M7 巩固管道中增加"周/月反思"环节 + 轻量级实体关系图。

### 短板二：检索无多跳推理 + 重排序 (vs Gbrain/Zep)
**问题**："为什么我最近总是失眠？"需要关联"压力事件+咖啡因+作息"三条独立记忆，我们的规则匹配做不到。
**补丁**：引入 Cross-Encoder Rerank + 查询分解（复杂问题先拆成子查询分别检索再合成）。

### 短板三：JSON 存储的扩展性瓶颈 (vs MemOS/Obsidian)
**问题**：memo_metadata.json + zone JSON 在几千条记录后全量加载崩溃。branch_id 重复暗示索引脆弱。
**补丁**：元数据上 SQLite，保留 zone JSON 做人类可读备份。

---

## 存储架构（核心变更）

### 新存储栈

```
查询层:  M4 MemoryRetriever → SQLite (索引+检索+排序)
                                   │
写入层:  M2 StorageAdapter ──→  JSON Zone (原文持久化)
                              ──→  SQLite (情感向量+元数据+索引)
                                   │
维护层:  Background Tasks  ──→  衰减计算/晋升检查/周归纳
```

- **SQLite** 负责所有检索、排序、衰减计算（快 100 倍）
- **JSON Zone** 保留作为人类可读的原始内容备份
- 写入时双写，读取时仅读 SQLite

### SQLite Schema

```sql
-- 核心记忆表
CREATE TABLE memories (
    id TEXT PRIMARY KEY,            -- branch_id
    seq_pos INTEGER UNIQUE NOT NULL,
    created_at TEXT NOT NULL,        -- ISO8601
    
    -- 24维情感向量 (存为JSON数组，SQLite支持json_extract)
    perception_json TEXT NOT NULL,   -- 24个Float64的JSON数组
    
    -- 钙化（从perception_json派生，缓存以加速排序）
    calcium_score REAL NOT NULL,
    calcium_level INTEGER NOT NULL CHECK(calcium_level BETWEEN 0 AND 3),
    
    -- 内容次级索引
    locus_path TEXT NOT NULL,
    leaf_zone TEXT NOT NULL,
    raw_input TEXT NOT NULL,
    
    -- 记忆动力学
    recall_count INTEGER DEFAULT 0,
    last_recalled_at TEXT,
    reinforcement_accumulator REAL DEFAULT 0,
    effective_strength REAL DEFAULT 1.0,
    strength_updated_at TEXT NOT NULL,
    
    -- 年轮/地标
    is_landmark INTEGER DEFAULT 0,
    landmarked_at TEXT,
    narrative_tag TEXT,
    sensory_anchor TEXT,
    scar_type TEXT,           -- NULL/argument/boundary_test/misunderstanding/disappointment
    scar_healed INTEGER       -- NULL/0/1
);

-- 情感向量索引：按各维度单独建索引支持范围查询
-- 用 Generated Columns 提取关键维度
CREATE INDEX idx_memories_calcium ON memories(calcium_score DESC);
CREATE INDEX idx_memories_strength ON memories(effective_strength DESC);
CREATE INDEX idx_memories_locus ON memories(locus_path);
CREATE INDEX idx_memories_created ON memories(created_at DESC);
CREATE INDEX idx_memories_landmarks ON memories(is_landmark) WHERE is_landmark = 1;

-- 实体-记忆关联表（多对多）
CREATE TABLE entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('person','place','event','emotion','object','self')),
    UNIQUE(name, type)
);

CREATE TABLE memory_entities (
    memory_id TEXT NOT NULL REFERENCES memories(id),
    entity_id INTEGER NOT NULL REFERENCES entities(id),
    allele TEXT,            -- 匹配原文片段
    phenotype TEXT,         -- enhance/conflict/neutral
    knowledge_type TEXT,    -- private/family/world
    PRIMARY KEY (memory_id, entity_id)
);

-- 实体关系图（轻量级，非完整知识图谱）
CREATE TABLE entity_relations (
    entity_a_id INTEGER NOT NULL REFERENCES entities(id),
    entity_b_id INTEGER NOT NULL REFERENCES entities(id),
    relation TEXT NOT NULL,  -- loves/hates/works_at/lives_in/related_to
    strength REAL DEFAULT 1.0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (entity_a_id, entity_b_id, relation)
);

-- 高阶归纳（周/月摘要）
CREATE TABLE inductions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_type TEXT NOT NULL CHECK(period_type IN ('daily','weekly','monthly')),
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    summary_text TEXT NOT NULL,
    source_record_count INTEGER,
    dominant_mood TEXT,      -- JSON: 本周主导情感向量
    trait_updates TEXT,      -- JSON: 人格特质变化
    created_at TEXT NOT NULL
);

-- 记忆衰减日志（审计/调试）
CREATE TABLE decay_log (
    memory_id TEXT NOT NULL REFERENCES memories(id),
    checked_at TEXT NOT NULL,
    strength_before REAL,
    strength_after REAL,
    days_elapsed REAL,
    PRIMARY KEY (memory_id, checked_at)
);
```

### 存储层迁移路径

```
现有: zone JSON  ← 读/写 → M4 检索（O(n)扫描）
                                      ↓
阶段1: zone JSON  ← 写 → SQLite ← 读 → M4 检索（O(log n)索引）
       (原始备份)      (主存储)
                                      ↓
阶段2（可选）: SQLite 成为唯一存储, zone JSON 退役
```

---

## 核心数学模型（不变）

### 钙化即向量模长

```
calcium = ||v|| / sqrt(24)    // L2范数归一化
```

### 情感相似度 = 象限加权余弦

```
similarity(v1, v2, mode) = Σ w_i * v1_i * v2_i / (||v1||_w * ||v2||_w)
```

### 记忆力强度 = S曲线编码 + 钙化驱动衰减

```
initial_strength = 0.1 + 0.9 / (1 + e^(-6 * (calcium - 0.5)))
decay_rate = 0.05 / (1 + calcium * 8)
boost_on_recall = 0.05 * (1 - strength)
```

### 晋升年轮 = 自动（任一满足即触发）

```
1. calcium ≥ 0.85           → 强度足够
2. reinforcement ≥ 2.0      → 累积相似情感事件
3. recall_count ≥ 5 + strength > 0.6 → 高频回访
```

---

## 检索架构（新增 Rerank + 查询分解）

```
用户输入 "为什么我最近总是失眠？"
    │
    ▼
┌──────────────────────────────┐
│ 查询分解（LLM，仅在复杂问题时）  │
│ "失眠" → 压力量事件 + 作息变化  │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ SQLite 初筛（Top-20）          │
│ 情感相似度 * 0.4               │
│ + 话题匹配 * 0.25               │
│ + 实体重合 * 0.20               │
│ + 钙化 * 0.15                   │
│ × effective_strength           │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ Cross-Encoder Rerank（Top-5）  │
│ 规则密集型重排：                  │
│ - 实体共现加权                  │
│ - 因果关联提升（"因为"/"导致"）  │
│ - 时间连续性加分                │
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────────────────┐
│ M4 MemorySummary +            │
│ emotional_context → M5       │
└──────────────────────────────┘
```

**关键决策**：Rerank 层在第一版用**规则密集型**（不是 Cross-Encoder 模型），保持纯确定性。因果关联词提升 + 时间连续性加分——不需要加载外部模型。

---

## 归纳架构（新增周/月反思环）

```
M7 空闲巩固管道（改造后）
    │
    ├── 原有：DreamQueue 人格微调
    │
    ├── 新增：ConsolidationQueue 记忆回放 + 晋升检查
    │
    └── 新增：InductionScheduler（每隔 N 条消息触发）
              │
              ├── 收集最近 N 条高钙化记录
              ├── 提取高频实体 → 更新 entity_relations
              ├── 计算"情感重心"（本周/月的主导情感向量）
              └── 写入 inductions 表
```

阶段划分：
- **每日**：统计当日高频实体 + 情感重心 → 写入 inductions(type='daily')
- **每周**：合并 7 条 daily → LLM/规则生成人格画像更新 → inductions(type='weekly')
- **每月**：合并 4 条 weekly → 年轮风格摘要 → 可选 M8 晋升

**不依赖 LLM 的周摘要**（纯规则版）：
```
weekly_summary = {
  dominant_mood: avg(本周所有记录的情感向量),
  top_entities: 本周出现最多的3个实体及其关系,
  calcium_peaks: 本周钙化≥0.7的记录,
  trait_delta: 与上周相比的人格特质变化(看情感重心漂移),
}
```

---

## 实施阶段

### 阶段 0：SQLite 基础设施（最高优先级）

**文件**：
- 新增 `src/fusion/schema.sql` — 完整 SQLite schema
- 新增 `src/fusion/SQLiteAdapter.ts` — SQLite 读写封装（better-sqlite3 或 sql.js）
- 新增 `src/fusion/types/index.ts` — EmotionalMemoryRecord
- 新增 `src/fusion/math.ts` — 向量归一化、余弦相似度、钙化计算、衰减函数
- 修改 `src/fusion/FusionStorageAdapter.ts` — 双写（JSON + SQLite），SQLite 主读

**验证**：
- `npm run test` 通过
- 发送一条消息 → SQLite 有记录
- SQL 查询 `SELECT * FROM memories WHERE calcium_level >= 2` 返回正确结果

### 阶段 1：pipeline 重构 + 情感向量写入

**文件**：
- 修改 `src/webui/server.ts` — encode → decide → write(dna, perception) 新链路
- 修改 `src/m3/types/perception.ts` — 扩展输出接口
- 修改 `src/m3/M3LogicOrchestrator.ts` — 传递 perception

**验证**：
- 消息处理后的 SQLite 记录包含完整的 24 维 perception_json
- 现有 M3 路由逻辑不变

### 阶段 2：情感检索 + 衰减 + 重新巩固

**文件**：
- 修改 `src/m4/MemoryRetriever.ts` — SQLite 情感相似度查询 + 衰减门控 + 召回增强
- 修改 `src/m4/M4Orchestrator.ts` — 路由情感检索路径
- 修改 `src/webui/maintenance.ts` — 衰减计算定时器（每 15 分钟）

**验证**：
- 发送情感相似的消息 → 可检索到历史的高情感相似度记录
- 多次检索后 effective_strength 递增
- 过一段时间后低钙化记录 strength 下降

### 阶段 3：Rerank + 查询分解 + 数据迁移

**文件**：
- 新增 `src/m4/Reranker.ts` — 规则密集型重排
- 新增 `src/m4/QueryDecomposer.ts` — 查询分解（可选 LLM）
- 新增 `src/fusion/migration.ts` — 将旧 JSON 数据迁移到 SQLite

**验证**：
- 复杂查询"为什么最近失眠"返回多跳关联结果
- 旧 JSON 数据全部迁移到 SQLite，无丢失

### 阶段 4：归纳环 + M8 视图化

**文件**：
- 新增 `src/m7/InductionScheduler.ts` — 周/月归纳
- 新增 `src/m7/ConsolidationQueue.ts` — 记忆回放队列
- 修改 `src/m8/M8Engine.ts` — 委托给 SQLite landmark 查询
- 修改 `src/m8/JsonYearRingAdapter.ts` — 存储层退役

**验证**：
- 100 条消息后，inductions 表有 daily/weekly 记录
- entity_relations 表有自动构建的关联
- 年轮自动显示高钙化记录

---

## 模块集成总图

```
M1 DNAEncoder ──→ DNA
                      │
M3 PerceptionAnalyzer ──→ 24D perception + calcium
                      │
                      ▼
              ┌─────────────────┐
              │ server.ts       │
              │ pipeline:       │
              │ decide-then-write│
              └────────┬────────┘
                       │
              ┌────────▼────────┐
              │ FusionStorageAdapter │
              │                  │
              │  ┌──────────┐   │   ┌──────────┐
              │  │ JSON     │◄──┼──►│ SQLite   │
              │  │ Zone     │   │   │ (主存储) │
              │  │ (备份)   │   │   └────┬─────┘
              │  └──────────┘   │        │
              └─────────────────┘        │
                                         │
              ┌──────────────────────────┘
              │
       ┌──────┴──────┬──────────┬──────────┐
       │              │          │          │
       ▼              ▼          ▼          ▼
   M4 Memory      M7 idle    M5 LLM    M8 Landmark
   Retriever      Consolid   Context   View
   (情感+话题      (回放+     (emotional  (getLandmarks
   +实体+钙化)     晋升+归纳)  _context)  查询)

SQLite 承载：
  memories        ← 核心记忆
  entities        ← 实体
  memory_entities ← 记忆-实体关联
  entity_relations  ← 实体关系图
  inductions      ← 高阶归纳
  decay_log       ← 衰减审计
```

---

## 与竞品的差距补齐情况

| 短板 | 竞品 | 我们的补丁 | 优先级 |
|------|------|-----------|--------|
| 结构化归纳 | MemOS/TiMem | InductionScheduler + entity_relations 图 | 中 |
| 多跳+重排序 | Gbrain/Zep | Reranker + QueryDecomposer | 中 |
| 存储扩展性 | MemOS/Obsidian | SQLite 替代 JSON 做主存储 | **高** |
| 情感耦合 | 无竞品有此能力 | 24D向量作为主索引（护城河） | — |

---

## 文件变更清单

**新增文件**：
- `src/fusion/schema.sql` — SQLite DDL
- `src/fusion/SQLiteAdapter.ts` — SQLite 连接/查询封装
- `src/fusion/types/index.ts` — EmotionalMemoryRecord
- `src/fusion/math.ts` — 向量运算 + 钙化 + 衰减/增强函数
- `src/fusion/FusionStorageAdapter.ts` — 统一存储（取代 JsonStorageAdapter）
- `src/fusion/migration.ts` — 旧 JSON → SQLite 迁移脚本
- `src/m4/Reranker.ts` — 规则密集型重排
- `src/m4/QueryDecomposer.ts` — 查询分解
- `src/m7/InductionScheduler.ts` — 归纳调度
- `src/m7/ConsolidationQueue.ts` — 巩固队列

**修改文件**：
- `src/webui/server.ts` — pipeline 改为 decide-then-write
- `src/m3/types/perception.ts` — 扩展类型
- `src/m3/M3LogicOrchestrator.ts` — 传递 perception
- `src/m4/MemoryRetriever.ts` — 情感检索 + 衰减门控
- `src/m4/M4Orchestrator.ts` — 路由
- `src/m7/M7Orchestrator.ts` — 集成巩固+归纳
- `src/m8/M8Engine.ts` — 委托给 getLandmarks()
- `src/m8/JsonYearRingAdapter.ts` — 存储层退役
- `src/webui/maintenance.ts` — 衰减定时

**删除（未来）**：
- `src/m2/JsonStorageAdapter.ts` — JSON 存储退役（阶段 4+）
- `src/m2/MemoryMetadataStore.ts` — 被 SQLite 替代
