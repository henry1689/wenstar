# 太虚境 · 完整项目目录参考

> 最后更新: 2026-06-28 | 分支: `fix/taixujing-link-v1`
> 根目录: `D:\wenstar`

---

## 一、目录速览

| 目录 | 内容 | 大小 |
|:-----|------|-----|
| `src/` | 后端源代码（151 个 TS 文件） | — |
| `ui/` | 前端源代码（24 个 TSX/TS/CSS 文件） | — |
| `scripts/` | 运维脚本（13 个） | — |
| `data/` | 数据库与数据文件 | ~32MB |
| `docs/` | 文档（46+ 个文件） | — |
| `.claude/` | Claude Code 技能定义（22 个） | — |
| 根目录 | 配置与启动文件 | — |

---

## 二、根目录全部文件

| 文件 | 用途 | 关键程度 |
|:-----|------|:--------:|
| `start.cjs` | **后端启动入口** — `npm run webui` → `node start.cjs` → `npx tsx src/webui/server.ts` | ⭐⭐⭐ |
| `start-all.bat` | **一键启动+前端守护** — 后端+前端+Vite异常退出自动重启 | ⭐⭐⭐ |
| `start.bat` | 旧版启动脚本 | — |
| `package.json` | 后端依赖声明与 npm scripts | ⭐⭐⭐ |
| `tsconfig.json` | 后端 TypeScript 编译配置 | ⭐⭐ |
| `.env` | **环境变量** — DEEPSEEK_API_KEY 等敏感配置 | ⭐⭐⭐ |
| `.env.example` | 环境变量模板 | — |
| `CLAUDE.md` | Claude Code 项目指令 | ⭐⭐ |
| `STRATEGIC_BLUEPRINT.md` | 架构战略蓝图 | ⭐⭐ |
| `DESKTOP_BLUEPRINT.md` | 桌面端蓝图 | — |
| `TEST_REPORT.md` | 测试报告 | — |
| `backup-data.ps1` | 数据备份 PowerShell 脚本 | ⭐ |
| `.eslintrc.json` | ESLint 配置 | — |
| `.gitignore` | Git 忽略规则 | — |
| `chi_sim.traineddata` | Tesseract OCR 中文模型 | ⭐ |
| `eng.traineddata` | Tesseract OCR 英文模型 | ⭐ |
| `server.log` | 后端日志输出 | — |
| `bionic.log` | 仿生智脑适配器日志 | — |
| `D:wenstarkb_final.json` | 知识库数据（旧格式） | — |
| `__m7_test_*.db` | M7 梦境引擎测试数据库 | — |

---

## 三、后端源代码 (`src/`)

### 3.1 感知层 M1 (8文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| DNAEncoder | `src/m1/DNAEncoder.ts` | **DNA编码生成** — 对话根码+环节特征码(HY瑶印码) |
| L0Router | `src/m1/L0Router.ts` | **场景路由** — 话题分类 |
| L1Sequencer | `src/m1/L1Sequencer.ts` | **时序编排** |
| L2ContentExtractor | `src/m1/L2ContentExtractor.ts` | **内容提取** |
| L3EntityAnnotator | `src/m1/L3EntityAnnotator.ts` | **实体标注** |
| LLMEntityExtractor | `src/m1/LLMEntityExtractor.ts` | LLM辅助实体提取 |
| LexiconLoader | `src/m1/LexiconLoader.ts` | 词库加载 |
| SemanticBoundaryDetector | `src/m1/SemanticBoundaryDetector.ts` | 语义边界检测 |
| 类型定义 | `src/m1/types/dna.ts` | DNA类型 |

### 3.2 存储层 M2 (11+文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **SQLiteAdapter** | `src/m2/SQLiteAdapter.ts` | **SQLite底层操作** — DDL/迁移/写入/查询/缓存 |
| **FusionStorageAdapter** | `src/m2/FusionStorageAdapter.ts` | **融合存储适配器** — 统一存储入口 |
| **ConversationDB** | `src/m2/ConversationDB.ts` | **对话存储库** — 砂金库写入/查询 |
| **KnowledgeBase** | `src/m2/KnowledgeBase.ts` | **知识库兼容层** — 委托到 KnowledgeEngine |
| math | `src/m2/math.ts` | 钙化计算等数学工具 |
| migration | `src/m2/migration.ts` | 数据迁移 |
| retrieval-constants | `src/m2/retrieval-constants.ts` | 检索常量 |
| 类型定义 | `src/m2/types/index.ts` | M2 类型定义 |

