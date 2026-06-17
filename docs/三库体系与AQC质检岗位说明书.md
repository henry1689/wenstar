---
id: "manual_three_vaults_and_aqc"
title: "三库体系与AQC质检岗位说明书"
type: "protocol"
source_type: "protocol"
tags:
  - "三库"
  - "AQC"
  - "景幻仙姑"
  - "岗位职责"
---

# 太虚境·三库体系与AQC质检岗位说明书

> **文档版本**: v1.0  
> **最后更新**: 2026-06-17  
> **保管者**: 景幻仙姑（大英图书馆馆长）  
> **适用范围**: 玉瑶·太虚境 全系统  
> **铁律**: 以下所有流程均不干涉现有数据管线，只做标记和记录

---

## 第一部分：三库体系

### 一、砂金库（Alluvial Vault）

#### 1.1 定义
原始对话材料的暂存区，对应 `conversations.json` 文件。

#### 1.2 职责
- 永久保留最近 250 轮对话原文
- 为 LLM 提供最近 60 轮对话上下文
- 承载"砂金→金库→黑钻"提炼管线的第一道工序

#### 1.3 存储方式

| 项目 | 内容 |
|:-----|:------|
| **物理文件** | `data/webui/conversations.json` |
| **数据结构** | JSON 数组，`[{role, content, timestamp}]` |
| **存储量** | 最多 500 条（250 轮） |
| **LLM 可见** | 最近 60 条（30 轮） |

#### 1.4 数据流入
```
用户说话 → chat.ts:1038 → conversations.json 追加
```

#### 1.5 数据流出
- M9 WorkingMemory 每 60 秒 consolidated → 写入 M2（金库入口）
- maintenance.ts 压缩（超 200 条时触发）
- 压缩策略：已关联金库的保留 `(已存金库)` 标记，未存的日常对话丢弃

#### 1.6 工作流程
```
对话进行中
    ↓ 实时追加
conversations.json（砂金库）
    ↓ 每 60 秒（M9 巩固）
    钙质 ≥ 1 + 有实体 → M2（金库）
    钙质 = 0 → 丢弃
    ↓ 超过 200 条（压缩）
    关联 M2 检测 → (已存金库) / 丢弃
```

---

### 二、金库（Gold Vault = M2）

#### 2.1 定义
情感记忆的主存储区，对应 SQLite `memories` 表。

#### 2.2 职责
- 存储带 24D 情感向量的重要记忆
- 日常回忆检索（24D 余弦相似度 + 关键词检索）
- 为 M7 梦境引擎提供素材

#### 2.3 存储方式

| 项目 | 内容 |
|:-----|:------|
| **物理文件** | `data/webui/fusion_memory.db` |
| **表名** | `memories` |
| **核心字段** | `raw_input`(原文), `perception_json`(24D向量), `calcium_level`(钙质), `effective_strength`(记忆强度), `emotion_vector`, `vad_spectrum`(曲谱) |

#### 2.4 数据流入
```
chat.ts:368 → M9 WorkingMemory.push()
    → consolidate() 毕业判定
    → FusionStorageAdapter.write() → SQLite memories 表
```

**毕业条件**（满足任一即入金库）：
| 条件 | 说明 |
|:-----|:------|
| 钙质 ≥ 2 | 固体级以上（值得记） |
| 钙质 = 1 + 有实体 | 液体级但含重要实体 |
| 安全阀（≥ 6 轮） | 防止缓冲堆积 |

#### 2.5 数据流出
- **M4 读取** — `MemoryRetriever.retrieveMemories()` + `findByEmotionalSimilarity()`
- **M7 梦境** — `InductionScheduler` 每小时扫描
- **黑钻提炼** — `autoPromoteCandidates()` 从金库提取高质量记忆

---

### 三、黑钻库（Black Diamond Vault）

#### 3.1 定义
精选歌单·永恒珍藏，对应 SQLite `black_diamond` 表。

#### 3.2 职责
- 存储最珍贵的记忆（结构化摘要 + 情感标签）
- 对话时优先检索（`【珍藏记忆】` 标签注入）
- 永久保留，不可压缩

#### 3.3 存储方式

| 项目 | 内容 |
|:-----|:------|
| **物理位置** | `fusion_memory.db` → `black_diamond` 表 |
| **核心字段** | `summary`(摘要), `emotion_tag`(情感标签), `source_id`(来源金库ID), `recall_count`(回忆次数), `tags`, `notes` |
| **生命周期** | 永久（无衰减机制，待阶段二完善） |

#### 3.4 数据流入
- **自动提炼** — `autoPromoteCandidates()` 扫描金库，钙质≥2 + recall≥3 自动提升
- **手动新增** — `POST /api/vault/diamond`
- **手动提炼** — `POST /api/vault/promote` 指定金库ID

#### 3.5 数据流出
- **对话检索** — `chat.ts` 黑钻库检索块 → `memoryFragments` → M5 表达层
- **Dashboard 查看** — `GET /api/vault/diamond`

#### 3.6 三库流转关系
```
砂金库（原始对话）
    ↓ M9 巩固（60秒/次）
金库（24D情感记忆）
    ↓ 自动/手动提炼
黑钻库（精选歌单·永恒珍藏）
    ↑ 对话时优先检索 → M5 → 玉瑶回复
```

---

## 第二部分：AQC 质检岗位说明书

### 四、岗位概述

AQC（Automatic Quality Control）质检系统独立于核心管线运行，是两个不参与数据流转但提供质量评估的监督岗。

**设计铁律**：
- 不修改现有代码路径
- 不拦截数据流
- 所有结果写入独立的 `aqc_records` 表
- 只做标记，不下结论

---

### 五、砂金质检员（SandQC）

#### 5.1 岗位信息

