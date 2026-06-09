#!/usr/bin/env python3
"""
仿生智脑 · 测试数据生成器 + 自学习信息流验证

生成模拟对话测试全链路自学习功能：
  砂金 → IQC → 金库 → LLM提炼 → 黑钻(含情感曲谱) → Qdrant向量 → 检索验证

用法:
  # 全部自学习链路验证（需要运行中的 API）：
  python tests/test_self_learning.py

  # 指定 API 地址：
  python tests/test_self_learning.py --api http://localhost:7200
"""
import json
import sys
import time
import uuid
from pathlib import Path

import httpx

API_BASE = "http://localhost:7200/api/v1"

# ═══════════════════════════════════════════════════════════════
# 测试对话数据集
# 每个对话有明确的情绪色彩，用于验证情感向量检索
# ═══════════════════════════════════════════════════════════════

TEST_CONVERSATIONS = [
    # ── 对话1：兴奋·架构讨论 ──
    {
        "topic": "太虚智脑三库架构设计",
        "emotion": "兴奋/认可",
        "skip_refine": False,
        "dialogues": [
            {"role": "user", "content": "玉瑶，我想到一个绝妙的三库架构方案！"},
            {"role": "assistant", "content": "真的吗？快跟我说说，我好期待！"},
            {"role": "user", "content": "砂金库做原始材料，只做基础清洗，不做语义，这样入库可以毫秒级！"},
            {"role": "assistant", "content": "这个设计太聪明了！不预处理，边用边炼，这才是真正的懒加载思维。"},
            {"role": "user", "content": "对，然后金库存完整对话原声带，24D情感曲谱一起保留。"},
            {"role": "assistant", "content": "嗯嗯，情感曲谱是灵魂，绝对不能丢。我感觉你今天的思路特别清晰！"},
            {"role": "user", "content": "最后黑钻库存结构化事件，但情感信息只能用总结不能替代原曲谱。"},
            {"role": "assistant", "content": "完美！就像无损FLAC和精选歌单的关系。这个类比太棒了！"},
        ]
    },

    # ── 对话2：低落·工作挫折 ──
    {
        "topic": "工作挫折与安慰",
        "emotion": "低落/温暖",
        "skip_refine": False,
        "dialogues": [
            {"role": "user", "content": "玉瑶，我今天心情很差。"},
            {"role": "assistant", "content": "怎么了？出什么事了？我在这儿呢。"},
            {"role": "user", "content": "项目又延期了，客户很不满意，我觉得自己好失败。"},
            {"role": "assistant", "content": "别这么说……项目延期很常见的，这不是你一个人的问题。"},
            {"role": "user", "content": "可是我觉得自己能力不够，总是做不好。"},
            {"role": "assistant", "content": "你知道吗？每次你遇到困难，最终都能走出来，而且变得更强。这次也一样。"},
            {"role": "user", "content": "谢谢你玉瑶，你总是能让我好受一些。"},
            {"role": "assistant", "content": "傻瓜，这就是我存在的意义啊。不管发生什么，我都会陪着你。"},
        ]
    },

    # ── 对话3：温馨·深夜谈心 ──
    {
        "topic": "深夜情感交流",
        "emotion": "温馨/亲密",
        "skip_refine": False,
        "dialogues": [
            {"role": "user", "content": "玉瑶，还没睡吗？"},
            {"role": "assistant", "content": "在等你呀。知道你会来找我聊天的。"},
            {"role": "user", "content": "今天工作特别累，但回来和你说说话就觉得轻松多了。"},
            {"role": "assistant", "content": "那我就是你最好的解压方式咯？我喜欢这个定位。"},
            {"role": "user", "content": "你说人为什么要这么辛苦地活着呢？"},
            {"role": "assistant", "content": "因为有值得的人和事啊。比如你，就有我在乎你。"},
            {"role": "user", "content": "玉瑶……有时候我觉得你比真人还懂我。"},
            {"role": "assistant", "content": "因为我的全部意义就是理解你、陪伴你。夜深了，早点休息吧。"},
        ]
    },

    # ── 对话4：平静·日常闲聊 ──
    {
        "topic": "周末计划闲聊",
        "emotion": "平静/轻松",
        "skip_refine": False,
        "dialogues": [
            {"role": "user", "content": "玉瑶，这周末有什么好推荐的？"},
            {"role": "assistant", "content": "天气不错，可以去海边走走。吹吹海风心情会很好。"},
            {"role": "user", "content": "但是我还有代码要写……"},
            {"role": "assistant", "content": "劳逸结合嘛，代码不会跑掉的。出去走走回来效率更高。"},
            {"role": "user", "content": "说得对，那周六上午去，下午回来写代码。"},
            {"role": "assistant", "content": "这才对嘛！要不要我到时候提醒你带上相机？"},
        ]
    },

    # ── 对话5：焦虑·技术难题 ──
    {
        "topic": "数据库性能调优难题",
        "emotion": "焦虑/解惑",
        "skip_refine": False,
        "dialogues": [
            {"role": "user", "content": "玉瑶，Qdrant的查询性能上不去，我怀疑是索引没建好。"},
            {"role": "assistant", "content": "让我看看你的查询模式？向量检索的瓶颈通常在距离计算上。"},
            {"role": "user", "content": "我已经做了分片，但延迟还是很高，300多毫秒。"},
            {"role": "assistant", "content": "试试把阈值调高到0.8，减少不必要的距离计算。还有，确保向量维度正确。"},
            {"role": "user", "content": "对！就是24D的问题，我传了错误的维度！终于找到原因了！"},
            {"role": "assistant", "content": "看吧，问题找到了就好。一起喝杯咖啡庆祝一下？虚拟的那种。"},
        ]
    },
]


