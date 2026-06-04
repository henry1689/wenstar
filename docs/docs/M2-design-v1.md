# M2 5大语义区存储适配器 · 设计文档

> **文档状态**: **ARCHIVED** — 设计已实现，模块已退役  
> **替代者**: `src/fusion/FusionStorageAdapter`（融合存储，24D 情感向量作为主索引）  
> **关联规格书**: `docs/project-spec-v1.md` §4  
> **关联 ADR**: ADR-004 (M1-M2边界), ADR-002 (分类树), **ADR-006 (本体-标签分离)**  
> **版本**: **v1.0-final**  
> **前置模块**: M1 DNAEncoder (已完成)  
> **变更记录**: v1.0 初始设计 → v1.1 架构纠偏：24维情绪向量 → `emotion_color` 色号标签，更新 §4.1 描述  
> **归档记录 (2026-06-04)**: 本设计已由 `src/fusion/FusionStorageAdapter` 完整继承并增强。"24D 情感向量"不再以 `emotion_color` 标签形式附加在 DNA 上，而是作为 `perception: Perception24D` 成为每一条记忆记录的主索引——这正是本设计开放接口的初衷，8 个方法的抽象能力经由 FusionStorageAdapter 在 SQLite 中获得了完整的实现。

---

## 模块现状

**M2 (`src/m2/`) 当前处于退役状态。** 2026-06-04 的架构清洗中，旧 M2 的所有生产引用已迁移到融合存储：

| 旧 M2 产物 | 迁移目标 | 说明 |
|:---|:---|:---|
| `JsonStorageAdapter` | `FusionStorageAdapter` (`src/fusion/`) | SQLite 主存储 + JSON Zone 备份 |
| `StorageAdapter` 接口 | `fusion/types` 中的 24D 增强版类型 | `WriteResult`/`QueryOptions`/`StorageStatus` 已迁移 |
| `write(dna)` 单参数 | `write(dna, perception)` 双参数 | 24D 情感向量作为强类型第二参数 |
| `findByLocus` / `findBySeqPosRange` | `findByEmotionalSimilarity` / `findBySeqPosRangeWithStrength` | 24D 向量检索 + 衰减门控 |
| 5 个 JSON Zone 文件 | SQLite 6 表 (`memories`/`entities`/`memory_entities`/`entity_relations`/`inductions`/`decay_log`) | 索引化、事务性存储 |
| 旧 SELF 硬编码 | `M6Orchestrator` 动态读取 | 自我模型从 `data/self_model.json` 实时加载 |

**当前仍然引用 `src/m2/` 的文件**：
- `src/webui/maintenance.ts` — 仅在注释中引用 `JsonStorageAdapter`，实际运行时指向 `FusionStorageAdapter`
- `src/cli/sandbox.ts` — 已改用 `FusionStorageAdapter`（2026-06-04 迁移）
- `src/__tests__/e2e.test.ts` — 已改用 `FusionStorageAdapter`（2026-06-04 迁移）

### 迁移后架构对比

```
旧架构 (v1.0):
  M1 DNA → M2.write(dna) → JSON Zone (文本+实体+话题路径)
                                            ↓
                                  M3 24D 感知 → 丢弃 ❌
                                            ↓
                                  M4 findByLocus (仅话题关键词)

新架构 (v2.0):
  M1 DNA → M3 感知 (24D) → FusionStorageAdapter.write(dna, perception)
                                            ↓
                               ┌── SQLite.memories (perception_json + 所有字段)
                               └── JSON Zone (备份)
                                            ↓
                               findByEmotionalSimilarity (24D 加权余弦)
```

**本设计文档保留作为历史参考**，所有新开发请参阅 `src/fusion/FusionStorageAdapter.ts` 和 `src/fusion/types/index.ts`。

---

## 目录

