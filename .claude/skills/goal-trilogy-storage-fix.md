---
name: goal-trilogy-storage-fix
description: 三段式存储全链路修复 — conversations合入fusion_memory.db + 补齐dna_root_id三段关联 + 闭组回填dialog_group_id
---

# /goal 三段式存储全链路修复

## 目标
修复三段式存储（DNA代码 + 语义块 + 原始对话）之间的数据丢失、关联断裂、双库分裂问题，确保刷新网页或重启后对话内容完整恢复，三段数据通过`dna_root_id`和`dialog_group_id`双向可追溯。

## DNA完整定义

根码格式：`DNA-YYYYMMDD-HHmm-NNNN-HX`
- HY瑶印码 = SHA256("HY" + 日期) 末位hex，同一日期一致

Sub ID格式：`{根码}.{模块代码}.{流水号}`  
模块代码: M1/M3/MEM/BD/GRAPH

对话组ID：`dialog_group_id = dna_root_id + '_DG_' + seqPos`

加工节点后缀：
- 锚点: `_DG_NNNN_ANCHOR` → memories表
- 碎片: `_DG_NNNN_CHUNK_NNN` → memories表
- 黑钻: `_BD` → black_diamond表

## 三段+三库定义

段① DNA代码 — dna_root_id字段(全表)，对话组启动时M1生成
段② 语义块 — memories表，flushDialogGroup闭组时写入
段③ 原始对话 — conversations表，每轮对话实时写入

三段同时存入砂金库 → 钙化≥1 → 金库(24D语义块) → 钙化≥4.5 → 黑钻库(永久)

## 执行单元

### 单元1：合库
- `src/m2/SQLiteAdapter.ts` — initialize()末尾CREATE conversations表（含dna_root_id/dialog_group_id/dialog_round/is_compacted/is_test字段+索引）
- `src/m2/ConversationDB.ts` — 构造函数接受existingDb参数共享sql.js实例，flush空操作
- `src/m2/FusionStorageAdapter.ts` — 新增getConversationDB()方法
- `src/webui/server.ts:244` — 从独立new改为new ConversationDB(undefined, storage.getSQLite().getDb())
- SQLiteAdapter新增getDb()方法暴露db实例

### 单元2：补齐三段关联字段
- `src/webui/chat.ts:1661-1662` — insertConversation新增参数 dnaRootId: (dna as any).dna_root_id
- `src/webui/chat.ts` flushDialogGroup末尾 — 回填dialog_group_id到conversations表
- `src/m2/ConversationDB.ts` — ALTER TABLE追加dna_root_id/dialog_group_id/dialog_round/is_compacted/is_test
- `src/m2/SQLiteAdapter.ts:263` — memories INSERT补dna_root_id列

### 单元3：存量迁移+清理
- 新建 `scripts/migrate-conversations.ts`：旧conversations.db→fusion_memory.db去重迁移+反向匹配回填dna_root_id
- `src/webui/server.ts`：清理脚本改为`DELETE FROM conversations WHERE is_test=1`
- 全链搜索删除recordTurn()函数定义

### 单元4：启动自检
- `src/webui/server.ts` — loadConversationHistory末尾输出三段关联率日志
- 新增 `GET /api/health/storage` 巡检端点

## 验收标准
- [ ] conversations表在fusion_memory.db内（启动日志确认）
- [ ] 新对话写入后dna_root_id非空（SQL查询）
- [ ] 闭组后dialog_group_id回填到conversations（SQL查询）
- [ ] 三段可联表追溯: SELECT ... JOIN ON dna_root_id
- [ ] 重启后对话完整恢复（curl /api/conversation）
- [ ] 清理只删is_test=1（模拟验证）
- [ ] 编译零错误（npx tsc --noEmit）