| 项目 | 内容 |
|:-----|:------|
| **岗位名称** | 砂金质检员 (SandQC) |
| **所属部门** | 三库管理处·AQC 质检中心 |
| **汇报对象** | 景幻仙姑 |
| **管辖范围** | 砂金库（conversations.json 最新对话） |

#### 5.2 岗位职责

1. **日常巡检**：每小时自动扫描砂金库最新对话
2. **质量评估**：对每条对话进行三项标准的评分
3. **结果记录**：将评估结果写入 `aqc_records` 表
4. **异常上报**：发现连续低质量对话时记录告警

#### 5.3 工作内容

每小时执行一次，扫描最近 30 条用户对话，逐条评分：

**评分标准**：

| 标准 | 分值 | 说明 |
|:-----|:-----|:------|
| 消息长度 > 30 字 | +0.3 | 有实质内容 |
| 含非自我实体 | +0.4 | 提及他人/地点/事件（匹配：妈妈/爸爸/老婆/老公/朋友/同事/客户/公司/工作/项目/家） |
| 含情感词 | +0.3 | 有情绪表达（匹配：难过/开心/伤心/生气/感动/温暖/焦虑/担心/期待/失望/幸福等） |

**判定标准**：
| 总分 | 结论 | 标记 |
|:-----|:-----|:-----|
| ≥ 0.4 | 高质量对话 | `approved` |
| < 0.4 | 待观察 | `pending` |

#### 5.4 工作流程
```
每小时定时器触发
    ↓
读取砂金库最近 30 条用户对话
    ↓
逐条评分（长度 + 实体 + 情感）
    ↓
写入 aqc_records（source_type='sand'）
    ├── score ≥ 0.4 → status = 'approved'
    └── score < 0.4 → status = 'pending'
    ↓
完成
```

#### 5.5 执行标准

| 指标 | 标准 | 说明 |
|:-----|:-----|:------|
| 扫描频率 | 每 1 小时 | 不得高于 30 分钟 |
| 扫描范围 | 最近 30 条 | 避免重复扫描 |
| approved 阈值 | ≥ 0.4 | 经验值，可动态调整 |
| 判定结果存储 | `aqc_records` 表 | 独立存储，不修改砂金库 |
| 中断处理 | 异常静默跳过 | 不阻塞主流程 |

---

### 六、金库质检员（GoldQC）

#### 6.1 岗位信息

| 项目 | 内容 |
|:-----|:------|
| **岗位名称** | 金库质检员 (GoldQC) |
| **所属部门** | 三库管理处·AQC 质检中心 |
| **汇报对象** | 景幻仙姑 |
| **管辖范围** | 金库（M2 memories 表） |

#### 6.2 岗位职责

1. **日常巡检**：每小时自动扫描金库最新记忆
2. **质量评级**：对每条记忆进行四项标准评分
3. **质量标记**：approved / rejected 标记
4. **趋势分析**：记录金库整体质量变化趋势

#### 6.3 工作内容

每小时执行一次，扫描最近 50 条金库记忆，逐条评分：

**评分标准**：

| 标准 | 分值 | 说明 |
|:-----|:-----|:------|
| recall_count ≥ 3 | +0.4 | 被多次回忆（高频检索） |
| calcium_level ≥ 2 | +0.3 | 钙质固体级以上 |
| is_landmark = 1 | +0.3 | 已被标记为地标记忆 |
| effective_strength > 0.5 | +0.2 | 记忆强度高 |

**判定标准**：
| 总分 | 结论 | 标记 |
|:-----|:-----|:-----|
| ≥ 0.4 | 高质量记忆 | `approved` |
| < 0.4 | 低质量记忆 | `rejected` |

#### 6.4 工作流程
```
每小时定时器触发
    ↓
读取金库最近 50 条记忆
    ↓
逐条评分（recall + calcium + landmark + strength）
    ↓
写入 aqc_records（source_type='gold'）
    ├── score ≥ 0.4 → status = 'approved'
    └── score < 0.4 → status = 'rejected'
    ↓
完成
```

#### 6.5 执行标准

| 指标 | 标准 | 说明 |
|:-----|:-----|:------|
| 扫描频率 | 每 1 小时 | 与 SandQC 同步 |
| 扫描范围 | 最近 50 条 | 按 created_at 倒序 |
| approved 阈值 | ≥ 0.4 | 经验值，可动态调整 |
| rejected 机制 | 标记不删除 | 不在本次迭代中删除记忆 |
| 首次启动 | 启动后 10 分钟 | 避免与维护引擎竞争 |

---

### 七、AQC API 参考

#### 7.1 质检报告

```
GET /api/aqc/report
```

返回示例：
```json
{
  "sand": { "pending": 10, "approved": 3, "lastRun": "2026-06-17T03:24:56Z" },
  "gold": { "pending": 0, "approved": 5, "rejected": 45, "lastRun": "2026-06-17T03:24:56Z" }
}
```

#### 7.2 手动触发质检

```
POST /api/aqc/run
```

返回示例：
```json
{
  "status": "ok",
  "sand": { "scanned": 10, "approved": 3, "pending": 7 },
  "gold": { "scanned": 50, "approved": 5, "rejected": 45 }
}
```

#### 7.3 查看质检记录

```
GET /api/aqc/records
```

返回最近 20 条质检记录，含摘要、评分、状态。

---

### 八、Dashboard 监控标识

在景幻监控台中，两个质检节点显示格式：

```
🔍SandQC  3/10    （approved/pending）
🔍GoldQC  5/45    （approved/rejected）
```

---

> **文档保管人**: 景幻仙姑  
> **下次审核日期**: 2026-07-17  
> **关联模块**: src/app/aqc/AQCEngine.ts / src/m2/schema.sql / src/webui/server.ts
