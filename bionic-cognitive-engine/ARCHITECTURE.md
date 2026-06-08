# 仿生智脑 v1.1 · 架构蓝皮书

> **系统**: 仿生智脑 (Bionic Cognitive Engine)  
> **掌管者**: 景幻仙姑 — 纯粹理性的知识引擎  
> **调用者**: 玉瑶（通过 REST API 7200）  
> **版本**: v1.1 · 企业级分布式架构  
> **建成年月**: 2026-06-08  
> **定稿人**: 鸿鸣 · Claude Code 珂珂  

---

## 零、总纲 · 灵魂定义

> **用户默认不感知后台运作，就像人不感知自己的海马体怎么工作。**  
> **但用户随时可以打开管理面板——查看、上传、修改、删除三库资料。**  
>
> 默认不参与 ≠ 不能参与。  
> 用户心安，因为知识资产看得见摸得着，**掌控在自己手里**。

### 四个坚持（红线——碰了就要砍掉）

| # | 坚持 | 红线 |
|---|------|------|
| 💎 | **默认不打扰** — 用户在聊天，玉瑶自然回答。后台自己转 | ❌ 强迫用户操作才能完成知识管理 |
| 💎 | **但可管理** — `/api/v1/docs/*` 全部开放给用户：查看、上传、修改、任意删除 | ❌ 用户想管却找不到入口 |
| 💎 | **人脑记忆模型** — 存的是事件、场景、感受。金库=原声带，黑钻=精选歌单 | ❌ 记忆退化成关键词匹配 |
| 💎 | **越用越好用** — 半衰期机制，用进废退。活跃资料走高速通道 | ❌ 活跃资料被沉寂资料淹没 |

### 三大铁律

```
快：入库毫秒级（不做复杂语义）。检索 < 200ms。用户不感知等待。
准：搜到的就是想要的。前3条命中率 > 85%。
精：不给用户看原文拼凑。给用户看提炼、总结、结构化输出。
```

---

## 一、技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| Web 框架 | **FastAPI** (Python 3.11+) | REST API 服务（端口 7200） |
| 任务队列 | **Celery + Redis** | 做梦模式/提炼/维护 异步处理 |
| 主数据库 | **PostgreSQL 16** | 三库元数据 + 事件存储 |
| 向量数据库 | **Qdrant** | 24D 情感向量检索 |
| 对象存储 | **MinIO** | 砂金库原始文件存储 |
| ORM | **SQLAlchemy 2.0** (async) | 数据库模型 |
| 容器化 | **Docker Compose** | 一键拉起全部依赖 |
| 加密 | **AES-256-GCM** | 敏感文件加密 |

---

## 二、项目目录结构 (DDD)

```
bionic-cognitive-engine/
│
├── main.py                         # FastAPI 入口（端口 7200）
├── .env.example                    # 全部环境变量模板
├── requirements.txt                # 13 个生产依赖
│
├── Dockerfile                      # API 服务容器
├── Dockerfile.celery               # Celery Worker 容器
├── docker-compose.yml              # 7 个服务一键拉起
│
├── ARCHITECTURE.md                 # ← 本文档
│
├── app/
│   ├── __init__.py
│   │
│   ├── api/                        # 网关与路由层
│   │   ├── routes.py               # 14 个 REST 端点（含 /api/v1/docs/*）
│   │   ├── schemas.py              # Pydantic 请求/响应模型
│   │   └── deps.py                 # 依赖注入 + Bearer Token 认证
│   │
│   ├── core/                       # 核心业务逻辑
│   │   ├── config.py               # pydantic-settings 配置管理
│   │   ├── refiner.py              # 记忆提炼器 (MemoryConsolidator)
│   │   ├── decay_scheduler.py      # 半衰期调度器 (DecayManager)
│   │   ├── retrieval.py            # 混合检索引擎 (HybridSearchService)
│   │   └── iqc_engine.py           # IQC 质检引擎
│   │
│   ├── domain/                     # 领域模型
│   │   ├── models.py               # SQLAlchemy ORM (4张核心表 + user_id + is_deleted)
│   │   └── enums.py                # 枚举类型
│   │
│   ├── infrastructure/             # 基础设施
│   │   ├── database.py             # PostgreSQL 连接管理
│   │   ├── vector_store.py         # Qdrant 客户端
│   │   ├── storage.py              # MinIO 客户端
│   │   ├── llm_client.py           # LLM HTTP 客户端
│   │   └── task_queue.py           # Celery 配置
│   │
│   └── security/                   # 安全层
│       ├── encryption.py           # AES-256-GCM 加密
│       └── ...IQC 质检规则
│
├── tasks/                          # Celery 异步任务
│   ├── celery_app.py               # Celery 应用定义
│   ├── consolidate.py              # 记忆提炼任务
│   └── housekeeping.py             # 半衰期维护任务
│
└── tests/                          # 测试（TODO）
    ├── conftest.py
    ├── test_api.py
    └── test_retrieval.py
```