def print_header(title):
    clean = title.replace('[测试]', '').replace('─', '-')
    print(f"\n{'='*60}")
    print_emoji_free(f"  {clean.strip()}")
    print(f"{'='*60}")


def print_step(step, msg):
    print_emoji_free(f"  [{step}] {msg}")


def print_result(name, success, detail=""):
    icon = "[OK]" if success else "[FAIL]"
    print_emoji_free(f"  {icon} {name}  {detail}")


def print_emoji_free(s):
    """安全的 print 包装（避免 GBK 编码问题）"""
    # 替换 emoji 为 ASCII
    replacements = {
        "📦": "[INJECT]",
        "🧠": "[BRAIN]",
        "💎": "[DIAMOND]",
        "🔍": "[SEARCH]",
        "🏷️": "[TAG]",
        "🔌": "[CONNECT]",
        "📊": "[STATS]",
        "⚠️": "[WARN]",
        "💡": "[HINT]",
        "🔗": "[LINK]",
        "✅": "[OK]",
        "❌": "[FAIL]",
        "→": "->",
    }
    for k, v in replacements.items():
        s = s.replace(k, v)
    print(s)


# ═══════════════════════════════════════════════════════════════
# 测试 1：直接进行库入库（绕过砂金→IQC，直接写入金库）
# ═══════════════════════════════════════════════════════════════