### 3.3 感知决策 M3 (3文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **M3LogicOrchestrator** | `src/m3/M3LogicOrchestrator.ts` | **M3编排** — 24D感知+决策路由 |
| PerceptionAnalyzer | `src/m3/PerceptionAnalyzer.ts` | 感知分析(24D情感向量) |
| 类型定义 | `src/m3/types/perception.ts` | 24D感知类型 |

### 3.4 知识融合 M4 (8文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **FamilyGraph** | `src/m4/FamilyGraph.ts` | **家族图谱** — 节点/边/PersonDossier/PendingItems/完整度 |
| **M4Orchestrator** | `src/m4/M4Orchestrator.ts` | **M4编排** — 记忆检索+家族图谱注入 |
| EntityValidator | `src/m4/EntityValidator.ts` | 实体验证 |
| MemoryRetriever | `src/m4/MemoryRetriever.ts` | 记忆检索 |
| QueryDecomposer | `src/m4/QueryDecomposer.ts` | 查询分解 |
| Reranker | `src/m4/Reranker.ts` | 重排序 |
| 类型定义 | `src/m4/types/index.ts` + `graph.ts` | M4 类型 |

### 3.5 回复生成 M5 (18文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **M5Orchestrator** | `src/m5/M5Orchestrator.ts` | **M5编排** — 四步生成流水线 |
| **DeepSeekLLMProvider** | `src/m5/DeepSeekLLMProvider.ts` | **DeepSeek API提供者** — 主模型 |
| **MockLLMProvider** | `src/m5/MockLLMProvider.ts` | **本地Mock模型** — 亲密场景+双模型路由 |
| StrategySelector | `src/m5/StrategySelector.ts` | 策略选择 |
| CognitionAssembler | `src/m5/CognitionAssembler.ts` | 认知组装 |
| CandidateSelector | `src/m5/CandidateSelector.ts` | 候选回复生成 |
| HumanisticCalibrator | `src/m5/HumanisticCalibrator.ts` | 人文校准 |
| BufferPhrases | `src/m5/BufferPhrases.ts` | 过渡话术 |
| ContextMemory | `src/m5/ContextMemory.ts` | 场景记忆 |
| SceneAnchor | `src/m5/SceneAnchor.ts` | 场景锚点 |
| M5ClueAssistant | `src/m5/clue/M5ClueAssistant.ts` | 线索助理 |
| ContextualSafetyGateway | `src/m5/expression/ContextualSafetyGateway.ts` | 安全网关 |
| IntimateLexicon | `src/m5/expression/IntimateLexicon.ts` | 亲密词库 |
| IntimateRenderer | `src/m5/expression/IntimateRenderer.ts` | 亲密场景渲染 |
| TierVocabMap | `src/m5/expression/TierVocabMap.ts` | 亲密分级词库 |
| ExpressionSpecController | `src/m5/expression/ExpressionSpecController.ts` | 表达规格控制 |
| ThinkingPauseInjector | `src/m5/expression/ThinkingPauseInjector.ts` | 思考停顿注入 |
| lover-persona | `src/m5/persona/lover-persona.ts` | 灵肉伴侣人设(五重铁律) |
| 类型定义 | `src/m5/types/index.ts` | M5 类型 |

### 3.6 自我演化 M6 (8文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| M6Orchestrator | `src/m6/M6Orchestrator.ts` | M6编排 |
| SelfModelManager | `src/m6/SelfModelManager.ts` | 自我模型管理 |
| TraitEvolver | `src/m6/TraitEvolver.ts` | 人格演化 |
| PreferenceManager | `src/m6/PreferenceManager.ts` | 偏好管理 |
| BoundaryManager | `src/m6/BoundaryManager.ts` | 边界管理 |
| NarrativeBuilder | `src/m6/NarrativeBuilder.ts` | 叙事构建 |
| 类型定义 | `src/m6/types/index.ts` | M6 类型 |

