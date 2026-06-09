# 全系统完整性 · System Integrity Protocol

## 铁律

**每一次修改都必须站在全局高度，系统思维，关联侧重考量。** 改完后全系统验证通过才算完成，绝不允许孤立地解决一个问题而破坏另一个环节。

---

## 第一步：修改前 — 影响面分析

在动任何文件之前，必须先回答：

### 1.1 我改的是哪个子系统？

| 子系统 | 端口 | 位置 |
|--------|:----:|------|
| 🎭 玉瑶·太虚境 (WenStar) | 3001 | `D:\wenstar\src\webui\` |
| 🌟 粒子前端 | 5174 | `D:\wenstar\ui\` |
| 🧠 仿生智脑 (Bionic Engine) | 7200 | `D:\wenstar\bionic-cognitive-engine\` |
| 🎵 情感谱曲引擎 | 8100 | `D:\HermesShare\yuyao-emotion-composer\` |
| 🎤 TTS 语音 | 8765 | `D:\wenstar\src\webui\tts_server.py` |
| 🏛️ 景幻监控台 | 5500 | `D:\wenstar\bionic-cognitive-engine\dashboard.html` |

### 1.2 这个改动会影响哪些子系统？

- 是否改了 API 接口契约？→ 影响调用方
- 是否改了数据模型？→ 影响存储和检索
- 是否改了环境变量/配置？→ 影响启动
- 是否改了端口？→ 影响跨系统通信
- 是否改了依赖？→ 影响部署

### 1.3 降级影响

如果这个改动出了问题，哪些系统会受影响？降级策略是什么？

---

## 第二步：修改中 — 编码规范

1. **不破坏现有契约** — 增加字段而不是修改现有字段，向后兼容
2. **不删"僵尸代码"** — 存在就有原因，没找到原因之前不得清除
3. **不改无关文件** — 一次改动只涉及有明确关联的文件
4. **不在一个系统里写另一个系统的逻辑** — 保持五个服务独立

---

## 第三步：修改后 — 全系统验证

所有改动完成后，**必须执行以下全系统检查**，每一项通过才能算完成：

### 3.1 所有服务在线

```bash
for p in 3001 5174 8765 7200 8100 5500; do
  echo "$p: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$p/ 2>/dev/null || echo 'DOWN')"
done
# 8100 根路由返回 404 是正常设计，用 health 验证
curl -s http://localhost:8100/api/v1/emotion/health
```

### 3.2 核心功能回归

```
玉瑶对话:   POST http://localhost:3001/api/chat  → 回复正常
仿生检索:   GET  http://localhost:7200/api/v1/search?q=测试 → 有结果
仿生存储:   POST http://localhost:7200/api/v1/ingest-test → status=injected
谱曲分析:   POST http://localhost:8100/api/v1/emotion/compose → VAD完整
TTS语音:    POST http://localhost:8765/tts → url正常
监控台:     GET  http://localhost:5500/dashboard.html → HTML完整
```

### 3.3 三库数据一致性

```bash
curl -s http://localhost:7200/api/v1/stats
# 确认 gold 数值合理（非空，每次对话后+1）
```

### 3.4 前端可访问

```bash
curl -s -o /dev/null -w '%{http_code}' http://localhost:5174/
# 返回 200
```

---

## 第四步：异常处理

如果全系统验证中**任何一项失败**：

1. 立即回滚改动
2. 分析失败原因（不猜测、不推测）
3. 修复后重新执行全系统验证
4. 直到全部通过才算完成

---

## 引用

关联记忆：[[system-integration-20260609]]