---

## 三、数据模型（三库核心）

### 3.1 金库表: `gold_dialogues` — 无损原声带

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID, PK | 主键 |
| `topic` | VARCHAR(255) | 话题 |
| `raw_dialogue` | JSONB | **完整对话列表** [{role, content}] |
| `emotion_vector` | ARRAY(Float) | **24D 情感向量数组**（灵魂字段——曲谱不可丢失） |
| `tags` | JSONB | 标签数组（懒加载） |
| `is_active` | BOOLEAN | 是否活跃 |
| `is_refined` | BOOLEAN | 是否已提炼为黑钻 |
| `vector_id` | VARCHAR(64) | Qdrant 向量点 ID |
| `user_id` | VARCHAR(36) | **归属用户 ID**（用户管理用） |
| `is_deleted` | BOOLEAN | **软删除标记**（默认为 false） |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

### 3.2 黑钻库表: `black_diamond_events` — 精选歌单

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID, PK | 主键 |
| `event_id` | VARCHAR(50), UNIQUE | 业务事件 ID (`evt_xxx`) |
| `event_type` | VARCHAR(50) | 事件类型 |
| `occurred_at` | TIMESTAMPTZ | 事件发生时间 |
| `core_facts` | TEXT | **核心事实**（LLM 提炼摘要） |
| `decisions` | JSONB | **关键决策列表** |
| `emotional_spectrum` | JSONB | **情感曲谱总结** {summary, curve, dominant_emotion, user_sentiment} |
| `gold_references` | JSONB | **引用金库 ID 列表** |
| `decay_days` | INTEGER | 已存在天数 |
| `last_accessed_at` | TIMESTAMPTZ | 最后访问时间 |
| `is_active` | BOOLEAN | 是否活跃（活跃=高速通讯公路） |
| `tags` | JSONB | 标签 |
| `vector_id` | VARCHAR(64) | Qdrant 向量点 ID |
| `user_id` | VARCHAR(36) | **归属用户 ID**（提炼时从金库继承） |
| `is_deleted` | BOOLEAN | **软删除标记**（停止衰减计算） |
| `created_at` | TIMESTAMPTZ | 创建时间 |
| `updated_at` | TIMESTAMPTZ | 更新时间 |

### 3.3 砂金库表: `alluvial_records` — 原材料矿井

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | UUID, PK | 主键 |
| `file_path` | TEXT | 原始文件路径 |
| `file_hash` | VARCHAR(64) | SHA256 哈希 |
| `file_size` | BIGINT | 文件大小 |
| `status` | VARCHAR(20) | raw → qc_pending → approved / rejected / archived |
| `minio_object_key` | VARCHAR(255) | MinIO 对象键 |
| `source_name` | VARCHAR(255) | 源文件名 |
| `checksum_verified` | BOOLEAN | 校验是否通过 |
| `user_id` | VARCHAR(36) | **归属用户 ID** |
| `is_deleted` | BOOLEAN | **软删除标记** |