### 3.7 梦境引擎 M7 (8文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| M7Orchestrator | `src/m7/M7Orchestrator.ts` | M7编排(梦境队列/四维分析) |
| DreamQueue | `src/m7/DreamQueue.ts` | 梦境队列 |
| DreamInternalizer | `src/m7/DreamInternalizer.ts` | 梦境内化 |
| InductionScheduler | `src/m7/InductionScheduler.ts` | 归纳调度器 |
| ConsolidationQueue | `src/m7/ConsolidationQueue.ts` | 巩固队列 |
| ClueTracker | `src/m7/ClueTracker.ts` | 线索追踪 |
| 类型定义 | `src/m7/types/index.ts` | M7 类型 |

### 3.8 年轮线索 M8 (5文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| M8FusionAdapter | `src/m8/M8FusionAdapter.ts` | M8融合适配器 |
| M8Engine | `src/m8/M8Engine.ts` | 年轮引擎 |
| PhysiologicalDeriver | `src/m8/PhysiologicalDeriver.ts` | 生理派生 |
| 类型定义 | `src/m8/types/index.ts` | M8 类型 |

### 3.9 工作记忆 M9 (2文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| WorkingMemory | `src/m9/WorkingMemory.ts` | 工作记忆/噪声门控 |

### 3.10 WebUI 服务 (9文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **server.ts** | `src/webui/server.ts` | **HTTP服务主入口** — 路由/初始化/SSE(2100行) |
| **chat.ts** | `src/webui/chat.ts` | **聊天处理管线** — 核心对话逻辑(~2410行) |
| **maintenance.ts** | `src/webui/maintenance.ts` | **维护引擎** — 压缩/GC/衰减/健康检查 |
| guard-builder.ts | `src/webui/guard-builder.ts` | 守卫构造器 |
| chat/index.ts | `src/webui/chat/index.ts` | 聊天子模块入口 |
| chat/guard-builder.ts | `src/webui/chat/guard-builder.ts` | 聊天守卫 |
| chat/post-process.ts | `src/webui/chat/post-process.ts` | 聊天后处理 |
| chat/retrieval.ts | `src/webui/chat/retrieval.ts` | 聊天检索 |

### 3.11 应用层 — 知识库 (11文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **KnowledgeEngine** | `src/app/knowledge/KnowledgeEngine.ts` | **知识库引擎** — 搜索/嵌入/分类/加权检索 |
| **EmbeddingProvider** | `src/app/knowledge/EmbeddingProvider.ts` | **嵌入提供者** — 本地TF-IDF 256维 |
| RAGPipeline | `src/app/knowledge/RAGPipeline.ts` | 混合检索管道 |
| VectorStore | `src/app/knowledge/VectorStore.ts` | 向量存储 |
| KnowledgeMonitor | `src/app/knowledge/KnowledgeMonitor.ts` | 知识库健康监控 |
| FileUploadService | `src/app/knowledge/FileUploadService.ts` | 文件上传服务 |
| RelationshipExtractor | `src/app/knowledge/RelationshipExtractor.ts` | 关系提取器 |
| FamilyGraphSync | `src/app/knowledge/FamilyGraphSync.ts` | FG→知识库同步 |
| AppearanceExtractor | `src/app/knowledge/AppearanceExtractor.ts` | 外貌特征提取 |
| ChunkService | `src/app/knowledge/ChunkService.ts` | 分块服务 |
| TopicTracker | `src/app/knowledge/TopicTracker.ts` | 话题追踪 |
| WebResearchService | `src/app/knowledge/WebResearchService.ts` | 网络研究服务 |
| 类型定义 | `src/app/knowledge/types.ts` | 知识库类型 |
| index | `src/app/knowledge/index.ts` | 知识索引 |

### 3.12 应用层 — 任务代理 (7文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| TaskAgentEngine | `src/app/task-agent/TaskAgentEngine.ts` | 任务代理引擎 |
| TaskPlanner | `src/app/task-agent/TaskPlanner.ts` | 任务规划器 |
| ToolRegistry | `src/app/task-agent/ToolRegistry.ts` | 工具注册表 |
| CalendarTool | `src/app/task-agent/tools/CalendarTool.ts` | 日历工具(JSON持久化) |
| ReminderTool | `src/app/task-agent/tools/ReminderTool.ts` | 提醒工具+startReminderChecker |
| NoteTool | `src/app/task-agent/tools/NoteTool.ts` | 笔记工具 |
| SearchTool | `src/app/task-agent/tools/SearchTool.ts` | 搜索工具(包装KB) |
| 类型定义 | `src/app/task-agent/types.ts` | 任务类型 |

