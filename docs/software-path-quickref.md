# 太虚境 · 软件文件速查

> 按使用频率排序，常用功能在前

---

## 🔥 最常用（每天都要打开）

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| **聊天核心逻辑** | `D:\wenstar\src\webui\chat.ts` | 对话处理管线，~2410行 |
| **HTTP服务主入口** | `D:\wenstar\src\webui\server.ts` | API路由/初始化/SSE，~2100行 |
| **聊天面板(前端)** | `D:\wenstar\ui\src\components\ChatPanel.tsx` | 主交互界面 |
| **知识库引擎** | `D:\wenstar\src\app\knowledge\KnowledgeEngine.ts` | 搜索/嵌入/加权检索 |
| **家族图谱** | `D:\wenstar\src\m4\FamilyGraph.ts` | 人物节点/边/档案，~2160行 |
| **记事记忆系统** | `D:\wenstar\src\app\yuyao-memory\YuyaoMemoryService.ts` | 物品位置/事实/提醒 |

---

## 二、LLM与回复生成

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| DeepSeek提供者 | `D:\wenstar\src\m5\DeepSeekLLMProvider.ts` | 主模型API调用 |
| 本地Mock模型 | `D:\wenstar\src\m5\MockLLMProvider.ts` | 亲密场景/双模型路由 |
| M5编排 | `D:\wenstar\src\m5\M5Orchestrator.ts` | 生成流水线 |
| 角色System Prompt | `D:\wenstar\src\app\role\RoleProfiles.ts` | 5个角色模板 |

## 三、存储与数据库

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| SQLite底层 | `D:\wenstar\src\m2\SQLiteAdapter.ts` | 数据库操作/DDL/迁移 |
| 融合存储适配器 | `D:\wenstar\src\m2\FusionStorageAdapter.ts` | 统一存储入口 |
| 对话存储库 | `D:\wenstar\src\m2\ConversationDB.ts` | 砂金库写入/查询 |
| 知识库兼容层 | `D:\wenstar\src\m2\KnowledgeBase.ts` | 委托到KnowledgeEngine |
| 知识库面板(前端) | `D:\wenstar\ui\src\components\KnowledgePanel.tsx` | 列表/查看/新增/删除 |
| 知识库API客户端 | `D:\wenstar\ui\src\services\knowledgeService.ts` | 前端知识库接口 |

## 四、维护与监控

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| 维护引擎 | `D:\wenstar\src\webui\maintenance.ts` | 压缩/GC/衰减/健康检查 |
| 设置面板(前端) | `D:\wenstar\ui\src\components\SettingsDock.tsx` | API Key/TTS音色 |
| TTS语音服务 | `D:\wenstar\scripts\tts_server.py` | 端口8765, 13种中文音色 |
| 聊天API客户端 | `D:\wenstar\ui\src\services\chatService.ts` | 前端聊天接口 |
| 状态管理 | `D:\wenstar\ui\src\store\chatStore.ts` | Zustand |

## 五、应用层模块

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| 主人镜像 | `D:\wenstar\src\app\profile\MasterProfileService.ts` | 画像提取/存储 |
| 三库管理 | `D:\wenstar\src\app\vault\VaultManager.ts` | 晋升/查询/黑钻上限 |
| AQC质检 | `D:\wenstar\src\app\aqc\AQCEngine.ts` | SandQC+GoldQC |
| 嵌入提供者 | `D:\wenstar\src\app\knowledge\EmbeddingProvider.ts` | 本地TF-IDF 256维 |
| 摄入守卫配置 | `D:\wenstar\src\config\ingestion-guard.ts` | 知识库守卫 |
| 幻觉校验 | `D:\wenstar\src\app\validation\HallucinationValidator.ts` | 回复人名校验 |

## 六、M1-M9核心模块

| 模块 | 文件 | 路径 |
|:-----|:-----|:------|
| **M1** | DNAEncoder / L0-L3 / 实体提取 | `D:\wenstar\src\m1\*.ts` (8文件) |
| **M2** | 存储层 | `D:\wenstar\src\m2\*.ts` (8文件) |
| **M3** | 24D感知决策 | `D:\wenstar\src\m3\*.ts` (2文件) |
| **M4** | 知识融合/家族图谱 | `D:\wenstar\src\m4\*.ts` (7文件) |
| **M5** | 回复生成 | `D:\wenstar\src\m5\*.ts` (18文件) |
| **M6** | 自我演化 | `D:\wenstar\src\m6\*.ts` (6文件) |
| **M7** | 梦境引擎 | `D:\wenstar\src\m7\*.ts` (6文件) |
| **M8** | 年轮线索 | `D:\wenstar\src\m8\*.ts` (3文件) |
| **M9** | 工作记忆 | `D:\wenstar\src\m9\WorkingMemory.ts` |

## 七、启动与配置

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| **后端启动入口** | `D:\wenstar\start.cjs` | npm run webui 实际执行文件 |
| **一键启动+守护** | `D:\wenstar\start-all.bat` | 双击启动后端+前端+Vite守护 |
| 后端依赖 | `D:\wenstar\package.json` | npm scripts |
| 后端TS配置 | `D:\wenstar\tsconfig.json` | 编译配置 |
| 前端依赖 | `D:\wenstar\ui\package.json` | 前端npm |
| 前端Vite配置 | `D:\wenstar\ui\vite.config.ts` | 代理配置 |
| **环境变量** | `D:\wenstar\.env` | DEEPSEEK_API_KEY等 |
| Claude指令 | `D:\wenstar\CLAUDE.md` | Claude Code项目配置 |

## 八、前端其他组件

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| App.tsx | `D:\wenstar\ui\src\App.tsx` | 根组件 |
| App.css | `D:\wenstar\ui\src\App.css` | 全局样式(深色主题) |
| 全局样式 | `D:\wenstar\ui\src\index.css` | 基础样式 |
| React入口 | `D:\wenstar\ui\src\main.tsx` | main.tsx |

## 九、文档

| 文件 | 路径 | 说明 |
|:-----|:-----|:------|
| 全功能清单 | `D:\wenstar\docs\full-feature-checklist.md` | 46项功能+测试用例 |
| 目录参考 | `D:\wenstar\docs\project-directory-reference.md` | 完整项目文件索引 |
| 数据存储参考 | `D:\wenstar\docs\data-storage-reference.md` | 所有数据文件位置 |
| M1-M8设计文档 | `D:\wenstar\docs\M*-design-v1.md` | 各模块设计说明书 |

---

## 附录：目录速查

```
后端代码根目录:    D:\wenstar\src\
前端代码根目录:    D:\wenstar\ui\src\
应用层代码:        D:\wenstar\src\app\
WebUI服务:         D:\wenstar\src\webui\
M1-M9模块:         D:\wenstar\src\m1\ ~ m9\
运维脚本:          D:\wenstar\scripts\
文档目录:          D:\wenstar\docs\