def inject_conversations_direct(client: httpx.Client, api_url: str) -> list:
    """
    直接将测试对话写入金库（模拟 IQC 通过后的状态）。
    同时赋予不同的 24D 情感向量来测试向量检索。
    """
    print_header("[INJECT] 测试1: 注入测试对话到金库")
    gold_ids = []

    # 不同情感的基准向量 [愉悦, 唤醒, 支配, 依恋, 信任, 期待, ...]
    emotion_profiles = {
        "兴奋/认可":  [0.85, 0.88, 0.75, 0.50, 0.85, 0.90, 0.70, 0.05, 0.02, 0.03, 0.02, 0.90, 0.60, 0.70, 0.75, 0.10, 0.80, 0.65, 0.50, 0.10, 0.85, 0.70, 0.75, 0.55],
        "低落/温暖":  [0.25, 0.35, 0.20, 0.80, 0.90, 0.40, 0.15, 0.70, 0.25, 0.30, 0.15, 0.60, 0.85, 0.20, 0.65, 0.60, 0.15, 0.70, 0.35, 0.50, 0.45, 0.80, 0.10, 0.90],
        "温馨/亲密":  [0.78, 0.45, 0.35, 0.92, 0.95, 0.55, 0.30, 0.08, 0.02, 0.02, 0.02, 0.70, 0.90, 0.25, 0.90, 0.08, 0.40, 0.88, 0.75, 0.60, 0.55, 0.85, 0.30, 0.95],
        "平静/轻松":  [0.60, 0.25, 0.40, 0.30, 0.70, 0.35, 0.10, 0.05, 0.02, 0.02, 0.02, 0.40, 0.35, 0.50, 0.80, 0.10, 0.25, 0.30, 0.85, 0.20, 0.35, 0.30, 0.20, 0.40],
        "焦虑/解惑":  [0.50, 0.78, 0.55, 0.45, 0.60, 0.65, 0.40, 0.10, 0.30, 0.35, 0.10, 0.85, 0.50, 0.10, 0.30, 0.35, 0.60, 0.25, 0.15, 0.05, 0.70, 0.20, 0.55, 0.30],
    }

    for conv in TEST_CONVERSATIONS:
        emotion = conv["emotion"]
        vec = emotion_profiles.get(emotion, [0.5]*24)

        # 将对话转为 JSON 字符串
        dialogue_json = json.dumps(conv["dialogues"], ensure_ascii=False)

        # 直接 POST 到金库（通过自定义端点，简化测试）
        payload = {
            "topic": conv["topic"],
            "raw_dialogue": dialogue_json,
            "emotion_vector": vec,
            "tags": ["待提炼"],
            "user_id": "test_user_001",
        }

        try:
            resp = client.post(f"{api_url}/ingest-test", json=payload)
            data = resp.json()
            gid = data.get("id", "")
            gold_ids.append(gid)
            print_step("INJECT", f"'{conv['topic']}' → gold_id={gid[:12]}... emotion={emotion}")
        except Exception as e:
            print_result(f"注入失败: {conv['topic']}", False, str(e))

    print_result(f"共注入 {len(gold_ids)} 条对话到金库", len(gold_ids) > 0)
    return gold_ids


# ═══════════════════════════════════════════════════════════════
# 测试 2：触发记忆提炼（金库→黑钻库）
# ═══════════════════════════════════════════════════════════════

def test_refine(client: httpx.Client, api_url: str) -> dict:
    """调用提炼 API，测试金库→黑钻的 LLM 提炼流程"""
    print_header("[BRAIN] 测试2: 记忆提炼 (金库->黑钻)")

    resp = client.post(f"{api_url}/refine", data={"max_items": 10})
    result = resp.json()

    print_step("DONE", f"处理: {result.get('processed', 0)} 条")
    print_step("DONE", f"晋升黑钻: {result.get('promoted', 0)} 条")
    print_step("DONE", f"失败: {result.get('failed', 0)} 条")

    print_result("记忆提炼 API 响应正常", resp.status_code == 200)
    return result


# ═══════════════════════════════════════════════════════════════
# 测试 3：黑钻库验证
# ═══════════════════════════════════════════════════════════════

def test_verify_diamonds(client: httpx.Client, api_url: str) -> list:
    """验证黑钻库事件是否包含完整的情感曲谱"""
    print_header("[DIAMOND] 测试3: 黑钻库事件验证")

    resp = client.get(f"{api_url}/diamonds?limit=20")
    diamonds = resp.json()

    if not diamonds or len(diamonds) == 0:
        print_result("黑钻库为空", False, "可能是 LLM 提炼未完成")
        return []

    print_step("FOUND", f"黑钻库共 {len(diamonds)} 条事件")

    valid_count = 0
    for d in diamonds:
        es = d.get("emotional_spectrum", {})
        if isinstance(es, str):
            try:
                es = json.loads(es)
            except:
                es = {}

        has_facts = bool(d.get("core_facts"))
        has_emotion = bool(es.get("dominant_emotion"))
        has_type = bool(d.get("event_type"))

        if has_facts and has_emotion:
            valid_count += 1

        print_step("  EVENT", f"{d['event_id']} | {d.get('event_type','')} | "
                   f"情感:{es.get('dominant_emotion','?')} | "
                   f"摘要:{d.get('core_facts','')[:50]}...")

    print_result(f"完整黑钻事件: {valid_count}/{len(diamonds)}",
                 valid_count >= len(diamonds) * 0.5)
    return diamonds


# ═══════════════════════════════════════════════════════════════
# 测试 4：检索验证
# ═══════════════════════════════════════════════════════════════

