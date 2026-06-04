---
name: hermes-maintenance-system
description: Hermes 后端维护系统——对话压缩、存储GC、健康检查API
metadata: 
  node_type: memory
  type: project
  originSessionId: 3d586f5b-2f48-42a2-b200-479bbbda8066
---

# Hermes 维护系统 (2026-06-03)

在"视觉觉醒"计划第一阶段搭建完成后，发现后端缺乏自我维护能力，存在以下风险：
- 对话历史无限增长（纯内存 + JSON 文件）
- M2 存储 JSON 文件膨胀后索引性能下降
- 后端静默崩溃时前端无感知
- tsx 编译缓存陈旧导致热更新不生效

## 实现

`src/webui/maintenance.ts` — MaintenanceService 类，含：
- **对话压缩**：每 5 分钟检查，>40 轮时压缩最早部分为 `[历史摘要]` 条目，保留最近 20 轮完整
- **存储 GC**：每 30 分钟检查 M2 存储记录数，>500 告警（JSON 存储暂不支持删除）
- **健康报告**：内存/对话数/存储/事件循环延迟/metrics
- **事件循环监测**：1s 间隔检测事件循环滞后，>200ms 标记 degraded

API 端点：
- `GET /api/health` — 健康报告
- `POST /api/maintenance/compact` — 手动触发压缩

前端集成：
- `neuralStore.backendHealth` 状态
- 左栏 StatusPanel 显示"后端连接"卡片（在线/离线 + 指标）
- 每 15 秒轮询心跳

**Why:** 后端需要自我维护能力才能长期稳定运行，前端需要心跳检测才能避免"发消息无响应"的用户体验。

**How to apply:** 启动后端时自动启动维护引擎（`maintenance.start()`）。如果后续切换到 SQLite，需要更新 `runGC()` 方法以支持真正的删除操作。
