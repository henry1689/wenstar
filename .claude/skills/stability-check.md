---
name: stability-check
description: 稳定性影响面分析（已自动常驻）
---

# 稳定性检查 · Stability Check

## 状态：🟢 已自动常驻（无需调用）

此规则已写入 `CLAUDE.md` 永久行为规则第 1 条，改代码前自动分析。**不再需要手动调用。**

## 何时执行

---

## 第一步：修改前 - 影响面分析

在动任何文件之前，回答以下问题：

### 1.1 我改的是什么？
要修改的文件路径：
要修改的符号/函数/接口：

### 1.2 谁依赖它？
对以下每种依赖类型，执行搜索并列出结果：

```bash
# 导入关系 — 哪些文件 import 了这个文件
grep -r "from '.*<文件名>'\|from \".*<文件名>" --include="*.ts" src/

# 接口/类型 — 如果改的是 interface/type，查所有实现
grep -r "implements <接口名>" --include="*.ts" src/

# 如果改的是 ChatContext / processChat 签名
# 必须检查 server.ts 中调用 processChatNew() 的参数
```

### 1.3 数据流路径
画出从改动点到最终效果的完整链路：
```
输入 → [文件A] → [文件B] → [文件C] → 输出
```

标记每个环：是纯函数还是有副作用？写入数据库？修改 LLM prompt？

---

## 第二步：修改中 - 变更约束

### 2.1 接口兼容
- [ ] 新增字段用 `?` 可选（如 `somaticMemory?: SomaticMemory`）
- [ ] 不改已有函数的签名（返回值类型、参数数量/类型）
- [ ] 如果必须改签名，一次性改完所有调用点

### 2.2 流程完整性
- [ ] `knowledgeBaseText` 赋值后不会被后续逻辑意外覆盖？（roleplay问题）
- [ ] `enrichedHistory` 注入不会污染不相关的上下文？（roleplay污染问题）
- [ ] `return` 结果不会短路更优路径？（hybridSearch覆盖问题）
- [ ] **五重铁律是否仍被注入？** (`FIVE_PROTOCOLS` 在 `buildSystemPrompt` 中 level>=1 时激活)
- [ ] 协议知识库文档 `kn_mq27esvy_zkq3` 是否存在？
- [ ] 角色扮演路径下 CORE_PERSONA 是否完全被 `prompt = knowledge` 替换？
- [ ] **表达层工具是否仍被激活？** (`ExpressionSpecController`, `IntimateRenderer`, `ThinkingPauseInjector` 的 import 在 `DeepSeekLLMProvider.ts` 和 `HumanisticCalibrator.ts` 中是否存在？)
- [ ] **M5 测试是否通过？** (`npx vitest run src/m5/__tests__/M5Orchestrator.test.ts`)
- [ ] **M8 生理检索函数是否被导入？** (`physiologicalCosineSimilarity`, `calculateCompositeScore`, `calculateEntryWeight` 在 `M8FusionAdapter.ts` 中存在 import)
- [ ] **M8 实时晋升是否激活？** (`chat.ts` 中 `promoteToLandmark(dna.branch_id, ...)` 在 calcium_level>=3 时调用)
- [ ] **SomaticMemory 链路是否完整？** (`server.ts` 中 `new SomaticMemory(storage.getSQLite())` + `chat.ts` 中 `ctx.somaticMemory.record()` + `getActiveSomaticContext()` 全部存在？)

---

## 第三步：修改后 - 验证

### 3.1 编译验证
```bash
npx tsc --noEmit --pretty
```
必须零错误。有错就修，修完再继续。

### 3.2 回归测试清单（根据改动范围选择）

**服务器基础：**
```bash
curl http://localhost:3000/api/health
```

**知识库搜索：**
```bash
# 完整句子搜索
curl "http://localhost:3000/api/knowledge?search=林土锋是谁"
# 分解搜索
curl "http://localhost:3000/api/knowledge?search=林土锋"
```