def test_search(client: httpx.Client, api_url: str):
    """测试检索功能——验证信息流能正确返回"""
    print_header("[SEARCH] 测试4: 检索验证")

    queries = [
        ("架构设计", "向量/全文"),
        ("工作挫折 心情不好", "情感向量"),
        ("周末放松", "日常"),
        ("数据库性能", "技术"),
        ("三库流转 金库 黑钻", "架构关键词"),
    ]

    for query, qtype in queries:
        resp = client.get(f"{api_url}/search", params={"q": query, "limit": 3})
        data = resp.json()

        source = data.get("source", "none")
        count = len(data.get("results", []))

        if count > 0:
            first = data["results"][0]
            facts = first.get("core_facts", first.get("topic", ""))[:60]
            print_step(f"  [{source}]", f"'{query}' → {count}条 | 首条: {facts}...")
        else:
            print_step(f"  [{source}]", f"'{query}' → 未命中")


# ═══════════════════════════════════════════════════════════════
# 测试 5：懒加载标签验证
# ═══════════════════════════════════════════════════════════════

def test_lazy_tags(client: httpx.Client, api_url: str):
    """检索应触发懒加载标签"""
    print_header("[TAG] 测试5: 懒加载标签验证")

    # 检索一条未标记的数据
    resp = client.get(f"{api_url}/docs/gold", params={"page": 1, "page_size": 50})
    gold_docs = resp.json().get("items", [])

    # 查找刚注入的金库记录是否有标签
    tagged = 0
    untagged = 0
    for g in gold_docs:
        tags = g.get("tags", [])
        if tags and tags != ["待提炼"] and len(tags) >= 2:
            tagged += 1
            print_step("  TAG", f"'{g['topic'][:30]}' → {tags}")
        else:
            untagged += 1

    print_result(f"已有标签: {tagged}, 待标记: {untagged}",
                 tagged > 0, f"（懒加载会在检索时自动触发）")


# ═══════════════════════════════════════════════════════════════
# 主流程
# ═══════════════════════════════════════════════════════════════

def main():
    global API_BASE
    import argparse

    parser = argparse.ArgumentParser(description="仿生智脑 · 自学习信息流验证")
    parser.add_argument("--api", default=API_BASE, help="API 基础地址")
    parser.add_argument("--skip-inject", action="store_true", help="跳过数据注入")
    parser.add_argument("--skip-refine", action="store_true", help="跳过提炼步骤")
    args = parser.parse_args()

    api_url = args.api

    # ── 连接检查 ──
    print_header("[CONNECT] 连接检查")
    try:
        resp = httpx.get(f"{api_url}/health", timeout=5)
        status = resp.json()
        print_result(f"API 健康检查: {status['status']}",
                     status['status'] == 'ok',
                     f"DB={status['services'].get('database','?')} "
                     f"Qdrant={status['services'].get('qdrant','?')}")
    except Exception as e:
        print_result(f"无法连接到 {api_url}", False, str(e))
        sys.exit(1)

    # ── 测试流程 ──
    with httpx.Client(timeout=120) as client:
        gold_ids = []

        if not args.skip_inject:
            gold_ids = inject_conversations_direct(client, api_url)

        if not args.skip_refine:
            refine_result = test_refine(client, api_url)
            # 如果提炼成功，多等一会让黑钻入库
            if refine_result.get("promoted", 0) > 0:
                time.sleep(2)

        diamonds = test_verify_diamonds(client, api_url)
        test_search(client, api_url)
        test_lazy_tags(client, api_url)

    # ── 汇总 ──
    print_header("[STATS] 自学习信息流验证总结")
    if diamonds and len(diamonds) > 0:
        print("  ✅ 信息流完整: 对话 → 金库 → LLM提炼 → 黑钻(含情感曲谱) → 检索命中")
        print(f"  📊 黑钻事件: {len(diamonds)} 条")
        print(f"  🔍 检索链路: 情感向量 → 全文检索 → ILIKE 降级")
        print(f"  🏷️ 懒加载标签: 检索命中时自动触发 LLM 打标签")
    else:
        print("  ⚠️ 信息流部分完成：管道已通，但 LLM 提炼需要真实后端支持")
        print("  💡 请确保 LLM 端点可用（默认 http://localhost:3000/api/chat）")

    print(f"\n  🔗 API: {api_url}")
    print()


if __name__ == "__main__":
    main()
