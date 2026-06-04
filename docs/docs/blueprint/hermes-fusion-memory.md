---
name: hermes-fusion-memory
description: 灵肉伴侣融合记忆系统 — 24D情感向量作为记忆主索引的SQLite存储架构
metadata: 
  node_type: memory
  type: project
  originSessionId: 3d586f5b-2f48-42a2-b200-479bbbda8066
---

# 融合记忆系统 v2 (2026-06-03)

## 核心哲学
**情感维度本身就是记忆，不是记忆的附属属性。** 对灵肉伴侣而言，"你怎么感受一件事"和"这件事本身"同等重要。

## 核心数学
- **钙化 = L2范数**: `calcium = ||v|| / sqrt(24)`，取代旧的 `Base + Boost + Threat` 三段公式
- **情感相似度 = 象限加权余弦**: 6种模式(balanced/mood_congruent/intimacy_search/cognitive_match/social_resonance/by_calcium)
- **记忆强度 = S曲线**: `initial = 0.1 + 0.9/(1+e^(-6*(c-0.5)))`，衰减率 ∝ 钙化⁻¹
- **重新巩固**: 每次召回 `boost = 0.05 * (1 - strength)`，越弱增强越大

## 护城河
MemOS/Obsidian/Gbrain 优化的是"事实精度"和"任务完成率"；Hermes 优化的是"爱的浓度"——24D情感向量作为记忆主索引。

## 行业对标
- **MemOS (2025)**: 操作系统隐喻，张量化MemCube+知识图谱，无情感耦合
- **Obsidian/Zep**: 知识库隐喻，Markdown+双向链接，几乎无遗忘机制
- **Gbrain/Memory-R1**: 策略游戏隐喻，RL主动遗忘，弱情感耦合(仅奖励信号)
- **Hermes 灵肉仿生**: 生物大脑+情感躯体，24D向量主索引，唯一将情感动力学作为记忆第一性原理的系统

## 文件结构
- `src/fusion/schema.sql` — SQLite DDL (6表)
- `src/fusion/math.ts` — 核心算法库(向量/钙化/相似度/衰减/增强/晋升)
- `src/fusion/types/index.ts` — EmotionalMemoryRecord + 检索类型
- `src/fusion/SQLiteAdapter.ts` — sql.js封装(写入/情感检索/衰减/晋升/实体关系)
- `src/fusion/FusionStorageAdapter.ts` — 双写(SQLite主+JSON Zone备份)，兼容旧接口
- `src/m7/InductionScheduler.ts` — 每小时归纳调度器

## API端点
- `POST /api/chat` — 聊天(24D向量自动入库)
- `POST /api/emotion-search` — 情感相似度搜索(暴露composite/emotional/topic/entity/calcium评分)
- `GET /api/landscape` — 情感地形图(peaks + scars)
- `GET /api/inductions` — 历史归纳记录
- `POST /api/maintenance/decay` — 触发衰减维护

**Why:** 旧JSON存储是扁平档案，无法支持情感检索、遗忘曲线和记忆强度分级。

**How to apply:** 后端启动时自动初始化SQLite，新消息走decide→write(perception)管道。旧数据迁移脚本(src/fusion/migration.ts)待编写。
