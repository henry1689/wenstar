# M4 知识融合与检索层 · 设计文档

> **文档状态**: Pre-Design Draft（待评审）  
> **关联规格书**: `docs/project-spec-v1.md` §1.5（系统边界）, §6（M4占位）  
> **关联 ADR**: ADR-004 (M1-M2边界), 待决事项1-5（联网搜索推迟）  
> **版本**: v0.1-design  
> **前置模块**: M1 DNAEncoder, M2 JsonStorageAdapter, M3 LogicOrchestrator  
> **本文件定位**: M4 v1.0 范围仅做"私人记忆检索"，不含联网搜索。家族知识库为图结构，世界知识库推迟。

---

## 第1章 职责边界

### 1.1 M4 做什么

| 职责 | 说明 |
| :--- | :--- |
| **记忆检索** | 根据 M3 的 `locus_path` 和 `entity_genes`，从 M2 JSON 文件中检索相关历史 DNA |
| **上下文压缩** | 将检索到的 JSON 历史数据压缩为自然语言摘要（Context Window Compression） |
| **家族知识查询** | 从图结构家族知识库中查询与当前对话相关的家族成员/地点/事物关系 |
| **知识融合** | 将私人记忆摘要 + 家族知识片段融合为统一的结构化上下文，供 M5 使用 |

### 1.2 M4 不做什么（v1.0 范围）

- ❌ **不联网搜索**（世界知识库推迟到 v2.0）
- ❌ **不修改 DNA**（M4 是只读的）
- ❌ **不生成语言**（那是 M5 的职责）
- ❌ **不调用 LLM**（纯规则驱动 + SQL 查询）

### 1.3 流水线定位

```
M3 (感知+决策) → M4 (记忆检索+知识融合) → M5 (表达生成)
        ↓                       ↓
   M3Decision           M4Context（结构化输入给M5）
```

---

## 第2章 四源数据架构（v1.0 为双源）

### 2.1 四源全景（长期愿景）

| 知识源 | 存储形态 | v1.0 范围 | 说明 |
| :--- | :--- | :--- | :--- |
| **私人记忆轨** | M2 JSON 文件 | ✅ 包含 | 用户与AI的共同经历 |
| **家族知识库** | SQLite 图结构 | ✅ 包含（基础版） | 族谱、关系、家族坐标 |
| **世界知识库** | RAG/外部API | ❌ 推迟 | 历史、文化、公共事件 |
| **AI自我模型** | M6 状态机 | ❌ 推迟 | 自我叙事、核心特质 |

### 2.2 v1.0 聚焦：双源

```
M4 v1.0 = 私人记忆检索 + 家族知识查询
```

---

## 第3章 家族知识库（图结构）

### 3.1 技术选型

| 项目 | 决策 |
| :--- | :--- |
| **存储引擎** | SQLite（轻量嵌入式，零外部依赖） |
| **图结构实现** | 节点表 (nodes) + 边表 (edges)，SQL 递归查询 |
| **存储路径** | `data/knowledge/family_graph.db` |
| **初始化** | M4 initialize() 时自动创建 |

### 3.2 数据模型

```sql
-- 节点表：家族知识库中的实体
CREATE TABLE nodes (
    id TEXT PRIMARY KEY,           -- UUID
    type TEXT NOT NULL,            -- 'person' | 'place' | 'thing' | 'concept'
    name TEXT NOT NULL,            -- 实体名称（标准化）
    aliases TEXT,                  -- 别名列表（JSON array）
    properties TEXT,               -- 属性（JSON object，如 {birth_year:1970, gender:'male'}）
    created_at TEXT NOT NULL,       -- ISO8601
    updated_at TEXT NOT NULL
);

-- 边表：节点之间的关系
CREATE TABLE edges (
    id TEXT PRIMARY KEY,           -- UUID
    source_id TEXT NOT NULL,       -- 源节点 ID（FK -> nodes.id）
    target_id TEXT NOT NULL,       -- 目标节点 ID（FK -> nodes.id）
    relation TEXT NOT NULL,        -- 关系类型，如 'father_of' | 'lives_in' | 'owns' | 'visited'
    properties TEXT,               -- 属性（JSON object，如 {since:2020, note:'老家'}）
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (source_id) REFERENCES nodes(id),
    FOREIGN KEY (target_id) REFERENCES nodes(id)
);

-- 索引
CREATE INDEX idx_nodes_type ON nodes(type);
CREATE INDEX idx_nodes_name ON nodes(name);
CREATE INDEX idx_edges_source ON edges(source_id);
CREATE INDEX idx_edges_target ON edges(target_id);
CREATE INDEX idx_edges_relation ON edges(relation);
```

### 3.3 关系类型定义（v1.0）

| 关系 | 反向关系 | 说明 |
| :--- | :--- | :--- |
| `father_of` / `mother_of` | `child_of` | 亲子关系 |
| `spouse_of` | `spouse_of` | 配偶 |
| `lives_in` | `residence_of` | 居住地 |
| `born_in` | `birthplace_of` | 出生地 |
| `visited` | `visited_by` | 到访过 |
| `owns` | `owned_by` | 拥有（物品/房产） |
| `close_to` | `close_to` | 亲密关系（好友/知己） |
| `works_at` | `employee_of` | 工作场所 |

### 3.4 查询与自动推断接口

