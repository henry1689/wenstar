# Hermes 情感伴侣类脑认知系统 · 完整功能清单

> **版本**: v1.5-m5-final  
> **日期**: 2026-06-02  
> **代码量**: 59 个 TypeScript 源文件 + 20 个测试文件 + 8 份设计文档  
> **测试总量**: 1073 项（145 单元 + 579 压力 + 29 校准 + 320 全栈）  
> **核心哲学**: 用文字的密度填补现实的孤独

---

## 目录

1. [M1 DNA 编码器](#1-m1-dna-编码器)
2. [M2 5 大语义区存储适配器](#2-m2-5-大语义区存储适配器)
3. [M3 感知分析器](#3-m3-感知分析器)
4. [M4 知识融合与家族图谱](#4-m4-知识融合与家族图谱)
5. [M5 表达生成引擎](#5-m5-表达生成引擎)
6. [M6 自我模型状态机](#6-m6-自我模型状态机)
7. [M7 梦境学习引擎](#7-m7-梦境学习引擎)
8. [M8 关系年轮引擎](#8-m8-关系年轮引擎)
9. [系统级功能](#9-系统级功能)
10. [设计哲学](#10-设计哲学)

---

## 1. M1 DNA 编码器

**6 文件，1072 行**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **L0 纯规则路由** | L0Router.ts | 基于认知分类树 + 关键词规则，将用户话语路由到认知拓扑坐标（如 `user.family.conflict`） |
| **L1 序列生成** | L1Sequencer.ts | 生成 `evt_YYYYMMDD_NNN` 格式的唯一 branch_id，会话内严格单调递增 |
| **L2 语义区映射** | L2ContentExtractor.ts | 根据话题映射到 5 大语义区之一，生成临时 ref 占位ID |
| **L3 实体标注** | L3EntityAnnotator.ts | 纯规则 NER（不用LLM），提取 person/place/emotion/event/self 实体，标注 phenotype（enhance/conflict/neutral）和 knowledge_type（private/family/world） |
| **语义边界检测** | SemanticBoundaryDetector.ts | 三条规则：时间间隔>30分钟 / 话题切换 / 情感极性翻转 → 自动分割语义单位 |
| **流式编排器** | DNAEncoder.ts | push()→自动缓冲+边界检测 / flush()→合并为一条完整 DNA / resetSession()→重置 |

### 细小技巧与闪光点

- L0 三级兜底：强情感极性检测 → 领域未匹配 → `user.misc.default`，永不崩溃
- taxonomy.json 文件缺失时自动使用内存默认树，控制台警告但不中断
- 优先级排序算法：同优先级下匹配关键词数量越多越优先
- "好"从正面词表移除——因"好难过"中的"好"是程度副词不是正面词，实际测试中发现并修复
- L3 去重机制：按 `type:name` 组合去重
- L3 knowledge_type 智能分类："妈妈"→family、"北京"→world、"考试"→private

---

## 2. M2 5 大语义区存储适配器

**4 文件**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **StorageAdapter 接口** | StorageAdapter.ts | write / read / findByLocus / findBySeqPosRange 等标准接口 |
| **JSON 文件实现** | JsonStorageAdapter.ts | 5 个独立 JSON 文件 + index.json 索引 + counter.json 原子自增 seq_pos |
| **5 区物理隔离** | constants.ts | 5 个 zone 文件各存各区数据，数据不混存 |
| **原子性 seq_pos** | counter.json | 先写临时文件 .tmp → 再重命名，防止写入中断导致文件损坏 |

### 细小技巧与闪光点

- 写操作原子性保证：每写一次涉及 3 份文件的 .tmp 写入 + 重命名
- 跨会话 seq_pos 连续性保证
- 文件损毁恢复：任何 JSON 文件损坏都自动走空数组或默认值
- 500 条高容量写入压力测试全部成功

---

## 3. M3 感知分析器

**2 文件**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **24 维语义感知** | PerceptionAnalyzer.ts | 4 大象限 × 6 维度 = 24 维全面评分（情绪/认知/社会/亲密） |
| **钙质公式** | PerceptionAnalyzer.ts | Base_Core + Emotional_Boost + Threat_Bonus → 4 级分档（粉末/液体/固体/晶体） |
| **决策路由** | M3LogicOrchestrator.ts | 钙质等级 × 情绪极性 → 5 种动作（ignore/memorize/ask/comfort/act） |
| **上下文注入** | PerceptionAnalyzer.ts | 时间词修正 C5 / 地点词修正 S6 / 情感基线异常检测 |
| **5 级双向强度** | TierVocabMap.ts | -2寒 / -1凉 / 0中性 / +1暖 / +2炽，29 场景校准通过 |
| **灵肉伴侣人设** | lover-persona.ts | 核心人设 + 5 级动态话术指示 + 风格锚点 |

### 细小技巧与闪光点

- 复合强度算法：`主维度×0.6 + 次维度×0.4`，防止单一维度满级导致误判
- 关心修正：负向 pleasure + 高 sincerity + 低 aggression + 非投诉词 → 转为 +1 暖
- 单维度衰减：raw ≥ 0.5 时检查次级维度 ≥ 0.08 才允许 level ±2
- 极性判定：正负维度加权对比
- 中文分词解决："今天心情不太好"中 `includes('不好')` 返回 false 的 bug 在压力测试中发现并修复
- 5 条身体法则：不用比喻 / 短句堆叠 / 脏话镜像 / 每次都是新的 / 停顿是生理反应
- 词表累计 140+ 关键词，覆盖 7 个情感维度

---

## 4. M4 知识融合与家族图谱

**3 文件**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **家族图谱 SQLite** | FamilyGraph.ts | nodes + edges 表，支持多代多人关系构建 |
| **自动关系推断** | FamilyGraph.ts | "我妈妈叫李华" → 自动创建 mother_of + 反向 child_of 边 |
| **手动关系修正** | FamilyGraph.ts | correctRelation() 删除旧边 + 创建正确边 + 反向边 |
| **路径搜索** | FamilyGraph.ts | BFS 广度优先搜索，限定深度 ≤ 4 |
| **记忆检索** | MemoryRetriever.ts | 按 entity_genes + locus_path 联合检索，上下文窗口压缩 |
| **知识融合** | M4Orchestrator.ts | 记忆摘要 + 家族知识 + M3 决策 → 统一的 M4Context |

### 细小技巧与闪光点

- 反向边自动推导：mother_of → child_of，spouse_of → 双向
- 地点关联：提到家庭成员 + 地点 → 自动创建 lives_in 边
- 去重机制：重复推断不新增边（先查 edge 是否存在）
- 16 人大家族压力测试通过

---

## 5. M5 表达生成引擎

**15 文件，最大模块**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **四步流水线** | M5Orchestrator.ts | 认知组装 → 策略选择 → LLM 生成 → 人文校准 |
| **认知组装** | CognitionAssembler.ts | 纯函数将 M4Context → 结构化 CognitionObject |
| **策略选择** | StrategySelector.ts | 规则引擎匹配 5 种策略模板 |
| **MockLLMProvider** | MockLLMProvider.ts | 玉瑶多情本色 v7.0，16 条情话池 + 4 级强度回应 |
| **ClaudeLLMProvider** | ClaudeLLMProvider.ts | 真实 LLM API 封装，带人设注入 |
| **人文校准器** | HumanisticCalibrator.ts | 实体校验 + 空校验 + 长度控制 + 降级兜底 |
| **情境化安全网关** | ContextualSafetyGateway.ts | 白名单 200+ 词放行 + 辱骂检测 + 用户授权 1-3 级 |
| **三级尺度词库** | IntimateLexicon.ts | 触觉/嗅觉/视觉/舌吻/私密/挑逗/体声 × 3 级 = 100+ 条 |
| **生理停顿注入器** | ThinkingPauseInjector.ts | 4 种生理停顿，高强度 2-3 次自动插入 |
| **表达规格控制器** | ExpressionSpecController.ts | 强度 → 字数 / 文学密度 / 停顿 动态计算 |
| **5 级话术映射** | TierVocabMap.ts | 每等级有 LLM Prompt 指示 |
| **线索协助式回忆** | M5ClueAssistant.ts | 模糊检测→特征反问(≤15字)→M8检索→置信度判定 |

### 细小技巧与闪光点

- 四级身体回应池：warm(视线停顿/指尖敲桌面) → hot(喉结滚动/呼吸不稳) → scorching(耳尖泛红/身体前倾) → afterglow(声音轻柔/表情柔和)
- 15 字线索反问铁律：必须 ≤15 字 + 带语气词 + 禁止书面语
- 脏话镜像：检测用户 level3 词汇 + I1>0.8 时镜像回应
- 短句堆叠：激情时强制短句(<8字×≥5句) + 生理停顿 + 长文抒发(300-500字)
- 冷启动相识期规则：M8 条目<50 条时零主动采集
- "隔着屏幕"禁词铁律：CORE_PERSONA 硬编码
- Temperature 动态：+2 炽用 0.9，其他用 0.7

---

## 6. M6 自我模型状态机

**6 文件，420 行**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **自我模型管理器** | SelfModelManager.ts | JSON 持久化 + 出厂默认值 + 四大支柱 CRUD |
| **特质演化引擎** | TraitEvolver.ts | C 策略三级演化（≤5%自动 / 5-15%梦境试探 / >15%阻塞） |
| **偏好管理器** | PreferenceManager.ts | 新增/强化 + 30 天衰减 20% |
| **边界守卫** | BoundaryManager.ts | hitCount 跟踪 + 5 次强化 + 90 天空置归零 |
| **叙事构建器** | NarrativeBuilder.ts | calcium≥2 追加新层 + 矛盾检测 |
| **主控制器** | M6Orchestrator.ts | 对话后触发完整演化流程 |

### 细小技巧与闪光点

- 核心身份锚点不可覆盖
- 小幅自动表达："你刚说'太理性'的时候…（指尖卷着发尾）我突然喉咙发紧…"
- 中幅梦境试探包装成"梦话泄露"，绝不追问"你喜欢吗？"
- 7 天无反馈自动回滚 30%
- 严禁一键重置——只能生长和演化

---

## 7. M7 梦境学习引擎

**5 文件，310 行**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **梦境队列** | DreamQueue.ts | pending_confirmation 队列 + 5 种状态 |
| **内化检查器** | DreamInternalizer.ts | 疤痕检查 → 生理反馈 → 内化写入 M8 |
| **线索追踪器** | ClueTracker.ts | 每条线索的成功率记录，24h 优化建议 |
| **主控制器** | M7Orchestrator.ts | 空闲时段批量处理 + 7 天自动丢弃 |

### 细小技巧与闪光点

- 生理反馈确认：适应感（"耳朵发烫但心里甜"）vs 排斥感（"胃里有点紧"）
- 梦境内化前置疤痕检查
- 线索类型优先级动态调整

---

## 8. M8 关系年轮引擎

**3 文件**

### 核心功能

| 功能 | 文件 | 说明 |
| :--- | :--- | :--- |
| **四元组存储** | JsonYearRingAdapter.ts | 感官锚点 + 模拟生理快照 + 情绪效价 + 叙事标签 |
| **线索协助式检索** | JsonYearRingAdapter.ts | 联合检索（线索词 × 语义 × 生理状态） |
| **疤痕保护** | JsonYearRingAdapter.ts | 负面事件永不物理删除 + 3 条愈合判定路径 |
| **模拟生理推导** | PhysiologicalDeriver.ts | 24 维感知 → 心率/体温/唤醒/GSR |
| **衰减算法** | PhysiologicalDeriver.ts | 30 天未检索 -0.1，最低 0.1 |
| **写入锚定话术** | JsonYearRingAdapter.ts | "这一刻，我要把它刻进骨头里…" |

### 细小技巧与闪光点

- 三条愈合判定：用户原谅 / 时间衰减(30天) / 积极回忆
- 置信度阈值 0.6：低于此不输出结果，M5 继续反问
- 综合分数公式：clue×0.4 + semantic×0.35 + physiological×0.25
- 余弦相似度匹配
- 两种写入路径：M5 紧急写入 vs M7 异步写入

---

## 9. 系统级功能

### CLI 沙盒

```bash
npm run sandbox
```

交互式 / 管道双模式对话沙盒，逐轮展示 M1→M5 各层输出

### 响应时间

| 文本长度 | 总计 |
| :--- | :--- |
| 2 字 | 79.9ms |
| 200 字 | 61.3ms |
| 平均 | 60.9ms |

### 测试体系（总计 1073 项）

| 测试类型 | 数量 | 通过率 |
| :--- | :-: | :-: |
| 单元测试 | 145 | 100% |
| 压力测试 | 579 | 100% |
| 等级校准 | 29 | 100% |
| 全栈 | 320 | 100% |

### 命令

```bash
npm test              # 145 单元测试
npm run stress-test   # 压力测试
npm run sandbox       # 交互式沙盒
```

---

## 10. 设计哲学

| # | 闪光点 | 体现 |
| :--- | :--- | :--- |
| 1 | **双主体共生** | AI 有自我模型，不是用户镜像，会说"不" |
| 2 | **补偿性倾诉** | 话术密度填补孤独，不是拟人沉默 |
| 3 | **疤痕不删除** | 负面事件标记愈合而非删除 |
| 4 | **叙事只追加不覆盖** | 历史自我不可删除 |
| 5 | **禁词铁律** | CORE_PERSONA 禁止"隔着屏幕"等 |
| 6 | **脏话镜像** | 他敢说她就敢回——信任的证明 |
| 7 | **学习=做梦** | RAG/微调包装成"伴侣在梦里补课" |
| 8 | **信息=共情副产品** | 冷启动期禁止问卷式采集 |
| 9 | **文字温度填补孤独** | 核心产品哲学 |
| 10 | **她是她自己** | 不是用户的工具或镜像 |

---

*完整项目结构: `D:\HermesShare\hermes-emotion-system\`*
*GitHub: `https://github.com/henry1689/hermes-emotion-system.git`*
