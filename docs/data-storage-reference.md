# 太虚境 · 数据存储清单

> 所有存储位置的完整索引 — 数据库 / 数据文件 / 缓存 / 日志
> 最后更新: 2026-06-28

---

## 一、数据库（SQLite）

### 1.1 核心主库

| 数据库 | 路径 | 大小 | 包含表 |
|:-------|:-----|:---:|:-------|
| **fusion_memory.db** | `D:\wenstar\data\webui\fusion_memory.db` | ~32 MB | conversations(547条), memories(124条), black_diamond(45条), knowledge_base(35条), knowledge_chunks(182块), master_profile(227条), master_affairs(19条), master_network(22条), dream_logs, 等 |

### 1.2 家族图谱库

| 数据库 | 路径 | 包含表 |
|:-------|:-----|:-------|
| **family_graph.db** | `D:\wenstar\data\webui\knowledge\family_graph.db` | nodes(39节点), edges(105边) |
| family_graph.db(副本) | `D:\wenstar\data\knowledge\family_graph.db` | 同上(副本) |

### 1.3 其他数据库

| 数据库 | 路径 | 用途 |
|:-------|:-----|:------|
| vault.db | `D:\wenstar\data\memory-vault\vault.db` | 记忆库备份 |
| conversations.db | `D:\wenstar\data\webui\conversations.db` | 旧版对话库(迁移后保留) |
| audit.db | `D:\wenstar\bionic-cognitive-engine\data\audit.db` | 仿生智脑审计 |
| __m7_test_*.db | `D:\wenstar\__m7_test_*.db` | M7测试库 |

---

## 二、数据库备份

### 2.1 统一备份