**聊天召回（知识库连接）：**
```bash
node -e "fetch('http://localhost:3000/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'你知道林土锋是谁吗'})}).then(r=>r.json()).then(d=>console.log(d.reply?.includes('部下')?'OK':'FAIL', d.reply?.substring(0,80)))"
node -e "fetch('http://localhost:3000/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'你在知识库看过红楼逸事吗'})}).then(r=>r.json()).then(d=>console.log(d.reply?.includes('看过')?'OK':'FAIL', d.reply?.substring(0,80)))"
```

**角色扮演：**
```bash
node -e "
(async ()=>{
  await fetch('http://localhost:3000/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'你扮演妙玉吧'})}).then(r=>r.json()).then(d=>console.log('SETUP:',d.reply?.includes('妙玉')?'OK':'FAIL'));
  await fetch('http://localhost:3000/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'是变了那个妙玉'})}).then(r=>r.json()).then(d=>console.log('CONTINUE:',d.reply?.includes('角色')||d.reply?.includes('妙玉')?'OK':'FAIL', d.reply?.substring(0,60)));
})()
```

**人际关系提取 + 假阳性检查：**
```bash
node -e "
fetch('http://localhost:3000/api/knowledge?search=&limit=100').then(r=>r.json()).then(d=>{
  const people = d.items?.filter(i => i.source_type==='person') || [];
  const bad = people.filter(p => !/[张王李赵陈刘杨黄吴周徐孙马胡朱郭何罗高林郑梁谢宋唐韩曹许邓萧冯曾程蔡彭潘袁于董余叶蒋杜苏魏吕丁贾沈任姚卢傅钟崔廖谭汪范金方石夏谭韦贾邹邱熊孟秦阎薛侯雷白龙段郝孔邵史毛常万顾赖武康贺严尹钱施牛洪龚妈爸爹娘哥姐弟妹老小]/.test(p.title));
  console.log('PASS:', people.length, 'people,', bad.length === 0 ? 'ZERO false positives' : 'FAIL: ' + bad.map(b=>b.title).join(','));
})
"
```

### 3.3 日志检查
```bash
grep -i "error\|warn\|fail\|401\|EADDR" /tmp/server.log | grep -v "Warning: Indexing"
```
预期：无意外错误。已知 warning（如"Indexing all PDF objects"）可接受。

---

## 第四步：改动总结

在返回给用户前，给出：
- 改了什么文件（列表）
- 每个文件改了哪些行、为什么改
- 回归测试结果（OK/FAIL）
- 风险说明：这次改动可能影响哪些功能

---

## 常见崩塌模式（防复发清单）

| # | 模式 | 案例 | 预防 |
|---|------|------|------|
| 1 | 改签名不追调用点 | `ChatContext` 加字段但不改 `server.ts` | 改 interface 后 grep 所有实现 |
| 2 | 搜索结果短路 | `hybridSearch` return 覆盖分解搜索 | 所有搜索路径都 fallback 检查 |
| 3 | 全局变量先后覆盖 | `knowledgeBaseText` 被 KB→RP 覆盖 | 变量赋值后检查是否会被后面逻辑重写 |
| 4 | 历史污染上下文 | 角色扮演时注入 KB 历史 | 注入前检查是否在角色扮演中 |
| 5 | 正则编码不匹配 | `✅` vs literal `✅` | Python/TS 混合改文件用统一编码 |
| 6 | 假阳性扫描 | 姓氏暴力扫描抓"厉害""家居的" | 按精确上下文匹配，不靠字典暴力 |

---

## 快速命令参考

```bash
# 编译
npx tsc --noEmit --pretty

# 清 tsx 缓存（Windows）
rm -rf "$TEMP/tsx-"*

# 杀进程
for pid in $(netstat -ano | findstr ":3000" | awk '{print $NF}' | sort -u); do taskkill //F //PID $pid; done

# 重启服务器
npx tsx src/webui/server.ts

# 重启前端
cd ui && npx vite --host
```