1. [职责边界](#1-职责边界)
2. [架构总览](#2-架构总览)
3. [StorageAdapter 接口定义](#3-storageadapter-接口定义)
4. [5 区物理存储布局](#4-5-区物理存储布局)
5. [JsonStorageAdapter 实现方案](#5-jsonstorageadapter-实现方案)
6. [原子性 seq_pos：counter.json 机制](#6-原子性-seq_poscounterjson-机制)
7. [REF 替换策略：从占位到真实地址](#7-ref-替换策略从占位到真实地址)
8. [查询能力](#8-查询能力)
9. [错误处理与降级策略](#9-错误处理与降级策略)
10. [测试策略与 Hook 要点](#10-测试策略与-hook-要点)
11. [待决事项](#11-待决事项)
12. [交付清单](#12-交付清单)

---

## 1. 职责边界

### 1.1 M2 做什么

| 职责 | 说明 |
| :--- | :--- |
| **持久化 DNA** | 将 M1 产出的 DNA 对象按语义属性写入对应的物理存储区 |
| **REF 分配** | 替换 M1 的占位 ref（`tmp_xxx_NNNNN`）为真实物理地址 |
| **seq_pos 原子化** | 接管 M1 的临时 seq_pos，分配全局单调递增的真实序列号 |
| **5 区物理隔离** | 确保语言、情感、具身、时空、社会图式 5 区数据不混存 |
| **查询能力** | 支持通过 branch_id O(1) 查询、locus_path 前缀查询、seq_pos 范围查询 |
| **灾备** | JSON 文件写失败时的重试或回滚，counter 损坏时的降级恢复 |

### 1.2 M2 不做什么

- ❌ **不修改 DNA 内容**（`entity_genes`、`raw_input` 等字段保持 M1 原样）
- ❌ **不做语义理解**（语义理解是 M1 的职责）
- ❌ **不管理自我模型**（自我模型是 M6 的职责）
- ❌ **不做跨区 JOIN**（铁律：仅通过 DNA 索引关联）
- ❌ **不引入 SQL/NoSQL 数据库依赖**（MVP阶段使用 JSON 文件）

### 1.3 M1-M2 边界总结

| 要素 | M1 产出（临时值） | M2 接管（真实值） |
| :--- | :--- | :--- |
| seq_pos | 会话内临时递增（1, 2, 3...） | 全局原子递增（counter.json） |
| ref | `tmp_emo_00001`（占位ID） | `lang_00001` 或 `emo_00042`（真实地址） |
| 生命周期 | Session 级，resetSession() 清空 | 持久化，跨会话永久有效 |

---

## 2. 架构总览

```
┌──────────────────────────────────────────────────────────────────┐
│  M2: 5大语义区存储适配器                                           │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │              StorageAdapter (interface)                    │    │
│  │  + write(dna): WriteResult                                │    │
│  │  + writeBatch(dnas): WriteResult[]                        │    │
│  │  + read(branchId): DNA | null                             │    │
│  │  + findByLocus(locusPath): DNA[]                          │    │
│  │  + findBySeqPos(range): DNA[]                             │    │
│  │  + nextSeqPos(): number                                   │    │
│  └─────────────┬────────────────────────────────────────────┘    │
│                │ implements                                       │
│  ┌─────────────▼────────────────────────────────────────────┐    │
│  │              JsonStorageAdapter                            │    │
│  │  ┌──────────┬──────────┬──────────┬──────────┬────────┐  │    │
│  │  │ lang_    │ emo_     │ body_    │ space_   │ soc_   │  │    │
│  │  │ store    │ store    │ store    │ store    │ store  │  │    │
│  │  │ .json    │ .json    │ .json    │ .json    │ .json  │  │    │
│  │  └──────────┴──────────┴──────────┴──────────┴────────┘  │    │
│  │                                                           │    │
│  │  ┌───────────────────────────────────────────────────┐    │    │
│  │  │  index.json  (branch_id → zone + position 索引)     │    │    │
│  │  └───────────────────────────────────────────────────┘    │    │
│  │                                                           │    │
│  │  ┌───────────────────────────────────────────────────┐    │    │
│  │  │  counter.json  (全局原子 seq_pos 发生器)             │    │    │
│  │  └───────────────────────────────────────────────────┘    │    │
│  └───────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 文件存储目录结构

```
data/
├── zones/
│   ├── language_semantic_zone.json     # 语言语义区
│   ├── emotion_valence_zone.json       # 情感效价区
│   ├── embodied_perception_zone.json   # 具身感知区
│   ├── spatiotemporal_episode_zone.json # 时空情景区
│   └── social_schema_zone.json         # 社会图式区
├── index.json          # branch_id → {zone, position} 索引
└── counter.json        # 全局序列计数器
```

### 2.2 数据流

```
写入流:
  DNA对象 → StorageAdapter.write(dna)
    ① nextSeqPos() → 获取全局 seq_pos（替换 M1 临时值）
    ② 根据 dna.leaf_zone 确定目标区
    ③ 将 DNA 追加到对应 zone JSON 文件 → 获取 position
    ④ 生成真实 ref: "{zone_abbr}_{position}"
    ⑤ 写入 index.json: { branch_id → {zone, position, seq_pos} }
    ⑥ 返回 WriteResult { success, real_ref, seq_pos }

读取流:
  read("evt_20260602_001")
    ① index.json 中查找 branch_id → {zone, position}
    ② 从对应 zone 文件读取 position 处的记录
    ③ 返回完整 DNA 对象（ref 字段已为真实值）

查询流:
  findByLocus("user.family.*")
    ① 扫描 index.json，筛选所有 locus_path 匹配的记录
    ② 按 seq_pos 降序排列
    ③ 返回 DNA[]（最多 N 条）
```

---

## 3. StorageAdapter 接口定义

```typescript
// Ref: SPEC.md §4.3 预期接口

export interface WriteResult {
  success: boolean;
  real_ref: string;         // 替换后的真实物理地址
  seq_pos: number;          // 全局原子序列号
  error?: string;           // 失败时的错误信息
}

export interface ReadResult {
  dna: DNA | null;
  error?: string;
}

export interface QueryOptions {
  limit?: number;           // 最多返回条数（默认 50）
  offset?: number;          // 偏移量（默认 0）
  ascending?: boolean;      // 是否升序排列（默认 false=降序）
}

export interface StorageAdapter {
  /**
   * 写入一条 DNA 到对应的语义区。
   * 自动分配全局 seq_pos 并替换占位 ref。
   * @throws 如果 DNA 结构不合法
   */
  write(dna: DNA): Promise<WriteResult>;

  /**
   * 批量写入多条 DNA。
   * 每条独立处理，互不影响。
   */
  writeBatch(dnas: DNA[]): Promise<WriteResult[]>;

  /**
   * 按 branch_id 精确查询一条 DNA。
   * O(1) 查找，通过 index.json 定位。
   */
  read(branchId: string): Promise<ReadResult>;

  /**
   * 按 locus_path 前缀查询。
   * 支持通配符（如 "user.family.*"）。
   */
  findByLocus(locusPath: string, options?: QueryOptions): Promise<DNA[]>;

  /**
   * 按 seq_pos 范围查询。
   * 支持 [start, end] 闭区间。
   */
  findBySeqPosRange(start: number, end: number, options?: QueryOptions): Promise<DNA[]>;

  /**
   * 获取下一个全局原子序列号。
   * 由 counter.json 驱动。
   */
  nextSeqPos(): Promise<number>;

  /**
   * 初始化存储系统（创建目录和初始文件）。
   * 在应用启动时调用一次。
   */
  initialize(): Promise<void>;

  /**
   * 获取当前存储状态（用于调试/监控）。
   */
  getStatus(): Promise<StorageStatus>;
}

export interface StorageStatus {
  totalRecords: number;
  zoneCounts: Record<string, number>;
  currentSeqPos: number;
  storagePath: string;
}
```

---

## 4. 5 区物理存储布局

### 4.1 区域与文件映射

| 语义区 | LeafZone 标识 | 文件名 | 存储内容 | 索引缩写 |
| :--- | :--- | :--- | :--- | :--- |
| 语言语义区 | `language_semantic_zone` | `language_semantic_zone.json` | 对话原文、事实陈述 | `lang` |
| 情感效价区 | `emotion_valence_zone` | `emotion_valence_zone.json` | 情绪标签数据（色号格式 #RRGGBB，具体标签映射待 M4/M5 定义） | `emo` |
| 具身感知区 | `embodied_perception_zone` | `embodied_perception_zone.json` | 身体经验描述 | `body` |
| 时空情景区 | `spatiotemporal_episode_zone` | `spatiotemporal_episode_zone.json` | 事件时序、地点坐标 | `space` |
| 社会图式区 | `social_schema_zone` | `social_schema_zone.json` | 族谱、人际规则、自我模型 | `soc` |

### 4.2 存储记录格式

每条 zone 文件是一个 JSON 数组，每个元素为一条存储记录：

```typescript
export interface ZoneRecord {
  /** 写入序号（在 zone 文件中的位置，从 0 开始） */
  position: number;
  /** 全局原子序列号（来自 counter.json） */
  seq_pos: number;
  /** 原始 DNA 对象（不含 leaf_zone — 由所在文件隐式标识） */
  dna: Omit<DNA, 'leaf_zone'>;
  /** 写入时间戳 ISO8601 */
  written_at: string;
}
```

### 4.3 索引文件格式（index.json）

```typescript
export interface IndexEntry {
  branch_id: string;
  zone: string;              // 目标 zone 文件名
  position: number;          // zone 文件中的记录位置
  seq_pos: number;           // 全局序列号
  locus_path: string;        // 用于前缀查询
  created_at: string;        // 创建时间
}

// index.json 顶层结构
export interface IndexFile {
  version: string;
  last_updated: string;
  entries: IndexEntry[];
}
```

### 4.4 计数器文件格式（counter.json）

```typescript
export interface CounterFile {
  version: string;
  lastId: number;            // 当前最大 seq_pos
  updated_at: string;
}
```

---

## 5. JsonStorageAdapter 实现方案

### 5.1 核心实现策略

```
write(dna):
  1. 校验 DNA 对象格式（至少包含 branch_id 和 leaf_zone）
  2. 调用 nextSeqPos() 获取全局 seq_pos
  3. 根据 dna.leaf_zone 确定目标 zone 文件
  4. 读取目标 zone 文件，计算 position = array.length
  5. 构建 ZoneRecord { position, seq_pos, dna: { ...不含leaf_zone... }, written_at }
  6. 将 ZoneRecord 追加到 zone 文件
  7. 构建 IndexEntry 追加到 index.json
  8. 构建真实 ref = "{zone_abbr}_{String(position).padStart(5, '0')}"
  9. 返回 WriteResult { success: true, real_ref, seq_pos }

read(branchId):
  1. 读取 index.json
  2. 查找 entries 中 branch_id === branchId 的项
  3. 如未找到，返回 { dna: null }
  4. 根据项中的 zone 和 position 读取对应的 zone 记录
  5. 还原 DNA（补回 leaf_zone 字段）
  6. 返回 { dna }

findByLocus(locusPath):
  1. 读取 index.json
  2. 筛选 entries 中 locus_path 以 locusPath 前缀开头的项
  3. 按 seq_pos 降序排列
  4. 应用 limit/offset 分页
  5. 从 zone 文件读取完整记录
  6. 返回 DNA[]

findBySeqPosRange(start, end):
  1. 读取 index.json
  2. 筛选 start ≤ seq_pos ≤ end 的项
  3. 按 seq_pos 排序
  4. 从 zone 文件读取完整记录
  5. 返回 DNA[]
```

### 5.2 Zone 缩写映射

```typescript
const ZONE_ABBR_MAP: Record<string, string> = {
  'language_semantic_zone': 'lang',
  'emotion_valence_zone': 'emo',
  'embodied_perception_zone': 'body',
  'spatiotemporal_episode_zone': 'space',
  'social_schema_zone': 'soc',
};

const ZONE_FILE_MAP: Record<string, string> = {
  'language_semantic_zone': 'language_semantic_zone.json',
  'emotion_valence_zone': 'emotion_valence_zone.json',
  'embodied_perception_zone': 'embodied_perception_zone.json',
  'spatiotemporal_episode_zone': 'spatiotemporal_episode_zone.json',
  'social_schema_zone': 'social_schema_zone.json',
};
```

### 5.3 文件读取策略

- 所有文件使用 **UTF-8 编码**
- 每次写操作：**读取全量文件 → 内存修改 → 全量写回**
  - 这是 MVP 阶段能接受的最简方案
  - 未来切换到 SQLite 后，这些逻辑被 StorageAdapter 接口抽象掉
- 写入前先写临时文件（`xxx.json.tmp`），写成功后再重命名为正式文件，防止写中断导致文件损坏

### 5.4 初始化流程（initialize）

```
initialize():
  1. 检查 data/zones/ 目录是否存在，不存在则递归创建
     → 使用 fs.mkdirSync(path, { recursive: true }) 确保多级目录安全创建
  2. 检查 5 个 zone JSON 文件是否存在：
     - 不存在则创建空数组 []
  3. 检查 index.json 是否存在：
     - 不存在则创建 { version: "1.0", last_updated: now, entries: [] }
  4. 检查 counter.json 是否存在：
     - 不存在则创建 { version: "1.0", lastId: 0, updated_at: now }
```

---

## 6. 原子性 seq_pos：counter.json 机制

### 6.1 设计原理

```
counter.json:
{
  "version": "1.0",
  "lastId": 157,
  "updated_at": "2026-06-02T03:30:00.000Z"
}
```

- `lastId` 从 0 开始
- 每次 `nextSeqPos()` 调用：
  1. 读取 counter.json
  2. `newId = lastId + 1`
  3. 将 `lastId` 更新为 `newId`
  4. 使用**先写临时文件再重命名**的策略保证原子性
  5. 返回 `newId`

### 6.2 原子性保证

```typescript
async nextSeqPos(): Promise<number> {
  const counterPath = this.getCounterPath();
  const tmpPath = counterPath + '.tmp';

  // 读取当前值
  const counter = await this.readJSON<CounterFile>(counterPath);
  const newId = counter.lastId + 1;

  // 写入临时文件
  const updated: CounterFile = {
    version: '1.0',
    lastId: newId,
    updated_at: new Date().toISOString(),
  };
  await this.writeJSON(tmpPath, updated);

  // 原子重命名
  await fs.promises.rename(tmpPath, counterPath);

  return newId;
}
```

### 6.3 降级策略

- counter.json 文件损坏 → 重置 lastId = 0，记录警告 `[M2:Counter] counter.json corrupted, reset to 0`
- counter.json 不存在 → 初始化创建，lastId = 0
- 并发写入安全：MVP 为单线程模型，无需考虑并发问题
  - 【待决事项 M2-1】: 未来多线程/多进程场景下，需升级为文件锁或数据库事务

---

## 7. REF 替换策略：从占位到真实地址

### 7.1 REF 格式对比

| 阶段 | ref 格式 | 示例 | 用途 |
| :--- | :--- | :--- | :--- |
| M1 编码后（占位） | `tmp_{zone_abbr}_{5位计数器}` | `tmp_emo_00042` | 会话内唯一，不持久 |
| M2 持久化后（真实） | `{zone_abbr}_{5位position}` | `emo_00042` | 永久地址，可在提取时 O(1) 定位 |

### 7.2 替换时机

在 `write()` 方法的第 8 步发生：

```typescript
const realRef = `${zoneAbbr}_${String(position).padStart(5, '0')}`;
```

### 7.3 定位能力

给定 `real_ref = "emo_00042"`:
1. 解析 `emo` → `emotion_valence_zone.json`
2. 解析 `00042` → 数组索引位置 42
3. O(1) 读取该记录

---

## 8. 查询能力

### 8.1 精确查询（O(1)）

```typescript
read("evt_20260602_001")
  → index.json 中二分查找 branch_id
  → 获取 { zone: "emotion_valence_zone", position: 42 }
  → 从 zone 文件读取第 42 条记录
  → 返回完整 DNA
```

### 8.2 前缀查询

```typescript
findByLocus("user.family.*")
  → 遍历 index.json entries
  → 筛选 locus_path.startsWith("user.family")
  → 按 seq_pos 降序排序
  → limit 50
  → 返回 DNA[]
```

实现注意：M1 的 locus_path 格式为 `user.{domain}.{subcategory}`，前缀查询天然支持三级粒度：
- `user` → 所有记录
- `user.family` → 所有家庭相关
- `user.family.conflict` → 所有家庭冲突

### 8.3 范围查询

```typescript
findBySeqPosRange(100, 200)
  → 遍历 index.json
  → 筛选 100 ≤ seq_pos ≤ 200
  → 按 seq_pos 排序
  → 返回 DNA[]
```

### 8.4 性能预期（MVP）

| 查询类型 | 时间复杂度 | 预期耗时（1000条记录规模） | 说明 |
| :--- | :--- | :--- | :--- |
| read(branch_id) | O(n) 遍历 → 可优化为 Map | < 5ms | 当前遍历 index.json；可升级为 Map |
| findByLocus | O(n) 遍历 | < 10ms | 全量扫描 index.json |
| findBySeqPosRange | O(n) 遍历 | < 10ms | 全量扫描 index.json |

> **性能注解**: 全量扫描 O(n) 在百万级记录下会成为瓶颈。当前阶段（MVP < 10,000 条）接受此复杂度。代码中应标注 `// FIXME: 百万级数据需建立内存索引 Map<branch_id, IndexEntry> 或 LSM-Tree`。
| 全量写入 | O(1) 追加 | < 5ms | 追加到 zone 文件 + index 文件 |

---

## 9. 错误处理与降级策略

### 9.1 写入失败处理

| 失败场景 | 检测方式 | 处理策略 |
| :--- | :--- | :--- |
| zone JSON 文件写失败 | try/catch 捕获文件写入错误 | 重试 1 次 → 失败返回 `{ success: false, error }` |
| index.json 写失败 | try/catch | 需要回滚 zone 文件写入（删除刚追加的记录） |
| counter.json 写失败 | try/catch | 不写入 zone 和 index，返回错误 |

### 9.2 文件损坏处理

| 场景 | 检测 | 处理 |
| :--- | :--- | :--- |
| JSON 解析失败 | `JSON.parse` 异常 | 记录错误日志 `[M2] File xxx.json parse error`；返回错误 |
| 文件不存在 | `fs.existsSync` 检查 | `initialize()` 时自动创建 |
| 空文件 | 文件大小为 0 | 视为空数组 `[]` |
| counter.json 损坏 | 解析失败或 lastId 不是数字 | 重置 lastId = 0，记录警告，继续运行 |

### 9.3 输入校验

虽然 M1 保证产出的 DNA 格式正确，但 M2 作为数据持久化的闸口，**必须有输入校验**:

```typescript
// Ref: SPEC.md §3.3 接口契约 — 待决事项 3-3 决议：运行时校验下沉到 M2
function validateDNA(dna: unknown): dna is DNA {
  if (!dna || typeof dna !== 'object') return false;
  const d = dna as Record<string, unknown>;
  return (
    typeof d.branch_id === 'string' &&
    typeof d.locus_path === 'string' &&
    typeof d.leaf_zone === 'string' &&
    Array.isArray(d.entity_genes) &&
    typeof d.raw_input === 'string'
  );
}
```

待决事项 3-3 明确决议"运行时校验下沉到 M2 入口层"——这就是实施位置。

### 9.4 特殊值处理

| 输入 | 处理 |
| :--- | :--- |
| 空 DNA 数组 | 返回空 WriteResult 数组 |
| 缺少 leaf_zone 的 DNA | 返回 `{ success: false, error: 'Missing leaf_zone' }` |
| 重复 branch_id | 基于 index.json 检测，返回 `{ success: false, error: 'Duplicate branch_id' }` |
| 超长 raw_input (>10000 字符) | 正常写入（存储层不做截断，留给 M5 表达层处理） |

---

## 10. 测试策略与 Hook 要点

### 10.1 单元测试覆盖

| 测试类别 | 测试用例 | 数量 |
| :--- | :--- | :--- |
| **StorageAdapter 接口** | write + read = 完整闭环 | 3 |
| **5 区隔离** | 写入 5 条不同 leaf_zone 的 DNA，验证各存各的文件 | 1 |
| **seq_pos 递增** | 连续写入 100 条，验证严格 +1 递增 | 2 |
| **REF 替换** | M1 占位 ref 被替换为真实 ref（非 `tmp_` 开头） | 2 |
| **index 一致性** | 写入后 index.json 有对应条目，且 zone/position 正确 | 2 |
| **查询** | branch_id 精确查询、locus_path 前缀查询、范围查询 | 4 |
| **空数据** | 读取不存在的 branch_id → null | 1 |
| **初始化** | 空目录 → initialize() 后自动创建所有文件 | 1 |
| **counter 损坏** | counter.json 为空/损坏 → 降级为 0 不崩溃 | 2 |
| **批量写入** | writeBatch 10 条，验证全部成功 | 1 |
| **性能** | 单条写入 ≤30ms | 1 |

### 10.2 Hook 要点

| Hook 类型 | 断言 | 参考测试文件 |
| :--- | :--- | :--- |
| **输入契约** | 接收合法 DNA、拒绝缺字段 DNA | `contract.test.ts` |
| **输出契约** | 返回 real_ref（非 tmp_ 开头），seq_pos > 0 | `contract.test.ts` |
| **铁律：5 区隔离** | 写入 5 区数据后，各文件包含且仅包含本区数据 | `ironclad.test.ts` |
| **铁律：seq_pos 递增** | 100 次写入严格 +1 递增 | `ironclad.test.ts` |
| **降级：counter 损坏** | counter.json 清空后，系统自动重置不崩溃 | `fallback.test.ts` |
| **降级：zone 文件损坏** | 手动删除 zone 文件后，initialize 重建空文件 | `fallback.test.ts` |

### 10.3 M2 交付检查清单（待 M2 编码完成后逐项确认）

```markdown
## M2 交付检查清单

### 编码前
- [ ] 已复述 M2 核心约束（已执行）
- [ ] 设计文档已输出并获决策者确认
- [ ] 【待决事项 M2-1】已明确

### 编码后
- [ ] 所有单元测试通过
- [ ] 类型检查通过（tsc --noEmit）
- [ ] 5 区隔离测试通过
- [ ] seq_pos 递增测试通过
- [ ] REF 替换测试通过
- [ ] 降级测试覆盖 counter 损坏 + zone 文件损坏
- [ ] 自修闭环完成

### 文档
- [ ] 规格书 §4 已更新（写入设计文档的最终实现）
- [ ] M2 涉及的新 ADR 已归档
- [ ] 注释包含 SPEC.md 章节引用

### 最终
- [ ] 决策者已签字通过
```

---

## 11. 待决事项

【待决事项 M2-1】: 未来多线程/多进程场景下的 counter.json 并发安全性。当前 MVP 为单线程模型，使用先写临时文件再重命名的策略保证单线程原子性。是否需要预留文件锁接口？
- 建议: 当前不实施，但要求在 `nextSeqPos()` 的代码注释中标记 `// TODO: 多线程场景下需要文件锁或数据库事务`
- 决议时间: M2 编码前

---

## 12. 交付清单

M2 模块编码完成后，以下文件将被创建/更新：

### 新增文件

| 文件 | 内容 |
| :--- | :--- |
| `src/m2/StorageAdapter.ts` | StorageAdapter 接口定义 |
| `src/m2/JsonStorageAdapter.ts` | JsonStorageAdapter 实现 |
| `src/m2/types/index.ts` | M2 专用类型（WriteResult, ReadResult, ZoneRecord 等） |
| `src/m2/__tests__/StorageAdapter.test.ts` | 接口契约测试 |
| `src/m2/__tests__/JsonStorageAdapter.test.ts` | JSON 存储实现测试 |
| `src/m2/__tests__/Counter.test.ts` | counter.json 机制测试 |
| `data/zones/`（运行时创建） | 5 个 zone JSON 文件 |
| `data/counter.json`（运行时创建） | 计数器 |
| `data/index.json`（运行时创建） | 索引 |

### 更新文件

| 文件 | 更新内容 |
| :--- | :--- |
| `docs/project-spec-v1.md` §4 | 填入 M2 设计文档的最终实现 |
| `docs/adr/` | 如需，新增 M2 相关 ADR |

---

**M2 设计文档结束 — 请评审**

*注：本文件仅描述设计，不含任何业务代码实现。评审通过后将进入编码阶段。*