### 3.13 应用层 — 角色与画像 (10文件)

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **RoleProfiles** | `src/app/role/RoleProfiles.ts` | **5个角色System Prompt模板** |
| RoleClassifier | `src/app/role/RoleClassifier.ts` | 角色分类器 |
| TransitionManager | `src/app/role/TransitionManager.ts` | 角色转换管理 |
| RoleGuard | `src/app/role/RoleGuard.ts` | 角色守卫 |
| **MasterProfileService** | `src/app/profile/MasterProfileService.ts` | **主人镜像** — 画像提取/存储 |
| MemoryVault | `src/app/memory-vault/MemoryVault.ts` | 记忆库 |
| HallucinationValidator | `src/app/validation/HallucinationValidator.ts` | 幻觉校验 |
| PersonaRegistry | `src/app/persona/PersonaRegistry.ts` | 角色注册表 |
| 7个内建角色 | `src/app/persona/built-in/*/` | 玉瑶/秘书/军师/知己/名人/同事/自定义 |
| SomaticMemory | `src/app/somatic/SomaticMemory.ts` | 躯体记忆 |

### 3.14 应用层 — 其他

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **YuyaoMemoryService** | `src/app/yuyao-memory/YuyaoMemoryService.ts` | **记事记忆系统** |
| **VaultManager** | `src/app/vault/VaultManager.ts` | **三库管理** — 晋升/查询/黑钻上限 |
| **AQCEngine** | `src/app/aqc/AQCEngine.ts` | **AQC质检引擎** — SandQC+GoldQC |
| MemoryGate | `src/app/conversation/MemoryGate.ts` | 记忆门控 |
| ConversationIngestionService | `src/app/ingestion/ConversationIngestionService.ts` | 对话自动入库 |
| FusionEngine | `src/app/fusion/FusionEngine.ts` | 融合引擎 |
| MemorySelfReview | `src/app/selfreview/MemorySelfReview.ts` | 记忆自审 |
| MemoryAssessor | `src/app/vault/MemoryAssessor.ts` | 记忆评估 |
| RoleplayTemplates | `src/app/roleplay/RoleplayTemplates.ts` | 角色扮演模板 |
| AsyncTaskQueue | `src/app/tools/AsyncTaskQueue.ts` | 异步任务队列 |
| FileChunker | `src/app/tools/FileChunker.ts` | 文件分块器 |
| LocalCache | `src/app/tools/LocalCache.ts` | 本地缓存(TTL+LRU) |
| ApiKeyStorage | `src/app/shared/ApiKeyStorage.ts` | API Key存储 |
| AutoLearnPlugin | `src/app/learning/AutoLearnPlugin.ts` | 自动学习插件 |
| LibraryClient | `src/app/library/LibraryClient.ts` | 知识库客户端 |
| logger | `src/app/utils/logger.ts` | 日志工具 |
| ingestion-guard | `src/config/ingestion-guard.ts` | 摄入守卫配置 |
| bionic-adapter | `src/adapter/bionic-adapter.ts` | 仿生智脑适配器 |
| multimodal-adapter | `src/adapter/multimodal-adapter.ts` | 多模态适配器 |

### 3.15 CLI 与工具

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| health-check | `src/cli/health-check.ts` | 健康检查CLI |
| sandbox | `src/cli/sandbox.ts` | 沙箱工具 |
| scan-knowledge-intimate | `src/cli/scan-knowledge-intimate.ts` | 亲密内容扫描 |
| migrate-entity-relations | `src/cli/migrate-entity-relations.ts` | 实体关系迁移 |
| schema | `src/m2/schema.sql` | 数据库DDL |
| types | `src/types.d.ts` + `src/types/sql-js.d.ts` | 全局类型声明 |

---

## 四、前端源代码 (`ui/`)

### 4.1 入口与配置

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **vite.config.ts** | `ui/vite.config.ts` | Vite配置 — 代理`/api`→3000, `/audio`→3000 |
| **index.html** | `ui/index.html` | HTML入口 |
| **main.tsx** | `ui/src/main.tsx` | React入口 |
| **App.tsx** | `ui/src/App.tsx` | 根组件 |
| **App.css** | `ui/src/App.css` | 全局样式(深色主题) |
| index.css | `ui/src/index.css` | 基础样式 |
| package.json | `ui/package.json` | 前端依赖 |
| tsconfig.json | `ui/tsconfig.json` | TS配置 |

### 4.2 组件 (11个)