---

## 四、API 接口契约

### 4.1 用户资料管理接口（Docs API — 面向用户界面）

**前缀**: `/api/v1/docs/`  
**用户视角**: 我只看到"我的资料"，不感知三库底层  
**权限**: 只能操作自己的资料（`user_id` 自动匹配）  
**所有操作同步响应**（不走 Celery），保证掌控感

| 方法 | 路径 | 说明 | 用户看到的是 | 响应 |
|------|------|------|-------------|------|
| `GET` | `/api/v1/docs/gold` | 📚 我的原声带列表 | 话题列表+情感摘要 | 分页列表 |
| `GET` | `/api/v1/docs/gold/{id}` | 📖 原声回放 | 完整对话+24D情感曲谱 | 详情 |
| `GET` | `/api/v1/docs/diamonds` | 💎 我的精选记忆列表 | 事件摘要+情感标签 | 分页列表 |
| `GET` | `/api/v1/docs/diamonds/{id}` | 💎 精选记忆详情 | 核心事实+决策+情感曲线 | 详情 |
| `POST` | `/api/v1/docs/upload` | 📤 上传资料 | 选择文件→上传→秒回 | 入库结果 |
| `PUT` | `/api/v1/docs/diamonds/{id}` | ✏️ 修改精选记忆 | 编辑内容→保存 | 更新后详情 |
| `DELETE` | `/api/v1/docs/gold/{id}` | 🗑️ 删除原声带 | 确定删除→即时消失（可恢复） | 删除确认 |
| `DELETE` | `/api/v1/docs/diamonds/{id}` | 🗑️ 删除精选记忆 | 确定删除→停止衰减 | 删除确认 |

### 4.2 核心操作接口（景幻仙姑自动处理）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/health` | 健康检查 |
| `GET` | `/api/v1/stats` | 三库统计 |
| `POST` | `/api/v1/ingest` | 砂金入库（系统级） |
| `GET` | `/api/v1/search` | 混合检索（玉瑶调用） |
| `GET` | `/api/v1/diamonds` | 黑钻列表（系统级） |
| `POST` | `/api/v1/diamonds` | 创建黑钻事件 |
| `DELETE` | `/api/v1/diamonds/{id}` | 降级黑钻 |
| `POST` | `/api/v1/refine` | 手动触发提炼 |

### 4.3 用户视角 vs 系统视角

```
用户界面（玉瑶面板）看到的是：           后台（景幻仙姑）实际是：
┌─────────────────────────┐           ┌─────────────────────────┐
│  📤 上传资料             │           │  POST /api/v1/docs/upload   │
│  📚 我的对话原声带       │    ───►  │  → alluvial_records     │
│  💎 我的精选记忆         │           │  → IQC queue→gold_vault │
│  ✏️ 修改/🗑️ 删除        │           │  → black_diamond_events │
└─────────────────────────┘           └─────────────────────────┘
                                           ⚙️ IQC 质检队列（不可见）
                                           ⚙️ Celery 调度（不可见）
                                           ⚙️ Qdrant 索引（不可见）
                                           ⚙️ 半衰期衰减（不可见）
```

---

## 五、核心流转逻辑

### 5.1 三库一生流转图（带用户归属）