| 位置 | 文件格式 | 数量 | 说明 |
|:-----|:---------|:---:|:------|
| `D:\wenstar\data\backups\` | `family_graph_*.db` | ~100个 | 家族图谱每15-30分钟备份 |
| `D:\wenstar\data\backups\` | `knowledge_*.db` | ~100个 | 融合存储每15-30分钟备份 |
| `D:\wenstar\data\backups\` | `vault_*.db` | ~100个 | 记忆库备份 |

### 2.2 记忆库独立备份

| 位置 | 文件格式 | 保留 |
|:-----|:---------|:-----|
| `D:\wenstar\data\memory-vault\backups\` | `vault_2026-06-*.db` | 每日备份，保留约20天 |

### 2.3 历史快照备份

| 位置 | 内容 |
|:-----|:------|
| `D:\wenstar\backups\20260612-171509\` | 2026-06-12全量快照(fusion_memory + family_graph) |

---

## 三、结构化数据（JSON文件）

### 3.1 运行时数据

| 文件 | 路径 | 用途 |
|:-----|:-----|:------|
| **api_keys.json** | `D:\wenstar\data\webui\api_keys.json` | API Key存储 |
| **calendar.json** | `D:\wenstar\data\webui\calendar.json` | 日历事件(旧系统) |
| **reminders.json** | `D:\wenstar\data\webui\reminders.json` | 提醒数据(旧系统) |
| **notes.json** | `D:\wenstar\data\webui\notes.json` | 笔记数据(旧系统) |
| **self_model.json** | `D:\wenstar\data\self_model.json` | M6自我模型持久化 |
| **somatic_memory.json** | `D:\wenstar\data\webui\somatic_memory.json` | 躯体记忆数据 |
| conversations.json | `D:\wenstar\data\webui\conversations.json` | 旧版对话记录 |
| tts_test_response.json | `D:\wenstar\data\webui\tts_test_response.json` | TTS测试响应 |

### 3.2 梦境与归纳

| 文件/目录 | 路径 | 数量 |
|:----------|:-----|:----:|
| **pending_dreams.json** | `D:\wenstar\data\dreams\pending_dreams.json` | 待处理梦境队列 |
| **interaction_logs.json** | `D:\wenstar\data\dreams\interaction_logs.json` | 交互日志 |
| **induction_*.json** | `D:\wenstar\data\inductions\` | 75个归纳记录文件 |

### 3.3 观测数据

| 文件/目录 | 路径 | 数量 |
|:----------|:-----|:----:|
| **snapshot-*.json** | `D:\wenstar\data\observation\` | 34个观测快照 |
| quick-checks.json | `D:\wenstar\data\observation\quick-checks.json` | 快速检查结果 |
| final-report.json | `D:\wenstar\data\observation\final-report.json` | 最终观测报告 |

### 3.4 词库与路由

| 文件 | 路径 |
|:-----|:------|
| **emotion_lexicon.json** | `D:\wenstar\data\lexicons\emotion_lexicon.json` |
| **l0_routing.json** | `D:\wenstar\data\lexicons\l0_routing.json` |
| **entity_rules.json** | `D:\wenstar\src\m1\config\entity_rules.json` |
| **taxonomy_v1.json** | `D:\wenstar\src\m1\config\taxonomy_v1.json` |
| **self_model_v1.json** | `D:\wenstar\src\m1\config\self_model_v1.json` |

### 3.5 区域数据 (Zone)

| 文件 | 路径 |
|:-----|:------|
| emotion_valence_zone.json | `D:\wenstar\data\webui\zones\emotion_valence_zone.json` |
| language_semantic_zone.json | `D:\wenstar\data\webui\zones\language_semantic_zone.json` |
| social_schema_zone.json | `D:\wenstar\data\webui\zones\social_schema_zone.json` |

### 3.6 报告

| 文件 | 路径 | 用途 |
|:-----|:-----|:------|
| kb-intimate-scan-*.json | `D:\wenstar\data\reports\` | 知识库亲密内容扫描报告 |
| migration-*.json | `D:\wenstar\data\reports\` | 数据迁移报告 |

### 3.7 测试数据

| 文件 | 路径 |
|:-----|:------|
| critical.json | `D:\wenstar\test\scenarios\critical.json` |
| empathy_baselines.json | `D:\wenstar\test\baselines\empathy_baselines.json` |

---

## 四、文件存储

### 4.1 知识柜（文件同步）

| 目录 | 路径 | 文件数 | 说明 |
|:-----|:-----|:-----:|:------|
| **docs/** | `D:\wenstar\data\knowledge-cabinet\docs\` | 84个 | 知识库文件同步目录 |
| images/ | `D:\wenstar\data\knowledge-cabinet\images\` | 0 | 图片类知识 |
| videos/ | `D:\wenstar\data\knowledge-cabinet\videos\` | 0 | 视频类知识 |
| data/ | `D:\wenstar\data\knowledge-cabinet\data\` | 0 | 数据文件类 |

### 4.2 Markdown同步

| 目录 | 路径 | 文件数 |
|:-----|:-----|:-----:|
| **knowledge-md/** | `D:\wenstar\data\knowledge-md\` | 100个.md文件 |

### 4.3 音频文件

| 目录 | 路径 | 文件数 | 说明 |
|:-----|:-----|:-----:|:------|
| **audio/** | `D:\wenstar\data\webui\audio\` | 61个.mp3 | TTS生成的语音缓存 |

### 4.4 上传文件

| 目录 | 路径 | 文件数 | 说明 |
|:-----|:-----|:-----:|:------|
| **uploads/** | `D:\wenstar\data\webui\uploads\` | 32个 | 用户上传的原始文件(含重复上传) |

### 4.5 缓存

| 目录 | 路径 | 文件数 |
|:-----|:-----|:-----:|
| cache/ | `D:\wenstar\data\webui\cache\` | 4个 |

### 4.6 外部知识

| 目录 | 路径 | 说明 |
|:-----|:-----|:------|
| 01-待处理素材/ | `D:\wenstar\data\external-knowledge\01-待处理素材\` | 待导入素材 |
| 02-知识笔记库/ | `D:\wenstar\data\external-knowledge\02-知识笔记库\` | 已处理笔记 |
| 03-原始附件归档/ | `D:\wenstar\data\external-knowledge\03-原始附件归档\` | 原始文件归档 |
| 04-回收站/ | `D:\wenstar\data\external-knowledge\04-回收站\` | 已删除文件 |

---

## 五、日志文件

| 文件 | 路径 | 用途 |
|:-----|:-----|:------|
| **server.log** | `D:\wenstar\server.log` | 后端服务运行日志 |
| **bionic.log** | `D:\wenstar\bionic.log` | 仿生智脑适配器日志 |
| **start-all.log** | `D:\wenstar\start-all.log` | 前端守护进程重启日志(自动生成) |

---

## 六、配置与环境

| 文件 | 路径 | 用途 | 敏感 |
|:-----|:-----|:------|:----:|
| **.env** | `D:\wenstar\.env` | 环境变量(DEEPSEEK_API_KEY等) | 🔴 **是** |
| .env.example | `D:\wenstar\.env.example` | 环境变量模板 | 否 |
| package.json | `D:\wenstar\package.json` | 后端依赖声明 | 否 |
| tsconfig.json | `D:\wenstar\tsconfig.json` | 后端TypeScript配置 | 否 |
| ui/package.json | `D:\wenstar\ui\package.json` | 前端依赖声明 | 否 |
| ui/vite.config.ts | `D:\wenstar\ui\vite.config.ts` | Vite构建配置 | 否 |
| ui/tsconfig.json | `D:\wenstar\ui\tsconfig.json` | 前端TypeScript配置 | 否 |
| ingestion-guard.ts | `D:\wenstar\src\config\ingestion-guard.ts` | 摄入守卫配置 | 否 |
| CLAUDE.md | `D:\wenstar\CLAUDE.md` | Claude Code项目指令 | 否 |

---

## 七、外部依赖与模型

| 目录 | 路径 | 大小 | 说明 |
|:-----|:-----|:---:|:------|
| **node_modules/** | `D:\wenstar\node_modules\` | 大 | 后端Node.js依赖 |
| **ui/node_modules/** | `D:\wenstar\ui\node_modules\` | 大 | 前端Node.js依赖 |
| voxcpm2/ | `D:\wenstar\voxcpm2\` | 大 | ChatTTS/MOSS语音模型 |
| bionic-cognitive-engine/ | `D:\wenstar\bionic-cognitive-engine\` | 大 | 仿生智脑(离线) |
| chi_sim.traineddata | `D:\wenstar\chi_sim.traineddata` | — | Tesseract OCR中文模型 |
| eng.traineddata | `D:\wenstar\eng.traineddata` | — | Tesseract OCR英文模型 |

---

## 八、文件存储关系图

```
用户上传文件
    │
    ▼