| 组件 | 路径 | 用途 |
|:-----|:-----|------|
| **ChatPanel** | `ui/src/components/ChatPanel.tsx` | **聊天主面板** — 输入/消息/TTS/撤回/KB入口 |
| **KnowledgePanel** | `ui/src/components/KnowledgePanel.tsx` | **知识库管理器** — 列表/查看/新增/删除 |
| **SettingsDock** | `ui/src/components/SettingsDock.tsx` | **设置面板** — API Key / TTS音色 |
| CognitiveRadar | `ui/src/components/CognitiveRadar.tsx` | 认知雷达可视化 |
| EmotionalPulse | `ui/src/components/EmotionalPulse.tsx` | 情感脉冲可视化 |
| KnowledgeBase | `ui/src/components/KnowledgeBase.tsx` | 知识库可视化组件 |
| MemoryOcean | `ui/src/components/MemoryOcean.tsx` | 记忆海洋可视化 |
| NeuralCore | `ui/src/components/NeuralCore.tsx` | 神经核可视化 |
| StatusPanel | `ui/src/components/StatusPanel.tsx` | 状态面板 |
| ThoughtStream | `ui/src/components/ThoughtStream.tsx` | 思维流显示 |
| WorkingMemoryTicker | `ui/src/components/WorkingMemoryTicker.tsx` | 工作记忆滚动条 |

### 4.3 服务与状态

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| **chatService** | `ui/src/services/chatService.ts` | **聊天API客户端** — 发送/SSE/撤回/TTS |
| **knowledgeService** | `ui/src/services/knowledgeService.ts` | **知识库API客户端** — 列表/增删/搜索 |
| settingsService | `ui/src/services/settingsService.ts` | 设置API |
| thoughtService | `ui/src/services/thoughtService.ts` | 思维流服务 |
| neuralDataService | `ui/src/services/neuralDataService.ts` | 神经数据服务 |
| somaticService | `ui/src/services/somaticService.ts` | 躯体感受服务 |
| **chatStore** | `ui/src/store/chatStore.ts` | **聊天状态管理(Zustand)** |
| neuralStore | `ui/src/store/neuralStore.ts` | 神经网络状态 |
| thoughtStore | `ui/src/store/thoughtStore.ts` | 思维流状态 |

### 4.4 工具/辅助

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| https-proxy.cjs | `ui/https-proxy.cjs` | HTTPS代理 |
| redirect-server.cjs | `ui/redirect-server.cjs` | 重定向服务 |
| serve-production.cjs | `ui/serve-production.cjs` | 生产环境服务 |
| cert.pem / key.pem | `ui/` | HTTPS证书 |

---

## 五、脚本 (`scripts/`)

| 脚本 | 路径 | 用途 |
|:-----|:-----|------|
| **tts_server.py** | `scripts/tts_server.py` | **TTS语音服务** — FastAPI 端口8765, 13种中文音色 |
| family-graph-backup.cjs | `scripts/family-graph-backup.cjs` | 家族图谱备份 |
| clean-kb.cjs | `scripts/clean-kb.cjs` | 知识库清理 |
| clean-kb.js | `scripts/clean-kb.js` | 知识库清理(旧版) |
| clean-familygraph-nodes.cjs | `scripts/clean-familygraph-nodes.cjs` | FG垃圾节点清理 |
| clean-person-profiles.cjs | `scripts/clean-person-profiles.cjs` | 人物档案清理 |
| dialog-simulator.cjs | `scripts/dialog-simulator.cjs` | 对话模拟器 |
| backfill-blackdiamond-vectors.cjs | `scripts/backfill-blackdiamond-vectors.cjs` | 黑钻向量回填 |
| observation-report.cjs | `scripts/observation-report.cjs` | 观测报告生成 |
| disable-proactive.cjs | `scripts/disable-proactive.cjs` | 关闭主动功能 |
| upgrade-to-flagship.mjs | `scripts/upgrade-to-flagship.mjs` | 旗舰版升级 |
| package-flagship.mjs | `scripts/package-flagship.mjs` | 旗舰版打包 |
| package-lite.mjs | `scripts/package-lite.mjs` | 精简版打包 |

---

## 六、数据库

### 6.1 主库