```typescript
export interface FamilyGraph {
  findRelated(entityName: string, relation?: string): Promise<GraphQueryResult>;
  findPath(sourceName: string, targetName: string): Promise<GraphPath | null>;
  addNode(node: GraphNode): Promise<void>;
  addEdge(edge: GraphEdge): Promise<void>;

  /**
   * 从 entity_genes 自动推断家族关系并建边
   * 核心策略：自动提取 + 关系推断
   * 触发条件：检测到亲属称谓（妈妈/爸爸/老公等）与人名共现
   */
  integrateFromEntity(entities: EntityGene[], rawInput: string, selfName?: string): Promise<InferenceResult>;

  /** 手动修正关系（兜底：用户指出错误时调用） */
  correctRelation(source: string, target: string, correctRelation: string): Promise<void>;

  /** 手动添加家族成员 */
  addFamilyMember(name: string, relation: string, aliases?: string[]): Promise<void>;

  /** 获取全图谱摘要 */
  getFamilySummary(): Promise<FamilySummary>;
}
```

### 3.5 关系推断算法（自动提取核心）

亲属称谓 → 关系映射表：
- `妈妈/妈/母亲` → `mother_of`
- `爸爸/爸/父亲` → `father_of`
- `老公/老婆/丈夫/妻子` → `spouse_of`
- `哥哥/弟弟/姐姐/妹妹` → `sibling_of`
- `爷爷/奶奶/外公/外婆` → `grandfather_of` / `grandmother_of`

算法：检测文本中"亲属称谓 + 人名"的组合 → 自动建边。

示例：
- 用户说"我妈妈叫李华" → 创建节点`李华`，创建边`用户 --child_of--> 李华`
- 用户说"我老公叫张伟，我们住在深圳" → 创建节点`张伟`和`深圳`，创建配偶和居住边

### 3.6 手动管理接口（兜底修正）

| 方法 | 触发场景 | 说明 |
| :--- | :--- | :--- |
| `handleUserDefinedRelation` | 用户说"记住，X是我的Y" | 直接按用户定义的关系建边 |
| `handleCorrection` | 用户说"不对，他是我哥哥" | 删除旧边，创建正确边 |

---

## 第4章 记忆检索器

### 4.1 检索策略

根据 M3 决策中的 `locus_path` 和 `entity_genes`，从 M2 中检索历史 DNA：

```typescript
retrieveMemories(decision: M3Decision, options?: {
  limit?: number;       // 最多返回条数（默认 5）
  recency?: boolean;    // 是否按时间倒序（默认 true）
  minCalcium?: number;  // 最小钙质阈值（默认 0，全部）
}): Promise<DNA[]>;
```

**检索优先级（按顺序）**：
1. **实体匹配**：`entity_genes` 中的 `person` 和 `place` 名称 → 扫描 M2 index.json 中所有 `raw_input` 包含该实体的记录
2. **话题匹配**：`locus_path` 前缀 → `M2.findByLocus(locusPath)`
3. **时间衰减**：检索结果按 `seq_pos` 降序排列（最新的优先）
4. **钙质过滤**：低于 `minCalcium` 阈值的忽略

### 4.2 上下文窗口压缩

```typescript
compressMemories(dnas: DNA[]): MemorySummary;
```

**压缩策略**：
1. 将每条 DNA 的 `raw_input`、`locus_path`、`created_at` 提取出来
2. 去除冗余（多条相同话题的合并为一条时间线摘要）
3. 输出结构化摘要：

```typescript
export interface MemorySummary {
  /** 时间线：按时间排序的事件列表 */
  timeline: Array<{
    time: string;
    summary: string;        // 一句话摘要
    calcium_level: number;
  }>;
  /** 高频实体统计 */
  frequentEntities: Array<{
    name: string;
    type: string;
    mentionCount: number;
  }>;
  /** 完整时间跨度 */
  timeSpan: {
    earliest: string;
    latest: string;
  };
}
```

---

## 第5章 M4 主控制器

### 5.1 输入输出

```
输入: M3Decision + M3Context
        ↓
流程: 
  ① 从 M3Decision 提取 entity_genes 和 locus_path
  ② MemoryRetriever.retrieveMemories() → 从 M2 捞取历史
  ③ MemoryRetriever.compressMemories() → 压缩为摘要
  ④ FamilyGraph.findRelated() → 从家族知识库查询关联
  ⑤ 融合为 M4Context → 输出给 M5
        ↓
输出: M4Context
```

```typescript
export interface M4Context {
  /** 当前对话的 M3 决策 */
  decision: M3Decision;

  /** 私人记忆摘要 */
  memory_summary: MemorySummary;

  /** 关联的家族知识（如有） */
  family_context?: Array<{
    entity: string;
    relation: string;
    related_entity: string;
  }>;

  /** 当前对话的原始时间戳 */
  current_time: string;

  /** M5 需要用的元数据 */
  meta: {
    has_history: boolean;          // 是否有相关的历史记忆
    has_family_context: boolean;   // 是否有家族知识关联
    calcium_level: number;
    dominant_action: string;
  };
}
```

### 5.2 与 M2 的交互

M4 通过 `StorageAdapter` 接口读取 M2 数据（只读）：
- `M2.findByLocus(locusPath)` → 按话题前缀检索
- `M2.read(branchId)` → 按 branch_id 精确读取（通过 entity 反向查找）

---

## 第6章 交付清单

| 文件 | 说明 |
| :--- | :--- |
| `src/m4/types/index.ts` | M4Context / MemorySummary / FamilyGraph 接口 |
| `src/m4/FamilyGraph.ts` | SQLite 图结构知识库（nodes + edges 表） |
| `src/m4/MemoryRetriever.ts` | 从 M2 检索 + 上下文压缩 |
| `src/m4/M4Orchestrator.ts` | M4 主控制器（编排检索 + 知识查询 + 融合） |
| `src/m4/__tests__/` | 单元测试 |
| `docs/project-spec-v1.md` §6 | 更新为实际实现 |

---

**M4 设计文档结束 — 请评审**