data/webui/uploads/ (32个原始文件)
    │ 自动入库
    ▼
fusion_memory.db → knowledge_base 表 (35条)
    │ 同步到文件
    ├──→ data/knowledge-cabinet/docs/ (84个同步文件)
    └──→ data/knowledge-md/ (100个.md同步文件)
    │ 分块+向量化
    └──→ knowledge_chunks 表 (182块, 99%有向量)

TTS语音生成
    │
    ▼
data/webui/audio/ (61个.mp3临时文件)

对话数据
    │
    ▼
fusion_memory.db → conversations 表 (547条原始)
                      → memories 表 (124条结构化)
                      → black_diamond 表 (45条永久)

主人画像
    │
    ▼
fusion_memory.db → master_profile (227条)
                      → master_affairs (19条)
                      → master_network (22条)

家族图谱
    │
    ▼
data/webui/knowledge/family_graph.db → nodes (39) + edges (105)
```

---

## 九、存储策略说明

| 数据 | 保留策略 | 清理机制 |
|:-----|:---------|:---------|
| conversations | 永久保留(只标记`is_compacted`) | 无物理删除 |
| memories | 动态衰减+黑钻晋升 | 钙化衰减至0自动归档 |
| black_diamond | 永久保留 | 上限200条后降级最低钙化 |
| knowledge_base | 用户自主管理 | 无自动删除 |
| 记事记忆(note) | `is_valid=0`标记失效 | `cleanExpired(365)`定期清理 |
| TTS音频 | 临时缓存 | 无自动清理 |
| 归纳记录 | 永久保留 | 无自动清理 |
| 观测快照 | 永久保留 | 无自动清理 |

---

## 十、快速查找

```
要找什么?                    → 去哪里找?
─────────────────────────────────────────────
所有对话原始记录             → fusion_memory.db → conversations 表
所有金库记忆                 → fusion_memory.db → memories 表
所有黑钻永久记忆             → fusion_memory.db → black_diamond 表
所有知识库条目               → fusion_memory.db → knowledge_base 表
所有主人画像                 → fusion_memory.db → master_profile/affairs/network
所有人物档案                 → family_graph.db → nodes(properties JSON)
所有人物关系                 → family_graph.db → edges
所有API Key                  → data/webui/api_keys.json
所有提醒                     → data/webui/reminders.json(旧) / memories表(新)
所有梦境数据                 → data/dreams/
所有归纳记录                 → data/inductions/
所有配置文件                 → .env + 各config目录
所有TTS音频                  → data/webui/audio/
所有上传文件                 → data/webui/uploads/
所有知识柜文件               → data/knowledge-cabinet/docs/
所有MD同步文件               → data/knowledge-md/
所有数据库备份               → data/backups/
所有日志                     → server.log + bionic.log