| 数据库 | 路径 | 大小 | 用途 |
|:-------|:-----|:---:|------|
| **fusion_memory.db** | `data/webui/fusion_memory.db` | ~32MB | **核心数据** — 金库/砂金库/黑钻/知识库/主人镜像 |
| **family_graph.db** | `data/webui/knowledge/family_graph.db` | — | **家族图谱** — 人物节点+关系边 |
| family_graph.db(副本) | `data/knowledge/family_graph.db` | — | FG副本 |

### 6.2 数据库内部表结构

**fusion_memory.db:**

| 表 | 数据量 | 用途 | 关键字段 |
|:---|:------:|------|---------|
| `memories` | 124条 | 金库/记事记忆 | `memory_type`, `sub_type`, `note_key`, `calcium_score` |
| `conversations` | 547条 | 砂金库原始对话 | `dna_root_id`, `dialog_group_id`, `is_compacted`, `is_test` |
| `black_diamond` | 45条 | 黑钻永久记忆 | `calcium_level`, `emotion_tag`, `source_id` |
| `knowledge_base` | 35条 | 知识库条目 | `classification`, `emotion_vector`, `impression_score` |
| `knowledge_chunks` | 182块 | 知识分块向量 | `embedding`, `kn_id`, `chunk_text` |
| `master_profile` | 227条 | 主人主观世界 | `category`, `content`, `confidence` |
| `master_affairs` | 19条 | 主人事务 | `status`, `priority` |
| `master_network` | 22条 | 主人人脉 | `person_name`, `importance` |

**family_graph.db:**

| 表 | 数据量 | 用途 | 关键字段 |
|:---|:------:|------|---------|
| `nodes` | 39节点 | 人物节点 | `type`, `name`, `properties`(JSON含PersonProfile) |
| `edges` | 105边 | 关系边 | `source_id`, `target_id`, `relation` |

### 6.3 备份文件

| 位置 | 数量 | 说明 |
|:-----|:----:|------|
| `data/backups/family_graph_*.db` | ~100 | 家族图谱备份(每15-30分钟) |
| `data/backups/knowledge_*.db` | ~100 | 融合存储备份(每15-30分钟) |
| `data/backups/vault_*.db` | ~100 | 记忆库备份 |
| `data/memory-vault/backups/vault_*.db` | 17 | 记忆库日备份 |
| `data/webui/conversations.db` | 1 | 旧版对话库(迁移后保留) |

---

## 七、数据文件 (`data/`)

| 路径 | 用途 |
|:-----|------|
| `data/webui/fusion_memory.db` | **主数据库** |
| `data/webui/knowledge/family_graph.db` | **家族图谱库** |
| `data/webui/audio/` | TTS生成的音频文件 |
| `data/webui/cache/` | 本地缓存 |
| `data/webui/uploads/` | 上传文件临时存放 |
| `data/knowledge-cabinet/docs/` | **知识柜** — 文档类知识文件同步 |
| `data/knowledge-cabinet/images/` | 知识柜图片 |
| `data/knowledge-cabinet/videos/` | 知识柜视频 |
| `data/knowledge-cabinet/data/` | 知识柜数据文件 |
| `data/knowledge-md/` | 知识库Markdown同步目录 |
| `data/backups/` | **统一备份** — 三库+知识库+黑钻 |
| `data/memory-vault/backups/` | 记忆库独立备份 |
| `data/dreams/` | 梦境日志 |
| `data/inductions/` | 归纳记录 |
| `data/year_rings/` | 年轮数据 |
| `data/lexicons/` | 词库数据 |
| `data/observation/` | 观测数据 |
| `data/persona/` | 角色数据 |
| `data/reports/` | 报告输出 |
| `data/self_model.json` | M6自我模型持久化 |

---

## 八、配置文件

| 文件 | 路径 | 用途 |
|:-----|:-----|------|
| `.env` | `D:\wenstar\.env` | **环境变量** — API Key等敏感配置 |
| `start.cjs` | `D:\wenstar\start.cjs` | **后端启动脚本** |
| `start-all.bat` | `D:\wenstar\start-all.bat` | **一键启动+守护** |
| `package.json` | `D:\wenstar\package.json` | 后端依赖 |
| `tsconfig.json` | `D:\wenstar\tsconfig.json` | 后端TS配置 |
| `ui/vite.config.ts` | `D:\wenstar\ui\vite.config.ts` | 前端构建配置 |
| `ui/package.json` | `D:\wenstar\ui\package.json` | 前端依赖 |
| `ui/tsconfig.json` | `D:\wenstar\ui\tsconfig.json` | 前端TS配置 |
| `.eslintrc.json` | `D:\wenstar\.eslintrc.json` | ESLint配置 |
| `CLAUDE.md` | `D:\wenstar\CLAUDE.md` | Claude Code指令 |
| `src/config/ingestion-guard.ts` | `D:\wenstar\src\config\ingestion-guard.ts` | 摄入守卫配置 |