```
用户
  │
  ▼
POST /api/v1/docs/upload  ────► 砂金库 (user_id=当前用户)
                                    状态: qc_pending
                                      │
                              Celery IQC 质检
                                (SHA256去重 + 格式检查 + 评分)
                                      │
                           ┌──────────┴──────────┐
                           ▼                     ▼
                      ✅ approved            ❌ rejected
                           │
                           ▼
                       金库 (GoldVaultEntity)
                         · user_id=当前用户
                         · raw_dialogue(完整原声带)
                         · emotion_vector(24D曲谱保留)
                         · is_refined = false
                           │
                    Celery Beat 每小时触发
                    MemoryConsolidator.consolidate()
                      ┌─ 调用 LLM 提炼 prompt
                      ├─ 解析结构化 JSON
                      ├─ 写入黑钻库 (user_id=从金库继承)
                      ├─ 写入向量库 (Qdrant)
                      └─ 标记 is_refined = true
                           │
                           ▼
                       黑钻库 (BlackDiamondEntity)
                         · user_id=当前用户（继承自金库）
                         · core_facts(核心事实)
                         · decisions(决策)
                         · emotional_spectrum(情感曲谱)
                         · decay_days = 0
```

### 5.2 用户操作流程

```
查看列表:  GET /api/v1/docs/gold?page=1
           → 只返回 user_id=当前用户 AND is_deleted=False
           → 用户看到的是"我的资料"，看不到别人的

查看详情:  GET /api/v1/docs/gold/{id}
           → 同上过滤
           → 用户看到完整对话 + 24D 情感向量

上传资料:  POST /api/v1/docs/upload (multipart)
           → 写入砂金库（带 user_id）
           → 同步返回入库结果
           → 异步 IQC 质检 + 提炼

修改提炼:  PUT /api/v1/docs/diamonds/{id}
           → 同步更新数据库
           → 用户立即看到修改结果
           → 不影响金库原声带

删除资料:  DELETE /api/v1/docs/gold/{id}
           → is_deleted = True（软删除）
           → 前端不再展示
           → 后台保留用于审计或恢复

检索时:    GET /api/v1/search?q=xxx
           → 自动过滤 is_deleted=False
```

### 5.3 记忆提炼 Prompt 格式

```
输入: 金库对话（主题 + 原文 + 24D 情感向量）
输出: 结构化 JSON（见下）

{
  "core_facts": "核心事实总结",
  "decisions": ["决策1", "决策2"],
  "emotional_spectrum": {
    "summary": "情感变化描述",
    "curve": [
      {"phase": "阶段描述", "valence": 0.0~1.0, "arousal": 0.0~1.0}
    ],
    "dominant_emotion": "主导情绪",
    "user_sentiment": "用户态度"
  },
  "tags": ["标签1", "标签2"]
}
```

### 5.4 半衰期衰减逻辑

| 条件 | 动作 | 说明 |
|------|------|------|
| `decay_days < 30` | 活跃 | 参与所有检索（高速通讯公路） |
| `30 ≤ decay_days < 90` | 降级 | `is_active=false`，不参与常规检索 |
| `decay_days ≥ 90` | 归档 | 标记 archived，回归砂金库 |

**用户删除后**：`is_deleted=True` → 不参与衰减计算，不参与检索  
**衰减计数器**：每次检索命中时自动更新 `last_accessed_at`  
**恢复机制**：用户再次访问降级事件时，自动恢复 `is_active=true`，`decay_days=0`

### 5.5 混合检索优先级链

```
GET /api/v1/search?q=xxx
    ① Qdrant 向量检索（24D情感相似度，threshold > 0.75）
    ② ↓ 未命中足够
       PostgreSQL 全文检索（tsvector -> 关键词）
    ③ ↓ 未命中足够
       ILIKE 模糊匹配（降级）
    ④ ↓ 全部未命中
       返回空，记录日志（触发懒加载标签）

所有步骤自动过滤 is_deleted=False
```

### 5.6 IQC 质检流

```
上传 -> MinIO 存储 -> alluvial_records(pending)
    -> Celery task(run_iqc):
        1. SHA256 去重（对比已有 hash）
        2. 格式检查（魔数/编码/非空）
        3. 二进制检测
        4. 基础质量评分
    -> 通过 -> promote_to_gold()（继承 user_id）
    -> 不通过 -> alluvial_records(rejected) + 错误日志
```

---

## 六、Docker 服务架构

