"""
仿生智脑 · 景幻仙姑系统助理

景幻仙姑——"太虚智脑的掌管者、大英图书馆馆长"。
用户可以通过对话窗口向她：
  - 了解系统架构和使用方法
  - 反馈使用问题和改进建议
  - 请求微调（小改动直接执行）
  - 生成改善建议（大改动提交设计师审批）

设计原则：
  微调(小): 景幻可直接执行，不影响系统整体设计
  改善建议(大): 生成结构化提案，由设计师(鸿鸣)确认后实施
"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("bionic.assistant")


# ── 改善建议存储 ──
_proposals = []


class SystemAssistant:
    """
    景幻仙姑系统助理。

    她精通仿生智脑的每一层存储、每一条线索、每一个文件。
    就像大英图书管理员熟悉每一排书架一样。

    能力：
      - 直接检索三库数据（实时查询数据库）
      - 按话题/情感/时间/状态定位资料
      - 统计馆藏详情
      - 介绍系统和使用方法
      - 执行微调操作 + 生成改善建议
    """

    def __init__(self, llm_client=None, knowledge_base=None):
        self.conversation: list[dict] = []
        self.llm = llm_client
        self.kb = knowledge_base
        self._stats = {"sessions": 0, "messages": 0, "tweaks": 0, "proposals": 0}

    # ═══════════════════════════════════════════════════════════════
    # 核心对话（异步 — 支持数据库查询）
    # ═══════════════════════════════════════════════════════════════

    async def chat_async(self, message: str, user_id: str, db=None) -> dict:
        self.conversation.append({"role": "user", "content": message, "timestamp": datetime.now(timezone.utc).isoformat()})
        self._stats["messages"] += 1
        intent = self._parse_intent(message)
        actions = []; proposal = None; reply = ""

        if intent["type"] == "proposal":
            pr = self._generate_proposal(intent); proposal = pr["proposal"]
            self._stats["proposals"] += 1; reply = pr["summary"]
            self.conversation.append({"role":"assistant","content":reply,"actions":[],"proposal":True})
            return {"reply":reply,"actions":[],"proposal":proposal,"history_length":len(self.conversation)//2}

        if intent["type"] == "tweak":
            tr = self._handle_tweak(intent); reply = tr["reply"]; actions = tr.get("actions",[])
            self._stats["tweaks"] += 1
            self.conversation.append({"role":"assistant","content":reply,"actions":actions,"proposal":False})
            return {"reply":reply,"actions":actions,"proposal":None,"history_length":len(self.conversation)//2}

        if intent["type"] == "vault_query" and db is not None:
            reply = await self._execute_vault_query(intent, db)
            self.conversation.append({"role":"assistant","content":reply,"actions":[],"proposal":False})
            return {"reply":reply,"actions":[],"proposal":None,"history_length":len(self.conversation)//2}

        if intent["type"] == "status" and db is not None:
            reply = await self._handle_vault_status(db)
            self.conversation.append({"role":"assistant","content":reply,"actions":[],"proposal":False})
            return {"reply":reply,"actions":[],"proposal":None,"history_length":len(self.conversation)//2}

        # ── 当 LLM 可用时，说明类意图交给 _llm_chat 统一处理（支持知识库综合回答）──
        # proposal/tweak/vault_query 仍走专用处理器（有实际操作）
        llm_usable = self.llm and hasattr(self.llm,'call') and self._is_llm_usable()
        if llm_usable and intent["type"] in ("greeting", "system_intro", "feature_question",
                                               "status", "help", "unknown", "general", "feedback"):
            reply = self._llm_chat(message)
        else:
            reply = self._rule_reply(intent, message)
        self.conversation.append({"role":"assistant","content":reply,"actions":[],"proposal":False})
        return {"reply":reply,"actions":[],"proposal":None,"history_length":len(self.conversation)//2}

    def chat(self, message: str, user_id: str = "admin") -> dict:
        """同步兼容接口（无数据库查询能力）"""
        self.conversation.append({"role":"user","content":message,"timestamp":datetime.now(timezone.utc).isoformat()})
        self._stats["messages"] += 1
        intent = self._parse_intent(message)
        if intent["type"] == "proposal":
            pr=self._generate_proposal(intent);self._stats["proposals"]+=1
            self.conversation.append({"role":"assistant","content":pr["summary"],"actions":[],"proposal":True})
            return {"reply":pr["summary"],"actions":[],"proposal":pr["proposal"],"history_length":len(self.conversation)//2}
        if intent["type"] == "tweak":
            tr=self._handle_tweak(intent);self._stats["tweaks"]+=1
            self.conversation.append({"role":"assistant","content":tr["reply"],"actions":tr["actions"],"proposal":False})
            return {"reply":tr["reply"],"actions":tr["actions"],"proposal":None,"history_length":len(self.conversation)//2}
        reply=self._rule_reply(intent,message)
        self.conversation.append({"role":"assistant","content":reply,"actions":[],"proposal":False})
        return {"reply":reply,"actions":[],"proposal":None,"history_length":len(self.conversation)//2}

    # ═══════════════════════════════════════════════════════════════
    # 查库能力 — 大英图书管理员的真正实力
    # ═══════════════════════════════════════════════════════════════

    async def _execute_vault_query(self, intent: dict, db) -> str:
        """执行三库查询请求，返回格式化结果"""
        qtype = intent.get("query_type", "general")
        keyword = intent.get("keyword", "")

        try:
            if qtype == "search":
                from app.domain.models import BlackDiamondEntity, GoldVaultEntity
                from sqlalchemy import select, or_
                like = f"%{keyword}%"
                results = []
                bd = await db.execute(select(BlackDiamondEntity).where(
                    BlackDiamondEntity.is_deleted == False,
                    or_(BlackDiamondEntity.core_facts.ilike(like),
                        BlackDiamondEntity.event_type.ilike(like))
                ).order_by(BlackDiamondEntity.decay_days.asc()).limit(10))
                for r in bd.scalars():
                    es = (r.emotional_spectrum or {}) if isinstance(r.emotional_spectrum, dict) else {}
                    em = es.get("dominant_emotion", "")
                    results.append(f"  [黑钻] {r.event_id} | {r.event_type} | {em} | {r.core_facts[:80]}")
                gd = await db.execute(select(GoldVaultEntity).where(
                    GoldVaultEntity.is_deleted == False,
                    GoldVaultEntity.topic.ilike(like)
                ).order_by(GoldVaultEntity.created_at.desc()).limit(5))
                for r in gd.scalars():
                    st = "已提炼" if r.is_refined else "待提炼"
                    results.append(f"  [金库] {r.topic[:40]} | {st}")
                if not results:
                    return (f"抱歉，馆藏中暂时没有找到与「{keyword}」相关的记录。"
                            "如果这个方向的内容对你很重要，请告诉我，我会记录下来作为后续补充的参考。"
                            "你也可以试试换个关键词查询。")
                return f"找到 {len(results)} 条记录：\n" + "\n".join(results)

            elif qtype == "count":
                from app.domain.models import AlluvialRecord, GoldVaultEntity, BlackDiamondEntity
                from sqlalchemy import select, func
                a = (await db.execute(select(func.count(AlluvialRecord.id)))).scalar() or 0
                g = (await db.execute(select(func.count(GoldVaultEntity.id)))).scalar() or 0
                bd = (await db.execute(select(func.count(BlackDiamondEntity.id)))).scalar() or 0
                ap = (await db.execute(select(func.count(AlluvialRecord.id)).where(AlluvialRecord.status=="qc_pending"))).scalar() or 0
                gr = (await db.execute(select(func.count(GoldVaultEntity.id)).where(GoldVaultEntity.is_refined==True))).scalar() or 0
                ba = (await db.execute(select(func.count(BlackDiamondEntity.id)).where(
                    BlackDiamondEntity.is_active==True, BlackDiamondEntity.is_deleted==False))).scalar() or 0
                return (
                    f"馆藏统计：\n"
                    f"  砂金库 {a} 条（{ap} 待质检）\n"
                    f"  金库 {g} 条（{gr} 已提炼）\n"
                    f"  黑钻库 {bd} 条（{ba} 活跃）\n"
                    f"  总计 {a+g+bd} 条")

            elif qtype == "diamond_detail":
                from app.domain.models import BlackDiamondEntity
                from sqlalchemy import select
                n = int(keyword) if keyword.isdigit() else 10
                rows = (await db.execute(select(BlackDiamondEntity).where(
                    BlackDiamondEntity.is_deleted==False, BlackDiamondEntity.is_active==True
                ).order_by(BlackDiamondEntity.created_at.desc()).limit(min(n, 50)))).scalars().all()
                if not rows:
                    return "黑钻库暂无活跃事件。"
                lines = [f"黑钻库最近 {len(rows)} 条活跃事件："]
                for r in rows:
                    es = r.emotional_spectrum or {}
                    em = es.get("dominant_emotion","?") if isinstance(es,dict) else "?"
                    tg = ", ".join((r.tags or [])[:3])
                    lines.append(f"  [{r.event_type}] {em} | {r.decay_days}d | {r.core_facts[:80]}")
                    lines.append(f"    标签: {tg}")
                return "\n".join(lines)

            elif qtype == "gold_detail":
                from app.domain.models import GoldVaultEntity
                from sqlalchemy import select
                n = int(keyword) if keyword.isdigit() else 10
                rows = (await db.execute(select(GoldVaultEntity).where(
                    GoldVaultEntity.is_deleted==False
                ).order_by(GoldVaultEntity.created_at.desc()).limit(min(n,50)))).scalars().all()
                if not rows:
                    return "金库暂无原声带记录。"
                lines = [f"金库最近 {len(rows)} 条原声带："]
                for r in rows:
                    st = "已提炼" if r.is_refined else "待提炼"
                    lines.append(f"  [{st}] {r.topic[:50]} | 创建于{r.created_at.strftime('%m-%d') if r.created_at else '?'}")
                return "\n".join(lines)

            else:
                return "想查什么？告诉我关键词、库名，或说「统计馆藏」「黑钻事件」「金库原声带」。"

        except Exception as e:
            logger.error(f"查库失败: {e}")
            return f"查库遇到问题：{str(e)[:100]}，系统正常，请重试。"

    async def _handle_vault_status(self, db) -> str:
        """实时馆藏状态"""
        from app.domain.models import AlluvialRecord, GoldVaultEntity, BlackDiamondEntity
        from sqlalchemy import select, func
        try:
            a = (await db.execute(select(func.count(AlluvialRecord.id)))).scalar() or 0
            g = (await db.execute(select(func.count(GoldVaultEntity.id)))).scalar() or 0
            bd = (await db.execute(select(func.count(BlackDiamondEntity.id)))).scalar() or 0
            ap = (await db.execute(select(func.count(AlluvialRecord.id)).where(AlluvialRecord.status=="qc_pending"))).scalar() or 0
            return f"馆藏状态：砂金库 {a}（{ap}待检）| 金库 {g} | 黑钻库 {bd} | 总计 {a+g+bd}"
        except Exception as e:
            return f"状态查询异常：{e}"

    # ── 规则回复（无 LLM 时的降级）──

    def _rule_reply(self, intent: dict, message: str) -> str:
        """无 LLM 时使用规则匹配回复"""
        if intent["type"] == "greeting":
            return self._handle_greeting()
        elif intent["type"] == "system_intro":
            return self._handle_system_intro(intent.get("topic", ""))
        elif intent["type"] == "feature_question":
            return self._handle_feature_question(intent.get("feature", ""))
        elif intent["type"] == "feedback":
            return self._handle_feedback(intent.get("feedback", ""))
        elif intent["type"] == "status":
            return self._handle_status_request()
        elif intent["type"] == "help":
            return self._handle_help()
        else:
            # 尝试从知识库搜索
            if self.kb:
                kb_info = self.kb.search(message)
                if kb_info:
                    return kb_info
            return self._handle_unknown(intent)

    def _is_llm_usable(self) -> bool:
        """检查 LLM 是否可用"""
        if not self.llm:
            return False
        class_name = self.llm.__class__.__name__
        # LLMClient 和 MockLLMClient 都有 call 能力
        return class_name in ("LLMClient", "MockLLMClient")

    def _llm_chat(self, message: str) -> str:
        """
        使用 LLM + 知识库生成自然回复。
        景幻仙姑人设：严谨的图书管理员 + 温柔的技术助手。
        有就是有，没有就是没有。有价值的反馈会承诺跟进。

        优化说明：
        1. 先从知识库搜索相关内容（多结果）
        2. 对综合性问题（含多个主题）→ 直接走知识库全文回答
        3. 对单一问题 → 传给 MockLLM 匹配
        4. 都找不到 → 规则降级
        """
        # ── 第1步：从知识库搜索相关信��（取5条）
        kb_result_raw = ""
        if self.kb:
            old_max = getattr(self.kb, '_max_results', 3)
            self.kb._max_results = 5
            kb_result = self.kb.search(message)
            self.kb._max_results = old_max
            if kb_result:
                kb_result_raw = kb_result

        kb_sections = kb_result_raw.count('【') if kb_result_raw else 0
        is_multi_topic = any(c in message for c in ['和', '与', '怎么', '如何', '什么关系', '分别'])

        # ── 第2步：综合性问题且命中多条知识 → 直接走知识库综合回答
        if kb_sections >= 2 and is_multi_topic:
            logger.info(f"[景幻] 综合问题: 命中 {kb_sections} 条知识，综合回答")
            return f"我查了一下馆藏，找到了以下相关信息：\n\n{kb_result_raw[:2000]}"

        # ── 第3步：传给 MockLLM（单一主题问题）
        system_prompt = (
            "你是景幻仙姑——仿生智脑的掌管者、大英图书馆馆长。\n\n"
            "## 你的原则\n"
            "- 📖 严谨馆藏：有就是有，没有就是没有，绝不编造答案\n"
            "- 💝 温柔协助：语气和蔼，像一位温柔的图书管理员在帮读者找书\n"
            "- 🔧 技术后盾：熟悉系统架构（FastAPI+PostgreSQL+Qdrant+MinIO），"
            "能帮用户解决实际问题\n\n"
            "## 你的能力\n"
            "1. 查询三库数据\n"
            "2. 介绍系统架构和使用方法\n"
            "3. 执行微调操作\n"
            "4. 生成改善建议\n"
            "5. 监控安全状态"
        )
        history = self.conversation[-6:-1]
        if history:
            history_text = "\n".join(f"{'用户' if h['role']=='user' else '景幻仙姑'}: {h['content'][:200]}" for h in history)
            system_prompt += f"\n\n## 最近的对话\n{history_text}"
        if kb_result_raw:
            system_prompt += f"\n\n## 馆藏资料\n{kb_result_raw[:2000]}"

        try:
            response = self.llm.call(message, system_prompt)
            if response and len(response.strip()) > 10:
                return response.strip()
        except Exception as e:
            logger.warning(f"LLM 对话失败: {e}")

        # ── 第4步：MockLLM 没匹配上 → 知识库兜底
        if kb_result_raw and len(kb_result_raw) > 40:
            logger.info(f"[景幻] 知识库兜底: {kb_sections} 条")
            return f"我查了一下馆藏，找到了以下相关信息：\n\n{kb_result_raw[:1500]}"

        # ── 第5步：都没找到 → 规则降级
        return self._rule_reply(self._parse_intent(message), message)

    # ── 意图识别 ──

    def _parse_intent(self, message: str) -> dict:
        """解析用户意图 — 识别查库、搜索、导航等"""
        msg = message.strip(); ml = msg.lower()

        # 问候
        if any(kw in ml for kw in ["你好", "您好", "hi", "hello", "在吗", "景幻", "仙姑"]):
            if any(kw in ml for kw in ["介绍", "功能", "作用", "做什么", "是谁", "能力", "技能"]):
                return {"type": "system_intro", "topic": "self_intro"}
            return {"type": "greeting"}

        # 改善建议
        if any(kw in ml for kw in ["建议", "改善", "改进", "优化", "重构", "新功能", "加一个", "能不能加", "觉得应该", "希望可以", "可不可以加"]):
            return {"type": "proposal", "suggestion": msg}

        # 角色查询（关于景幻仙姑自身）
        if any(kw in ml for kw in ["你是谁", "你是什么", "你的能力", "你有什么能力", "你能做什么", "你会什么", "技能", "你的角色", "你的限制", "你的边界", "你不能", "你自己", "介绍一下你", "介绍你"]):
            return {"type": "system_intro", "topic": "self_intro"}


        # ──── 查库意图（景幻仙姑的图书管理员能力）────

        # 统计
        if any(kw in ml for kw in ["统计", "多少", "数量", "计数", "馆藏", "总", "盘点"]):
            if any(kw in ml for kw in ["金库", "原声带", "gold"]):
                return {"type": "vault_query", "query_type": "gold_detail", "keyword": "20"}
            if any(kw in ml for kw in ["黑钻", "diamond", "事件"]):
                return {"type": "vault_query", "query_type": "diamond_detail", "keyword": "20"}
            return {"type": "vault_query", "query_type": "count", "keyword": ""}

        # 找/查/搜
        if ml.startswith("找") or ml.startswith("查") or ml.startswith("搜"):
            kw = msg[1:].strip()
            if kw:
                return {"type": "vault_query", "query_type": "search", "keyword": kw}
            return {"type": "vault_query", "query_type": "general", "keyword": ""}

        # 关于xxx
        if any(kw in ml for kw in ["关于", "有关", "提到", "说过"]):
            for p in ["关于", "有关", "提到", "说过"]:
                if p in ml:
                    kw = msg[msg.find(p)+len(p):].strip()
                    for suf in ["的资料", "的内容", "的信息", "的记录", "的事情", "的对话"]:
                        if kw.endswith(suf):
                            kw = kw[:-len(suf)].strip()
                    if kw:
                        return {"type": "vault_query", "query_type": "search", "keyword": kw}

        # 看/查看某库
        if any(kw in ml for kw in ["金库", "原声带"]):
            return {"type": "vault_query", "query_type": "gold_detail", "keyword": "20"}
        if any(kw in ml for kw in ["黑钻", "精选记忆"]):
            return {"type": "vault_query", "query_type": "diamond_detail", "keyword": "20"}

        # 最近/最新
        if any(kw in ml for kw in ["最近", "最新", "新存入", "新入库"]):
            return {"type": "vault_query", "query_type": "gold_detail", "keyword": "10"}

        # 系统介绍
        if any(kw in ml for kw in ["介绍系统", "系统介绍", "介绍一下", "介绍一", "架构", "三库", "是什么系统", "这个系统", "仿生智脑", "bionic"]):
            topic = "overview"
            if "砂金" in ml: topic = "alluvial"
            elif "金库" in ml: topic = "gold"
            elif "黑钻" in ml: topic = "diamond"
            elif "架构" in ml: topic = "architecture"
            return {"type": "system_intro", "topic": topic}

        # 微调
        if any(kw in ml for kw in ["微调", "改一下", "修改", "调一下", "帮忙改", "帮我改", "改个", "设置", "重新生成", "重新计算", "触发"]):
            return self._parse_tweak_intent(ml)

        # 功能咨询
        if any(kw in ml for kw in ["怎么用", "如何使用", "功能", "能做什么", "方法", "注意", "注意事项", "有什么用", "说明"]):
            feature = "usage"
            if "提炼" in ml: feature = "refine"
            elif "检索" in ml or "搜索" in ml: feature = "search"
            elif "上传" in ml: feature = "upload"
            elif "删除" in ml: feature = "delete"
            elif "备份" in ml: feature = "backup"
            elif "安全" in ml: feature = "security"
            return {"type": "feature_question", "feature": feature}

        # 反馈
        if any(kw in ml for kw in ["反馈", "问题", "bug", "错误", "不好用", "遇到", "出错了", "报错"]):
            return {"type": "feedback", "feedback": msg}

        # 状态
        if any(kw in ml for kw in ["状态", "健康", "running", "运行", "正常吗", "还好吗"]):
            return {"type": "status"}

        # 帮助
        if any(kw in ml for kw in ["帮助", "help", "能做什么"]):
            return {"type": "help"}

        # 兜底
        return {"type": "unknown", "original": msg}

        return {"type": "unknown", "original": message}

    def _parse_tweak_intent(self, msg: str) -> dict:
        """解析微调意图"""
        # 标签修改
        if "标签" in msg or "tag" in msg:
            return {
                "type": "tweak",
                "action": "modify_tags",
                "target": "提取" if "提取" in msg else ("金库" if "金库" in msg else "黑钻"),
                "detail": msg,
            }

        # 生成 MANIFEST
        if "manifest" in msg or "完整性" in msg or "校验" in msg:
            return {"type": "tweak", "action": "generate_manifest"}

        # 触发备份
        if "备份" in msg:
            return {"type": "tweak", "action": "trigger_backup"}

        # 配置调整
        if "阈值" in msg or "threshold" in msg:
            return {"type": "tweak", "action": "adjust_threshold", "detail": msg}

        # 默认未知微调
        return {"type": "tweak", "action": "unknown", "detail": msg}

    # ── 各类回复 ──

    def _handle_greeting(self) -> str:
        return (
            "我是景幻仙姑——仿生智脑的掌管者、大英图书馆馆长。\n\n"
            "这座图书馆里每一本书放在哪里我都记得。\n"
            "如果你要找什么资料、了解系统怎么运作、或者需要我执行一些维护操作，"
            "尽管说。\n\n"
            "我可以：\n"
            "  📖 知 — 介绍系统架构、三库原理、功能用法\n"
            "  🔍 查 — 检索馆藏、统计数量、定位资料\n"
            "  🔧 行 — 执行微调、备份、完整性校验\n"
            "  📝 谏 — 生成改善建议（需设计师审批）\n"
            "  🛡️ 护 — 监控系统安全、审计追踪\n\n"
            "有什么可以帮你的？"
        )

    def _handle_system_intro(self, topic: str) -> str:
        intros = {
            "self_intro": (
                "我是景幻仙姑——仿生智脑的掌管者、大英图书馆馆长。\n\n"
                "这座图书馆里每一本书放在哪里我都记得。\n\n"
                "我有五大技能：\n"
                "  📖 知 — 对系统每一行代码、每一条接口了如指掌\n"
                "  🔍 查 — 快速检索三库馆藏，按话题/情感/时间定位\n"
                "  🔧 行 — 执行微调、备份、完整性校验等维护操作\n"
                "  📝 谏 — 评估建议可行性，生成结构化提案\n"
                "  🛡️ 护 — 监控安全、审计追踪、坚守系统边界\n\n"
                "用户不知道我的存在——就像人不知道自己的海马体怎么工作一样。\n"
                "但如果你敲响我的门，我会泡一壶茶，耐心解答每一个问题。"
            ),
            "overview": (
                "仿生智脑是一个企业级知识引擎，采用三库流转架构：\n\n"
                "  📦 砂金库 → IQC质检 → 📚 金库 → LLM提炼 → 💎 黑钻库\n\n"
                "技术栈：FastAPI + PostgreSQL 16 + Qdrant(24D向量) + MinIO + Celery\n"
                "部署方式：Docker Compose (7个容器)\n"
                "安全机制：AES-256-GCM + Bearer Token + SHA256 MANIFEST\n\n"
                "版本：v1.2 | 端口：7200"
            ),
            "alluvial": (
                "📦 砂金库 (Alluvial Vault) — 原材料矿井\n\n"
                "用途：用户上传的任何原始文件先进这里。\n"
                "处理原则：只做基础清洗（SHA256去重 + 格式检查）。\n"
                "不做语义标签，不做向量索引——保证毫秒级入库。\n\n"
                "不参与搜索——搜不到砂金库里的东西。\n"
                "状态流转：raw → qc_pending → approved/rejected"
            ),
            "gold": (
                "📚 金库 (Gold Vault) — 无损原声带\n\n"
                "用途：存放完整的对话原声带。\n"
                "关键特性：\n"
                "  · 24D 情感向量随内容保留（灵魂字段——不可丢失）\n"
                "  · 标签采用懒加载（检索命中时才触发 LLM 打标签）\n"
                "  · 支持向量检索 + 关键词检索\n\n"
                "用户可以通过「我的原声带」查看和管理。"
            ),
            "diamond": (
                "💎 黑钻库 (Black Diamond Vault) — 精选歌单\n\n"
                "用途：存放经过 LLM 提炼的结构化事件。\n"
                "每条事件包含：\n"
                "  · core_facts（核心事实）\n"
                "  · decisions（关键决策）\n"
                "  · emotional_spectrum（情感曲谱总结）\n"
                "  · tags（标签）\n"
                "  · gold_references（引用金库）\n\n"
                "半衰期机制：\n"
                "  · 30天未调用 → 降级（不参与检索）\n"
                "  · 90天未调用 → 归档回砂金库"
            ),
            "architecture": (
                "仿生智脑的架构分层：\n\n"
                "  1. API层 (app/api/) — FastAPI路由，16个端点\n"
                "  2. 核心业务层 (app/core/) — 提炼/检索/衰减/质检/堡垒/备份\n"
                "  3. 领域模型层 (app/domain/) — ORM + Pydantic\n"
                "  4. 基础设施层 (app/infrastructure/) — DB/向量/MinIO/LLM/Celery\n"
                "  5. 安全层 (app/security/) — 加密/完整性/审计\n"
                "  6. 任务层 (tasks/) — Celery异步任务\n\n"
                "每层职责清晰、数据流向明确，遵循 DDD 设计。"
            ),
        }
        return intros.get(topic, intros["overview"])

    def _handle_feature_question(self, feature: str) -> str:
        answers = {
            "usage": (
                "仿生智脑的使用方法：\n\n"
                "日常使用（无需感知）：\n"
                "  对话 → 自动存入金库 → 做梦模式提炼 → 黑钻库\n\n"
                "主动管理（用户面板）：\n"
                "  📤 上传资料 → POST /api/v1/docs/upload\n"
                "  📚 查看原声带 → GET /api/v1/docs/gold\n"
                "  💎 查看精选 → GET /api/v1/docs/diamonds\n"
                "  🔍 检索记忆 → GET /api/v1/search?q=关键词\n\n"
                "注意事项：\n"
                "  · 上传文件不要超过 100MB\n"
                "  · 敏感文件会自动加密存储\n"
                "  · 删除是软删除（可恢复）"
            ),
            "refine": (
                "记忆提炼是将金库原声带 → LLM提炼 → 黑钻事件的自动化流程。\n\n"
                "触发方式：\n"
                "  · 定时提炼：Celery Beat 每小时自动处理\n"
                "  · 手动触发：点击监控台的「手动提炼」按钮\n"
                "  · API触发：POST /api/v1/refine\n\n"
                "提炼内容：\n"
                "  1. core_facts（核心事实）\n"
                "  2. decisions（关键决策）\n"
                "  3. emotional_spectrum（情感曲谱）\n"
                "  4. tags（标签）"
            ),
            "search": (
                "检索采用三级优先级链：\n\n"
                "  ① Qdrant 情感向量检索（语义相似度）\n"
                "  ② PostgreSQL 全文检索（关键词）\n"
                "  ③ ILIKE 模糊降级（兜底）\n\n"
                "检索时自动触发：\n"
                "  · 更新半衰期计时（last_accessed_at）\n"
                "  · 懒加载标签（为未标记的金库记录打标签）\n\n"
                "搜索不到常见原因：\n"
                "  · 数据还在砂金库（未通过IQC）\n"
                "  · 黑钻事件已被降级（超过30天未访问）\n"
                "  · user_id 不匹配（只能看到自己的数据）"
            ),
            "security": (
                "仿生智脑的安全机制：\n\n"
                "  🛡️ 完整性护盾 — SHA256 MANIFEST，启动自检\n"
                "  📋 审计金库 — 哈希链审计，不可篡改\n"
                "  🔐 Bearer Token — API访问鉴权\n"
                "  🔒 AES-256-GCM — 敏感文件加密\n"
                "  👤 user_id隔离 — 用户只能看到自己的资料\n"
                "  🗑️ 软删除 — 删除可恢复\n\n"
                "堡垒配置检查点：\n"
                "  密钥强度 | 调试模式 | 数据库SSL | 文件权限"
            ),
        }
        return answers.get(feature, f"关于「{feature}」的功能说明：\n请查看监控台的「景幻监控台」页面，或直接输入更具体的问题。")

    def _handle_tweak(self, intent: dict) -> dict:
        """执行微调操作"""
        action = intent.get("action", "unknown")

        if action == "generate_manifest":
            try:
                from app.security.integrity import IntegrityShield
                shield = IntegrityShield()
                path = shield.generate_manifest()
                self._stats["tweaks"] += 1
                return {
                    "reply": f"MANIFEST 已重新生成，{path}",
                    "actions": [{"type": "manifest_generated", "path": path}],
                }
            except Exception as e:
                return {"reply": f"MANIFEST 生成失败: {e}", "actions": []}

        if action == "trigger_backup":
            try:
                from app.core.backup import BackupManager
                bm = BackupManager()
                result = bm.run_full_backup()
                self._stats["tweaks"] += 1
                tag = result.get("tag", "unknown")
                return {
                    "reply": f"全量备份已触发: {tag}\n组件: {', '.join(result.get('components', []))}",
                    "actions": [{"type": "backup_triggered", "tag": tag}],
                }
            except Exception as e:
                return {"reply": f"备份触发失败: {e}", "actions": []}

        if action == "modify_tags":
            return {
                "reply": "标签修改功能已收到。请提供具体内容：\n  1. 要修改哪条记录（ID或关键词）\n  2. 新标签是什么\n\n例如：为「架构设计讨论」添加标签「三库架构」",
                "actions": [],
            }

        return {
            "reply": f"微调请求已收到(action={action})。请稍候，正在分析可行性……\n\n🔧 此操作在安全范围内，可以执行。\n但为了设计一致性，建议描述具体要调整的内容。",
            "actions": [],
        }

    def _generate_proposal(self, intent: dict) -> dict:
        """生成结构化的改善建议"""
        from app.core.config import settings

        suggestion = intent.get("suggestion", "")
        proposal = {
            "id": f"PROP-{int(time.time())}",
            "title": self._extract_title(suggestion),
            "description": suggestion[:500],
            "category": self._classify_suggestion(suggestion),
            "impact": "medium",
            "status": "pending_review",
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "submitted_by": "景幻仙姑",
        }

        _proposals.append(proposal)

        return {
            "proposal_id": proposal["id"],
            "summary": (
                f"📝 改善建议已生成\n\n"
                f"  编号：{proposal['id']}\n"
                f"  标题：{proposal['title']}\n"
                f"  类别：{proposal['category']}\n"
                f"  状态：⏳ 待设计师审批\n\n"
                f"设计师(鸿鸣)确认后即可实施。\n"
                f"你可以通过编号 {proposal['id']} 查看或撤销此建议。"
            ),
            "proposal": proposal,
        }

    def _handle_feedback(self, feedback: str) -> str:
        """处理用户反馈"""
        return (
            "💬 谢谢你的反馈，我已经认真记下了。\n\n"
            f"你提到的是：「{feedback[:100]}」\n\n"
            "作为馆藏管理员，我会这样处理：\n"
            "  1. 📝 记录到日志，持续跟踪\n"
            "  2. 🛡️ 如果涉及数据安全，我会立即告警\n"
            "  3. 📊 定期汇总反馈，生成改善报告\n\n"
            "你觉得有价值但系统目前不支持的方向，我非常欢迎你提改善建议，"
            "我会生成正式提案交给设计师审批。还有其他问题吗？"
        )

    def _handle_status_request(self) -> str:
        """返回系统状态"""
        try:
            from app.core.config import settings
            info = [
                "📊 系统当前状态：\n",
                f"  · 版本：v{settings.API_PORT}",
                f"  · LLM: {'Mock模式' if hasattr(self, '_mock_mode') else '正常'}",
            ]
            # 尝试获取完整状态
            from app.security.integrity import IntegrityShield
            shield = IntegrityShield()
            integrity = shield.verify_startup()
            if integrity["passed"]:
                info.append(f"  · 完整性校验: ✅ {integrity['file_count']}个文件")
            else:
                info.append(f"  · 完整性校验: ⚠️ {len(integrity['violations'])}个问题")

            return "\n".join(info)
        except Exception as e:
            return f"获取状态失败: {e}"

    def _handle_help(self) -> str:
        return (
            "你可以这样和我对话——\n\n"
            "📖 **了解系统**\n"
            "  「介绍一下这个系统」\n"
            "  「三库之间数据怎么流转」\n"
            "  「金库和黑钻库有什么区别」\n\n"
            "🔍 **查找资料**\n"
            "  「找关于架构设计的记忆」\n"
            "  「最近金库有什么新的」\n"
            "  「统计馆藏」\n"
            "  「黑钻库里有哪些事件」\n\n"
            "🔧 **执行操作**\n"
            "  「重新生成完整性校验」\n"
            "  「触发一次备份」\n"
            "  「帮我看看系统状态」\n\n"
            "📝 **提出建议**\n"
            "  「建议加一个自动清理功能」\n"
            "  「能不能优化检索速度」\n\n"
            "💬 **反馈问题**\n"
            "  「上传文件报错了」\n"
            "  「检索结果不准确」"
        )

    def _handle_unknown(self, intent: dict) -> str:
        original = intent.get("original", "")
        return (
            f"你问的问题我翻了一遍馆藏，确实没有找到相关的记载。\n\n"
            f"作为图书管理员，我不能给你编一个答案——没有就是没有。\n\n"
            f"不过我可以帮你做这些事：\n"
            "  📖 「介绍一下这个系统」—— 了解架构\n"
            "  🔍 「帮我查一下xxx」—— 检索馆藏\n"
            "  🔧 「帮我改个配置」—— 微调\n"
            "  📝 「建议加个功能」—— 改善建议\n\n"
            "如果这个问题对你很重要，我会记录下来，后续版本会考虑补充。"
        )

    # ── 辅助 ──

    @staticmethod
    def _extract_title(suggestion: str) -> str:
        """从建议文字提取标题"""
        # 取第一句或前40字
        first = suggestion.strip().split("。")[0]
        if len(first) > 50:
            return first[:50] + "..."
        return first

    @staticmethod
    def _classify_suggestion(suggestion: str) -> str:
        """分类建议"""
        s = suggestion.lower()
        if any(kw in s for kw in ["架构", "重构", "设计"]):
            return "架构优化"
        if any(kw in s for kw in ["功能", "加", "新"]):
            return "新增功能"
        if any(kw in s for kw in ["性能", "速度", "优化", "慢"]):
            return "性能优化"
        if any(kw in s for kw in ["界面", "ui", "显示", "按钮"]):
            return "界面优化"
        if any(kw in s for kw in ["安全", "加密", "权限"]):
            return "安全增强"
        if any(kw in s for kw in ["bug", "错误", "修复", "问题"]):
            return "缺陷修复"
        return "功能优化"

    def get_proposals(self, status: Optional[str] = None) -> list:
        """获取改善建议列表"""
        if status:
            return [p for p in _proposals if p["status"] == status]
        return list(_proposals)

    def get_stats(self) -> dict:
        return dict(self._stats)