---

## 九、文档 (`docs/`)

| 文档 | 路径 | 用途 |
|:-----|:-----|------|
| **full-feature-checklist.md** | `docs/full-feature-checklist.md` | **全功能清单与测试用例(46项)** |
| **project-directory-reference.md** | `docs/project-directory-reference.md` | **本文** |
| HERMES-FEATURES.md | `docs/HERMES-FEATURES.md` | Hermes功能概述 |
| M2-design-v1.md ~ M8-design-v1.md | `docs/M*.md` | M2-M8设计文档 |
| OUTLINE.md | `docs/OUTLINE.md` | 系统概述 |
| ADR-001 ~ ADR-006 | `docs/adr/ADR-*.md` | 架构决策记录 |
| project-spec-v1.md | `docs/project-spec-v1.md` | 项目规格 |
| execution-protocol-v2.md | `docs/execution-protocol-v2.md` | 执行协议 |
| person-storage.md | `docs/architecture/person-storage.md` | 人物存储设计 |
| 三库体系与AQC质检岗位说明书.md | `docs/` | 三库+AQC |
| 双版本白皮书/蓝皮书/技术规范 | `docs/双版本升级/` | 双版本设计文档 |
| 蓝图文件 | `docs/blueprint/` | 功能蓝图 |

---

## 十、Claude Code 技能 (`./claude/`)

| 技能 | 路径 | 用途 |
|:-----|:-----|------|
| brainstorm | `.claude/skills/brainstorm.md` | 设计推演 |
| change-report | `.claude/skills/change-report.md` | 变更报告 |
| debug | `.claude/skills/debug.md` | 调试 |
| execute-plan | `.claude/skills/execute-plan.md` | 执行计划 |
| finish-branch | `.claude/skills/finish-branch.md` | 完成分支 |
| module-audit | `.claude/skills/module-audit.md` | 模块审计 |
| mobile-public-mode | `.claude/skills/mobile-public-mode.md` | 手机公网模式 |
| person-storage-troubleshooting | `.claude/skills/person-storage-troubleshooting.md` | 人物存储排障 |
| project-init | `.claude/skills/project-init.md` | 项目初始化 |
| refactor | `.claude/skills/refactor.md` | 重构 |
| review-code | `.claude/skills/review-code.md` | 代码审查 |
| security-audit | `.claude/skills/security-audit.md` | 安全审计 |
| stability-check | `.claude/skills/stability-check.md` | 稳定性检查 |
| system-integrity | `.claude/skills/system-integrity.md` | 系统完整性 |
| tdd | `.claude/skills/tdd.md` | TDD |
| test-data-discipline | `.claude/skills/test-data-discipline.md` | 测试数据纪律 |
| verify-before-done | `.claude/skills/verify-before-done.md` | 完成前验证 |
| write-plan | `.claude/skills/write-plan.md` | 写计划 |

---

## 十一、服务端口与启动

| 服务 | 端口 | 启动命令 | 备注 |
|:-----|:----:|:---------|:-----|
| **后端** | **3000** | `npm run webui` 或双击 `start-all.bat` | Node.js 22.x, tsx运行 |
| **前端** | **5174** | `cd ui && npx vite` 或 `start-all.bat` 自动启动 | Vite, 代理 `/api` → 3000 |
| **TTS** | **8765** | `python scripts/tts_server.py` | Python FastAPI, edge-tts |

---

## 十二、版本控制

| 项目 | 信息 |
|:-----|------|
| 远程仓库 | `https://github.com/henry1689/wenstar.git` |
| 当前分支 | `fix/taixujing-link-v1` |
| 最新提交 | `36d5c8b` |

---

## 附录：项目规模统计

```
后端 TS 文件:       151 个
前端 TS/TSX 文件:    24 个
运维脚本:            13 个
文档:                46+ 个
数据库中表:          14+ 张
技能定义:            22 个
总代码行数:          ~50,000+ 行
数据库总大小:        ~32 MB
备份文件:            400+ 个