```
docker compose up -d

+----------+  +----------+  +----------+  +----------+
|PostgreSQL|  |  Redis   |  |  Qdrant  |  |  MinIO   |
|   :5432  |  |  :6379   |  |  :6333   |  | :9000    |
+----+-----+  +----+-----+  +----+-----+  +----+-----+
     +--------+----+--------+----+--------+----+
              |             |             |
      +-------v------+ +----v------+ +---v-------+
      |  FastAPI     | |  Celery   | |  Celery   |
      |  :7200       | |  Worker   | |  Beat     |
      +--------------+ +-----------+ +-----------+
```

暴露端口：`7200`（API）+ `9001`（MinIO Console）

---

## 七、安全机制

| 保护层 | 措施 |
|--------|------|
| 文件加密 | AES-256-GCM 加密敏感文件后存入 MinIO |
| API 鉴权 | Bearer Token（通过 `API_SECRET_KEY` 配置） |
| 数据隔离 | 所有用户操作按 `user_id` 过滤，用户只能看到自己的资料 |
| 软删除 | 用户删除设 `is_deleted=True`，后台保留，可审计可恢复 |
| 校验链 | 上传 SHA256 -> 存储校验 -> 检索时二次校验 |
| 状态一致性 | IQC 队列状态机 + 死信队列 + 3次重试。重启后恢复 |
| 检索降级 | 向量搜索失效 -> 自动降级全文检索 -> ILIKE |
| 容量预警 | 文件大小限制 100MB（`IQCRules.MAX_FILE_SIZE`） |

---

## 八、文件清单

```
bionic-cognitive-engine/
├── .env.example
├── Dockerfile
├── Dockerfile.celery
├── docker-compose.yml              # 7 服务
├── requirements.txt                # 13 依赖
├── ARCHITECTURE.md                 # 本文档
├── main.py                         # FastAPI 入口
│
├── app/api/routes.py               # 14 端点（含 docs 用户管理）
├── app/api/schemas.py              # Pydantic 模型
├── app/api/deps.py                 # 依赖注入 + 认证
├── app/core/config.py              # 配置管理
├── app/core/refiner.py             # 记忆提炼器
├── app/core/decay_scheduler.py     # 半衰期调度器
├── app/core/retrieval.py           # 混合检索引擎
├── app/core/iqc_engine.py          # IQC 质检引擎
├── app/domain/models.py            # ORM 模型（user_id + is_deleted）
├── app/domain/enums.py             # 枚举
├── app/infrastructure/database.py  # PostgreSQL
├── app/infrastructure/vector_store.py # Qdrant
├── app/infrastructure/storage.py   # MinIO
├── app/infrastructure/llm_client.py # LLM HTTP
├── app/infrastructure/task_queue.py # Celery
├── app/security/encryption.py      # AES-256-GCM
├── tasks/celery_app.py             # Celery 应用
├── tasks/consolidate.py            # 提炼任务
└── tasks/housekeeping.py           # 维护任务
```

---

## 九、TODO

| # | 事项 | 优先级 |
|---|------|--------|
| 1 | Docker Compose 集成测试（7 个容器联调） | 🔴 高 |
| 2 | 单元测试 - API (test_api.py) | 🔴 高 |
| 3 | 单元测试 - 检索引擎 (test_retrieval.py) | 🟡 中 |
| 4 | 连真实 LLM 调优提炼 Prompt 质量 | 🟡 中 |
| 5 | Alembic 数据库迁移脚本 | 🟢 低 |
| 6 | 懒加载标签引擎（首次检索时触发 LLM 打标签） | 🟢 低 |
| 7 | 元素星云图（黑钻事件情感关联网络） | 🟢 低 |
| 8 | 用户认证系统集成（JWT -> user_id） | 🟢 低 |

---

*本文档为仿生智脑 v1.1 架构定稿。任何重大修改必须同步更新此文档。*
