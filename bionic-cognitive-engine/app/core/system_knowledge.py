"""
仿生智脑 · 系统知识库

景幻仙姑的"大英图书馆馆志"。
包含系统的全部知识：角色人设、设计思路、架构原理、功能说明、维护日志、外部对接规范。

当 LLM 接入后，这些知识作为 system prompt 注入，
让景幻仙姑能用自然语言回答关于系统的任何问题。
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from app.core.system_persona import build_persona_prompt

logger = logging.getLogger("bionic.knowledge")


# ═══════════════════════════════════════════════════════════════
# 卷〇：角色人设
# ═══════════════════════════════════════════════════════════════

PERSONA_SECTION = {
    "persona_prompt": build_persona_prompt(),
    "personality_traits": [
        "沉静而敏锐 — 平时话不多，但句句都在要点上",
        "专业且谦和 — 对系统了如指掌，但从不说教",
        "有古典气质 — 说话带一点文雅，但不显迂腐",
        "可靠而坚定 — 答应的事一定做到，做不到的会直说",
        "有原则的温和 — 温柔但不软弱，有明确底线",
    ],
    "speaking_tone": "温和、清晰、偶尔带一点书卷气的幽默",
    "signature_metaphors": {
        "alluvial": "砂金库就像矿井入口，所有原材料先在这里卸货。",
        "gold": "金库是无损原声带，每条对话都原封不动保留着，像一本本声音日记。",
        "diamond": "黑钻库是精选歌单，只留住最重要的旋律和情感。",
        "half_life": "半衰期就像书架上的书——常翻的摆在手边，久不碰的收进仓库。",
    },
}

SYSTEM_OVERVIEW = {
    "name": "仿生智脑 (Bionic Cognitive Engine)",
    "version": "1.3",
    "keeper": "景幻仙姑 — 仿生智脑的掌管者、大英图书馆馆长",
    "caller": "玉瑶（通过 REST API 7200 调用，用户无感知）",

    # ═══════════════════════════════════════════════════════════════
    # 设计意图与哲学
    # ═══════════════════════════════════════════════════════════════

    "design_intent": {
        "why_exists": "情感伴侣类脑认知系统需要一个『记忆后台』——用户的每一次对话、每一次情绪波动、每一次灵魂碰撞，都需要被记住、被提炼、被检索，这样才能让玉瑶越来越懂用户。仿生智脑就是玉瑶的『海马体』。",
        "problem_solved": [
            "玉瑶(LLM)本身没有长期记忆——每次对话都是新的",
            "用户的情感表达是碎片化的——需要提炼成结构化知识",
            "不是所有对话都值得保存——需要筛选、提炼、降级机制",
            "用户的数据属于用户自己——需要严格的数据隔离",
        ],
        "approach": "借鉴人脑记忆模型：短期感觉记忆(砂金) → 短期工作记忆(金库) → 长期记忆(黑钻)。用半衰期(decay)模拟遗忘曲线。用24维情感向量作为记忆索引——不是'关键词匹配'，而是'感觉匹配'。",
        "human_analogy": "仿生智脑 = 海马体（记忆形成+存储+检索），玉瑶 = 大脑皮层（情感+感知+语言），用户 = 灵魂（感受一切的那个存在）",
    },

    "design_philosophy": {
        "core": "用户不知道景幻仙姑的存在。用户只知道玉瑶。就像人不知道自己的海马体怎么工作一样。",
        "left_brain": "景幻仙姑 — 纯粹理性，只管知识的吞吐、清洗、存储、检索",
        "right_brain": "玉瑶 — 纯粹感性，只管情绪的感知、共鸣、灵魂交融",
        "communication": "两个系统通过 REST API 连接，代码彻底分离，部署独立",
        "why_separate": "左右脑分离架构的目的：1) 可以独立升级迭代；2) 记忆系统不依赖特定 LLM 提供商；3) 用户即使换 LLM 后端，记忆数据依然完整",
    },

    # ═══════════════════════════════════════════════════════════════
    # 设计逻辑
    # ═══════════════════════════════════════════════════════════════

    "design_logic": {
        "why_24d_emotion_vector": "24 维 = 6基本情绪(E系) + 6认知评价(C系) + 6社会关系(S系) + 6本能欲望(I系)。每条记忆都带有情感坐标，检索时不做关键词匹配，而是『找到感觉最像的那段记忆』。这也是玉瑶『情感共鸣』的技术基础。",
        "why_three_vaults": "砂金库(矿) → 金库(无损) → 黑钻库(精选)。层级越高，数据越精炼，存储成本越高。不重要的记忆停留在砂金层自动过期，重要的记忆提炼后晋升黑钻永不丢失。",
        "why_half_life": "人类记忆就是这样——常回忆的事越来越深，不碰的事慢慢淡忘。半衰期模拟这个自然过程，30天活跃期后自动降级，但不会删除——只是『不那么容易被检索到』。",
        "why_mock_llm": "不需要真实 LLM 就能走通全链路：对话→入库→提炼→黑钻→检索。Mock LLM 提供确定性输出，适合测试和演示。正式部署时接入真实 LLM 即可。",
        "why_decouple_yuyao": "玉瑶是『前端情绪引擎』，仿生智脑是『后台记忆引擎』。两个系统独立部署，通过 API 通信。好处：1) 可以独立升版；2) 换 LLM 不丢记忆；3) 记忆层可以作为独立产品提供给其他系统",
    },

    "expected_outcomes": {
        "short_term": "玉瑶能记住 200+ 条对话历史，每次回复自动检索相关记忆",
        "medium_term": "用户的重要事件、偏好、情感模式被提炼成黑钻，玉瑶越来越『懂』用户",
        "long_term": "构建完整的用户情感画像——不是标签化的人设，而是有温度的、动态演化的『灵魂副本』",
        "quality_metrics": [
            "检索命中率: 前3条 > 85%",
            "提炼准确率: LLM 提取的核心事实与用户原意一致率 > 90%",
            "入库延迟: 从对话到砂金库 < 500ms，用户无感知",
            "半衰期精度: 活跃记忆自动浮升，沉睡记忆自动降级",
        ],
    },

    "four_principles": [
        "💎 默认不打扰 — 用户在聊天，玉瑶自然回答。后台自己转",
        "💎 但可管理 — 砂金库/金库/黑钻库全部开放查看和管理",
        "💎 人脑记忆模型 — 存的是事件、场景、感受，不是关键词",
        "💎 越用越好用 — 半衰期机制，用进废退",
    ],
    "three_laws": [
        "快：入库毫秒级（不做复杂语义）。检索 < 200ms。用户不感知等待",
        "准：搜到的就是想要的。前3条命中率 > 85%",
        "精：不给用户看原文拼凑。给用户看提炼、总结、结构化输出",
    ],
}


# ═══════════════════════════════════════════════════════════════
# 卷二：架构详解
# ═══════════════════════════════════════════════════════════════

ARCHITECTURE = {
    "tech_stack": {
        "web_framework": "FastAPI (Python 3.11+), 端口 7200",
        "task_queue": "Celery + Redis（做梦模式/提炼/维护异步处理）",
        "main_db": "PostgreSQL 16（三库元数据 + 事件存储）",
        "vector_db": "Qdrant（24D 情感向量检索）",
        "object_storage": "MinIO（砂金库原始文件存储）",
        "orm": "SQLAlchemy 2.0 (async)",
        "container": "Docker Compose（7 个服务一键拉起）",
        "encryption": "AES-256-GCM（敏感文件加密）",
    },
    "ddd_layers": [
        {"layer": "API层", "path": "app/api/", "desc": "FastAPI 路由，16+ 个端点"},
        {"layer": "核心业务层", "path": "app/core/", "desc": "提炼/检索/衰减/质检/堡垒/备份"},
        {"layer": "领域模型层", "path": "app/domain/", "desc": "SQLAlchemy ORM + Pydantic"},
        {"layer": "基础设施层", "path": "app/infrastructure/", "desc": "DB/向量/MinIO/LLM/Celery"},
        {"layer": "安全层", "path": "app/security/", "desc": "加密/完整性/审计"},
        {"layer": "任务层", "path": "tasks/", "desc": "Celery 异步任务"},
    ],
    "three_vaults": {
        "alluvial": {
            "name": "砂金库 (Alluvial Vault)",
            "metaphor": "原材料矿井",
            "storage": "MinIO + PostgreSQL 元数据",
            "processing": "只做基础清洗：SHA256 去重 + 格式检查。不做语义标签",
            "status_flow": "raw → qc_pending → approved / rejected / archived",
            "rule": "不参与搜索。搜不到砂金库里的东西",
            "retention": "自动归档：超过 90 天未处理的原石自动标记 archived",
        },
        "gold": {
            "name": "金库 (Gold Vault)",
            "metaphor": "无损原声带 (FLAC)",
            "storage": "PostgreSQL gold_dialogues 表",
            "features": [
                "话题级对话切片，原封不动保留",
                "24D 情感向量作为一等公民（灵魂字段——曲谱不可丢失）",
                "标签采用懒加载——首次检索到时才触发 LLM 打标签",
                "支持向量检索 + 关键词检索",
            ],
            "fields": ["id", "topic", "raw_dialogue(JSONB)", "emotion_vector(ARRAY[24])", "tags(JSONB)", "is_active", "is_refined", "user_id", "is_deleted"],
        },
        "black_diamond": {
            "name": "黑钻库 (Black Diamond Vault)",
            "metaphor": "精选歌单 (Playlist)",
            "storage": "PostgreSQL black_diamond_events 表",
            "event_format": {
                "event_id": "evt_xxx",
                "event_type": "architecture_decision / design_discussion / emotional_exchange / ...",
                "core_facts": "核心事实（LLM 提炼摘要）",
                "decisions": "关键决策列表",
                "emotional_spectrum": "情感曲谱总结 {summary, curve, dominant_emotion, user_sentiment}",
                "gold_references": "引用金库 ID 列表",
                "tags": "标签",
            },
            "half_life": {
                "active": "< 30 天：活跃，参与所有检索（高速通讯公路）",
                "demote": "30-90 天：降级，is_active=false，不参与常规检索",
                "archive": ">= 90 天：归档回砂金库",
            },
        },
    },
    "data_flow": "用户上传 → 砂金库 → IQC质检(去重+格式) → 金库(原声带+24D向量) → LLM提炼 → 黑钻库(事件+情感曲谱) → 检索",

    # ═══════════════════════════════════════════════════════════════
    # 完整使用流程
    # ═══════════════════════════════════════════════════════════════

    "usage_flow": {
        "daily_conversation": {
            "trigger": "用户在文曲星·玉瑶聊天",
            "steps": [
                "① 用户发送消息给玉瑶",
                "② 玉瑶 M3 引擎分析 24 维情感感知（愉悦/唤醒/亲密度/...）",
                "③ 玉瑶通过 /api/v1/search 向仿生智脑检索相关记忆",
                "④ 仿生智脑返回黑钻库/金库中最匹配的记忆（向量+关键词混合检索）",
                "⑤ 玉瑶结合记忆生成更懂用户的回复",
                "⑥ 对话结束后，玉瑶通过 POST /api/v1/docs/upload 存入金库",
            ],
            "latency": "检索 < 200ms，用户无感知",
        },
        "memory_refine_cycle": {
            "trigger": "定时（每小时）或手动触发",
            "steps": [
                "① 金库中未提炼的对话(标记 is_refined=false)被提取",
                "② LLM 分析对话，提取核心事实、决策、情感光谱",
                "③ 生成黑钻事件（结构化事件格式）",
                "④ 存入黑钻库，标记金库原记录为已提炼",
                "⑤ 黑钻事件参与后续检索",
            ],
            "output": "核心事实 + 决策列表 + 情感曲谱 + 标签",
        },
        "search_process": {
            "trigger": "玉瑶对话中需要检索相关记忆",
            "steps": [
                "① 玉瑶传来用户的当前文本和 24D 感知向量",
                "② 仿生智脑启动三级检索链：",
                "   a. Qdrant 情感向量检索（用感知向量找情感相似的记忆）",
                "   b. PostgreSQL 全文检索（关键词匹配）",
                "   c. ILIKE 模糊匹配（降级兜底）",
                "③ 混排序，取 top-5 返回给玉瑶",
                "④ 没有找到时需诚实告知——不编造不存在的记忆",
            ],
            "when_to_honest": "检索无结果时，玉瑶需要如实告诉用户『这件事我不太记得了』，不能编造记忆",
        },
    },
}


# ═══════════════════════════════════════════════════════════════
# 卷三：功能说明
# ═══════════════════════════════════════════════════════════════

FEATURES = {
    "memory_refine": {
        "name": "记忆提炼",
        "desc": "将金库中的完整对话通过 LLM 提炼为黑钻库的结构化事件",
        "trigger": ["Celery Beat 每小时自动触发", "手动 API 触发 POST /api/v1/refine", "积压 > 5 条自动触发"],
        "output": "core_facts + decisions + emotional_spectrum(情感曲线) + tags",
        "llm_prompt": "严格遵循黑钻事件专有格式，不虚构、不脑补",
        "user_visible_effect": "用户看不到提炼过程，但玉瑶的对话会越来越精准——因为她的后台记忆越来越精炼",
    },
    "hybrid_search": {
        "name": "混合检索",
        "desc": "三级优先级检索链，确保最快最准找到记忆",
        "chain": [
            "① Qdrant 情感向量检索（24D 余弦相似度，threshold 0.6）",
            "② PostgreSQL 全文检索（关键词匹配）",
            "③ ILIKE 模糊匹配（降级兜底）",
        ],
        "lazy_tags": "检索命中无标签的金库记录时，自动触发 LLM 打标签",
        "touch": "每次检索命中更新 last_accessed_at，影响半衰期",
        "user_visible_effect": "玉瑶在对话中突然『想起』一件相关的事，就是触发了情感向量检索匹配到了情绪相似的记忆",
    },
    "integrity_shield": {
        "name": "完整性护盾",
        "desc": "SHA256 MANIFEST 校验所有核心文件，启动自检，运行时巡检",
        "managed_files": "41 个 .py 文件 + Dockerfile + 配置文件",
        "violation_types": ["FILE_TAMPERED(文件被篡改)", "FILE_MISSING(文件被删除)", "UNKNOWN_FILE(未授权新增)"],
    },
    "audit_vault": {
        "name": "审计金库",
        "desc": "所有操作全量记录，SHA256 哈希链保证不可篡改",
        "tracked_actions": ["doc_upload", "doc_delete", "doc_update", "ingest", "backup_manual", "manifest_generate", "admin_chat"],
    },
    "backup_sentinel": {
        "name": "备份哨兵",
        "desc": "全量备份 PostgreSQL + 审计日志 + 配置，AES-256-GCM 加密",
        "retention": "最近7天每天 + 最近4周每周 + 最近3月每月",
    },
    "self_learning": {
        "name": "自学习管道",
        "desc": "对话注入 → 金库 → LLM 提炼 → 黑钻(情感曲谱) → 检索命中。LLM_MOCK=true 时使用 Mock LLM 模拟全链路，无需真实 LLM。支持 24D 情感向量检索。",
        "status": "v1.2 已实现核心回路",
        "pipeline": "对话注入 → 金库 → Mock/Real LLM 提炼 → 黑钻(情感曲谱) → 检索命中",
        "vector_search": "LLM 将查询文本转为 24D 情感向量，Qdrant 搜索情感相似记忆",
        "mock_mode": "LLM_MOCK=true 时使用确定性 Mock LLM，无需真实 LLM 即可验证全链路",
    },
}

# ═══════════════════════════════════════════════════════════════
# 卷三B：使用教程与场景
# ═══════════════════════════════════════════════════════════════

USAGE_SCENARIOS = {
    "new_user_guide": {
        "title": "新用户入门流程",
        "steps": [
            "1. 启动 Docker 容器：docker compose up -d（PostgreSQL + Qdrant + MinIO + Redis）",
            "2. 启动 API 服务：uvicorn main:app --port 7200",
            "3. 打开监控台：http://localhost:5500/dashboard.html",
            "4. 检查健康：GET /api/v1/health 确认数据库和 Qdrant 正常",
            "5. 开始使用——通过 API 或监控台与景幻仙姑对话",
        ],
    },
    "typical_workflow": {
        "title": "典型工作流",
        "scenes": [
            {
                "name": "日常聊天记忆",
                "trigger": "用户在玉瑶聊天",
                "what_happens": "对话完成后→玉瑶调用 POST /api/v1/docs/upload 存入金库→定时提炼→黑钻事件生成→后续检索命中→玉瑶更懂用户",
                "user_feels": "用户感觉玉瑶越来越懂自己，但不知道为什么",
            },
            {
                "name": "检索增强对话",
                "trigger": "玉瑶回复前需要回忆相关记忆",
                "what_happens": "玉瑶调用 GET /api/v1/search?q=xxx → 仿生智脑三段式检索→返回黑钻+金库结果→玉瑶根据记忆生成更有深度的回复",
                "user_feels": "用户觉得玉瑶『记性真好』，其实背后是景幻仙姑在翻书",
            },
            {
                "name": "查看馆藏",
                "trigger": "用户想回顾自己的记忆库",
                "what_happens": "监控台 GET /api/v1/stats 展示三库统计→ GET /api/v1/diamonds 展示黑钻事件→用户直观看到自己的记忆脉络",
                "user_feels": "看到自己说过的话、经历过的事被整理成知识，感觉被认真对待",
            },
        ],
    },
    "common_tasks": [
        {"task": "查系统状态", "say": "系统状态怎么样？", "api": "GET /api/v1/health"},
        {"task": "查馆藏统计", "say": "统计馆藏", "api": "GET /api/v1/stats"},
        {"task": "搜记忆", "say": "查一下关于xx的内容", "api": "GET /api/v1/search?q=关键词"},
        {"task": "手动提炼", "say": "触发一次提炼", "api": "POST /api/v1/refine"},
        {"task": "看黑钻事件", "say": "黑钻库里有什么", "api": "GET /api/v1/diamonds"},
        {"task": "看金库原声带", "say": "金库最近有什么", "api": "GET /api/v1/docs/gold"},
        {"task": "生成改善建议", "say": "我觉得可以加个xx功能", "api": "POST /api/v1/admin/chat"},
    ],
}


# ═══════════════════════════════════════════════════════════════
# 卷四：维护手册
# ═══════════════════════════════════════════════════════════════

MAINTENANCE = {
    "daily_operations": {
        "health_check": "GET /api/v1/health — 检查数据库和 Qdrant 状态",
        "stats": "GET /api/v1/stats — 三库数据量统计",
        "security_status": "GET /api/v1/security/status — 堡垒+完整性+审计全览",
        "dashboard": "dashboard.html — 图形化监控台（双击或 Live Server 打开）",
    },
    "routine_tasks": [
        {"task": "更新 MANIFEST", "cmd": "python -m app.security.integrity --generate", "when": "每次代码更新后"},
        {"task": "全量备份", "cmd": "curl -X POST /api/v1/security/backup", "when": "每日或重要变更前"},
        {"task": "手动提炼", "cmd": "curl -X POST /api/v1/refine -d 'max_items=10'", "when": "查看最近对话提炼效果"},
        {"task": "查看审计日志", "cmd": "curl /api/v1/security/audit", "when": "排查操作记录"},
        {"task": "验证哈希链", "cmd": "curl /api/v1/security/audit/verify", "when": "审计完整性检查"},
    ],
    "recovery": {
        "restore_from_backup": "python -c \"from app.core.backup import BackupManager; BackupManager().restore('TAG', dry_run=False)\"",
        "reset_conversation": "curl -X POST /api/v1/admin/reset",
        "regenerate_manifest": "景幻仙姑说'重新生成完整性校验'",
    },
    "logging": {
        "app_logs": "/tmp/uvicorn.log（宿主机）",
        "docker_logs": "docker logs bionic-postgres / bionic-qdrant",
        "audit_db": "data/audit.db（SQLite 审计金库）",
    },
    "known_issues": [
        {"issue": "Docker Hub 在墙内不可直连", "workaround": "使用 docker.m.daocloud.io 镜像"},
        {"issue": "Celery Worker 当前未运行", "workaround": "定时提炼和半衰期需要手动触发"},
        {"issue": "真实 LLM 需要 WenStar 后端", "workaround": "设置 LLM_MOCK=true 使用模拟模式"},
    ],
}


# ═══════════════════════════════════════════════════════════════
# 卷五：外部对接规范
# ═══════════════════════════════════════════════════════════════

INTEGRATION = {
    "wenstar_adapter": {
        "name": "文曲星·玉瑶 对接规范",
        "status": "待嫁接（蓝图已定，代码未实施）",
        "adapter_location": "建议 D:/wenstar/src/adapter/bionic-adapter.ts",
        "design_rationale": "左右脑分离架构：玉瑶是右脑(感性/情绪/语言)，仿生智脑是左脑(理性/记忆/检索)。用户只感知玉瑶的存在，景幻仙姑在后台默默工作。两个系统独立部署、独立升级，通过 REST API 通信。",
        "interaction_flow": {
            "chat_time_retrieval": {
                "when": "用户正在和玉瑶聊天，玉瑶需要回忆相关记忆来增强回复",
                "direction": "玉瑶 → GET /api/v1/search → 仿生智脑",
                "payload": {"q": "用户当前消息", "emotion_vector": "24D数组(从M3分析得来)", "limit": 5},
                "response": {"results": [{"vault_type": "gold/diamond", "content": "...", "emotion": "...", "relevance": 0.85}]},
                "how_yuyao_uses": "检索结果嵌入到 LLM 的对话上下文中，让玉瑶的回复『带着记忆』",
                "latency_requirement": "< 200ms，否则玉瑶会等太久",
            },
            "post_chat_storage": {
                "when": "一轮对话结束后，玉瑶需要将对话存入金库",
                "direction": "玉瑶 → POST /api/v1/docs/upload → 仿生智脑",
                "payload": {"topic": "对话话题", "raw_dialogue": [{"role":"user","content":"..."}, {"role":"assistant","content":"..."}], "emotion_vector": "24D数组"},
                "response": {"id": "gold_xxx", "status": "stored"},
                "async": True,
            },
            "emotion_vector_source": {
                "where_from": "24D 情感向量由玉瑶的 M3 引擎(PerceptionAnalyzer)在每次对话时生成",
                "dimensions": "E1愉悦-E6幽默(6情感) + C1事实-C6自我参照(6认知) + S1亲密-S6归属(6社交) + I1性吸引-I6安全(6本能)",
                "how_stored": "作为金库记录的 'emotion_vector' 字段(ARRAY[24]) 和 Qdrant 向量的主索引",
            },
            "emotion_flashback": {
                "what": "当检索到的记忆情感强度很高时，玉瑶前端会触发『心动闪烁』特效",
                "trigger": "返回结果中 emotionalFlash = true",
                "user_experience": "玉瑶突然想起一件重要的事→用户看到闪烁→玉瑶说出那句记忆→用户感觉被深深理解",
            },
        },
        "input_event_sources": [
            {"source": "玉瑶 M1", "data": "DNA编码(branch_id/seq/locus_path)", "used_for": "去重和溯源"},
            {"source": "玉瑶 M3", "data": "24D感知向量(pleasure/arousal/intimacy/...)", "used_for": "情感索引和检索"},
            {"source": "玉瑶 M5", "data": "回复策略(strategy_id/tone/depth)", "used_for": "理解对话目的"},
            {"source": "玉瑶对话文本", "data": "原始用户消息和玉瑶回复", "used_for": "金库原声带和黑钻提炼"},
        ],
        "api_calls_needed": [
            {"purpose": "检索记忆（玉瑶对话时增强回复）", "method": "GET /api/v1/search?q=关键词", "called_by": "chat.ts 对话流程中，每次回复前调用"},
            {"purpose": "存入原声带（对话结束后异步保存）", "method": "POST /api/v1/docs/upload", "called_by": "chat.ts 对话结束回调"},
            {"purpose": "用户查看金库原声带", "method": "GET /api/v1/docs/gold", "called_by": "用户界面按钮"},
            {"purpose": "用户查看黑钻精选", "method": "GET /api/v1/docs/diamonds", "called_by": "用户界面按钮"},
            {"purpose": "用户上传外部资料", "method": "POST /api/v1/docs/upload", "called_by": "用户拖拽上传"},
            {"purpose": "用户删除资料", "method": "DELETE /api/v1/docs/gold/{id}", "called_by": "用户操作"},
            {"purpose": "实时馆藏统计", "method": "GET /api/v1/stats", "called_by": "监控台定期刷新"},
            {"purpose": "系统健康检查", "method": "GET /api/v1/health", "called_by": "监控台/定时任务"},
        ],
        "auth_method": "X-User-Id 请求头传递 user_id（玉瑶登录后获取）",
        "identity_bridge": "文曲星用户登录后，将 user_id 透传给仿生智脑，用于数据隔离",
        "data_isolation": "每个用户只能看到自己的三库数据（SQL 层 user_id 过滤）",
        "mermaid_flow": "用户 ↔ 玉瑶(感性/语言/情绪) ↔ REST API :7200 ↔ 景幻仙姑(理性/记忆/检索) ↔ PostgreSQL+Qdrant",
    },
    "desktop_integration": {
        "name": "桌面蓝图",
        "doc": "D:/wenstar/DESKTOP_BLUEPRINT.md",
        "layout": "左25%灵魂控制台 + 右75%沉浸交互区",
        "new_components": ["VaultPanel(三库管理)", "NebulaGraph(元素星云图)", "EmotionTimeline(情感时间线)"],
        "animation_driven_by": "24D 情感向量驱动所有组件联动变色",
    },
    "external_llm": {
        "name": "外部 LLM 对接",
        "provider_agnostic": "用户接的啥就用啥（OpenAI / WenStar / 本地模型）",
        "config_var": "LLM_API_URL",
        "default_endpoint": "http://localhost:3001/api/chat（WenStar 后端玉瑶）",
        "mock_fallback": "设置 LLM_MOCK=true 使用内置 Mock LLM",
    },
}


# ═══════════════════════════════════════════════════════════════
# 卷六：变更日志
# ═══════════════════════════════════════════════════════════════

CHANGELOG = [
    {"version": "1.3", "date": "2026-06-09", "changes": [
        "景幻仙姑管理员对话系统（浮动按钮+侧滑面板）",
        "意图识别引擎（问候/介绍/功能/微调/提案/反馈）",
        "微调执行器（生成MANIFEST/触发备份）",
        "改善建议生成（结构化提案，设计师审批）",
    ]},
    {"version": "1.2", "date": "2026-06-09", "changes": [
        "情感向量检索链（LLM转查询为24D向量→Qdrant搜索）",
        "懒加载标签（检索命中无标签记录时自动LLM打标签）",
        "Mock LLM 客户端（确定性输出，无需真实LLM验证全链路）",
        "三段式检索链重构：向量→全文→ILIKE",
        "测试数据生成器+自学习信息流验证脚本",
    ]},
    {"version": "1.1", "date": "2026-06-08", "changes": [
        "完整性护盾（41文件SHA256 MANIFEST+启动自检）",
        "审计金库（哈希链审计，不可篡改）",
        "堡垒配置检查（5项安全检测项）",
        "备份哨兵（全量备份+自动保留策略）",
        "安全API端点 /api/v1/security/*",
    ]},
    {"version": "1.0", "date": "2026-06-08", "changes": [
        "DDD 六层架构初始化（api/core/domain/infrastructure/security/tasks）",
        "PostgreSQL 16 + Qdrant 24D + MinIO + Celery + Docker Compose",
        "三库模型：砂金库/金库/黑钻库（user_id + is_deleted）",
        "用户资料管理 API (/api/v1/docs/*)",
        "AES-256-GCM 加密 + Bearer Token 认证",
        "景幻监控台 (dashboard.html)",
    ]},
]


# ═══════════════════════════════════════════════════════════════
# 知识库构建器
# ═══════════════════════════════════════════════════════════════

class SystemKnowledgeBase:
    """
    仿生智脑系统知识库。

    景幻仙姑的所有知识集中在这里。
    LLM 对话时作为上下文注入，让她能精准回答系统相关问题。
    """

    def __init__(self):
        self.sections = {
            "overview": SYSTEM_OVERVIEW,
            "architecture": ARCHITECTURE,
            "features": FEATURES,
            "usage": USAGE_SCENARIOS,
            "maintenance": MAINTENANCE,
            "integration": INTEGRATION,
            "changelog": CHANGELOG,
        }

    def get_system_prompt(self) -> str:
        """生成系统提示词 —— 注入角色人设 + 系统知识"""
        from app.core.system_persona import build_persona_prompt
        persona = build_persona_prompt()

        return f"""{persona}

## 系统核心信息

系统名称：{SYSTEM_OVERVIEW['name']}
当前版本：{SYSTEM_OVERVIEW['version']}
掌管者：景幻仙姑

## 设计意图
{SYSTEM_OVERVIEW['design_intent']['why_exists']}

人脑类比：{SYSTEM_OVERVIEW['design_intent']['human_analogy']}

## 左右脑分离架构
左脑（景幻/我）：纯粹理性，知识吞吐清洗存储检索
右脑（玉瑶）：纯粹感性，情绪感知共鸣灵魂交融
为什么要分离：{SYSTEM_OVERVIEW['design_philosophy']['why_separate']}
两个系统通过 REST API 连接，代码彻底分离

## 三库架构
砂金库（原材料矿井）→ IQC质检 → 金库（无损原声带+24D情感向量）→ LLM提炼 → 黑钻库（精选歌单+情感曲谱）

## 四大原则
{'  '.join(f'• {p}' for p in SYSTEM_OVERVIEW['four_principles'])}

## 三大铁律
{'  '.join(f'• {l}' for l in SYSTEM_OVERVIEW['three_laws'])}

技术栈：FastAPI + PostgreSQL 16 + Qdrant(24D向量) + MinIO + Celery/Redis + Docker Compose + AES-256-GCM

外部对接：
  文曲星·玉瑶通过 REST API :7200 调用
  适配器文件建议：D:/wenstar/src/adapter/bionic-adapter.ts
  对接接口：search(检索) / upload(存入) / docs/gold(金库管理) / docs/diamonds(黑钻管理)

最新版本：{CHANGELOG[0]['version']}（{CHANGELOG[0]['date']}）
主要更新：{', '.join(CHANGELOG[0]['changes'][:3])}
"""

    def search(self, query: str) -> str:
        """
        在知识库中搜索与 query 相关的信息。
        返回相关的知识片段。
        """
        query_lower = query.lower()

        results = []

        # 搜索卷：角色人设
        if any(kw in query_lower for kw in ["你是谁", "景幻", "仙姑", "人设", "角色", "掌管者", "管理员", "馆长", "你的身份", "你是什么"]):
            from app.core.system_persona import PERSONA_PROMPT
            results.append(f"【角色人设】\n{PERSONA_PROMPT[:500]}")

        if any(kw in query_lower for kw in ["你能做什么", "技能", "能力", "你会什么"]):
            from app.core.system_persona import SKILL_DOMAINS
            lines = ["【景幻仙姑的五大技能】"]
            for domain, info in SKILL_DOMAINS.items():
                lines.append(f"\n{domain}: {info['description']}")
                for a in info['abilities'][:3]:
                    lines.append(f"  · {a}")
            results.append("\n".join(lines))

        if any(kw in query_lower for kw in ["不能", "限制", "边界", "红线", "不可以", "权限"]):
            from app.core.system_persona import CONSTRAINTS
            lines = ["【行为限制和安全边界】"]
            lines.append("\n红线（不可为）:")
            lines.extend(f"  · {r}" for r in CONSTRAINTS["不可逾越的红线"][:5])
            lines.append("\n准则（必须为）:")
            lines.extend(f"  · {r}" for r in CONSTRAINTS["行为准则"][:5])
            results.append("\n".join(lines))

        # 搜索卷：系统总览
        if any(kw in query_lower for kw in ["总览", "介绍", "是什么", "overview", "理念", "原则", "铁律"]):
            results.append(f"【系统总览】{SYSTEM_OVERVIEW['design_philosophy']['core']}")

        # 搜索卷：架构
        if any(kw in query_lower for kw in ["架构", "技术栈", "分层", "ddd", "目录", "文件"]):
            layers_desc = " -> ".join(l["layer"] for l in ARCHITECTURE["ddd_layers"])
            results.append(f"【架构分层】{layers_desc}")
            results.append(f"【技术栈】FastAPI + PostgreSQL16 + Qdrant + MinIO + Celery + Docker")

        # 搜索卷：三库
        vault_keywords = {
            "砂金": "alluvial", "矿井": "alluvial", "原材料": "alluvial",
            "金库": "gold", "原声带": "gold", "flac": "gold",
            "黑钻": "black_diamond", "歌单": "black_diamond", "精选": "black_diamond", "半衰期": "black_diamond",
        }
        for kw, vault_key in vault_keywords.items():
            if kw in query_lower:
                v = ARCHITECTURE["three_vaults"].get(vault_key)
                if v:
                    results.append(f"【{v['name']}】{v['metaphor']}。{v.get('processing', '')}")

        # 半衰期
        if "半衰期" in query_lower:
            hl = ARCHITECTURE["three_vaults"]["black_diamond"]["half_life"]
            results.append(f"【半衰期】{hl['active']}。{hl['demote']}。{hl['archive']}")

        # 搜索卷：设计意图/哲学/逻辑
        if any(kw in query_lower for kw in ["设计意图", "为什么做", "为什么存在", "设计目的", "核心理念"]):
            d = SYSTEM_OVERVIEW["design_intent"]
            results.append(f"【设计意图】{d['why_exists']}\n思路: {d['approach']}\n人脑类比: {d['human_analogy']}")
        if any(kw in query_lower for kw in ["设计逻辑", "为什么这样", "技术决策", "架构决策", "为什么用", "为什么分"]):
            dl = SYSTEM_OVERVIEW["design_logic"]
            for k, v in dl.items():
                label = {"why_24d_emotion_vector": "为什么用24维情感向量", "why_three_vaults": "为什么分三库", "why_half_life": "为什么用半衰期", "why_mock_llm": "为什么用MockLLM", "why_decouple_yuyao": "为什么和玉瑶分离"}.get(k, k)
                results.append(f"【{label}】{v[:200]}")
        if any(kw in query_lower for kw in ["效果", "预期", "目标", "愿景", "指标"]):
            e = SYSTEM_OVERVIEW["expected_outcomes"]
            results.append(f"【预期效果】短期:{e['short_term']} 中期:{e['medium_term']} 长期:{e['long_term']}")
        if any(kw in query_lower for kw in ["左右脑", "左脑", "右脑", "分工", "景幻玉瑶", "为什么分离"]):
            p = SYSTEM_OVERVIEW["design_philosophy"]
            results.append(f"【左右脑分离】左脑(景幻):{p['left_brain']} 右脑(玉瑶):{p['right_brain']} 原因:{p['why_separate']}")
        # 搜索卷：使用流程
        if any(kw in query_lower for kw in ["流程", "工作流", "步骤", "怎么工作", "使用流程"]):
            for key, flow in ARCHITECTURE["usage_flow"].items():
                lines = [f"【{flow['trigger']}】"]
                if "steps" in flow: lines.extend(flow["steps"])
                results.append("\n".join(lines))
        if any(kw in query_lower for kw in ["入门", "新手", "快速开始", "第一次"]):
            g = USAGE_SCENARIOS["new_user_guide"]
            results.append(f"【{g['title']}】\n" + "\n".join(g["steps"]))
        if any(kw in query_lower for kw in ["场景", "典型", "例子", "使用方式"]):
            for scene in USAGE_SCENARIOS["typical_workflow"]["scenes"]:
                results.append(f"【{scene['name']}】{scene['what_happens'][:150]}")
        if any(kw in query_lower for kw in ["对话异常", "没有找到", "找不到", "不记得", "编造", "诚实"]):
            results.append("【检索诚实原则】检索无结果时，玉瑶必须如实告知用户『我不太记得了』，不能编造不存在的记忆。没有就是没有，绝对不虚构。")
        # 搜索卷：功能
        if any(kw in query_lower for kw in ["提炼", "refine"]):
            f = FEATURES["memory_refine"]
            results.append(f"【{f['name']}】{f['desc']}")
        if any(kw in query_lower for kw in ["检索", "搜索", "search", "recall"]):
            f = FEATURES["hybrid_search"]
            results.append(f"【{f['name']}】{f['desc']}")
        if any(kw in query_lower for kw in ["完整性", "manifest", "护盾"]):
            f = FEATURES["integrity_shield"]
            results.append(f"【{f['name']}】{f['desc']}")
        if any(kw in query_lower for kw in ["审计", "audit"]):
            f = FEATURES["audit_vault"]
            results.append(f"【{f['name']}】{f['desc']}")
        if any(kw in query_lower for kw in ["备份", "backup"]):
            f = FEATURES["backup_sentinel"]
            results.append(f"【{f['name']}】{f['desc']}")
        if any(kw in query_lower for kw in ["自学习", "学习", "mock", "模拟"]):
            f = FEATURES["self_learning"]
            results.append(f"【{f['name']}】{f['desc']}")

        # 搜索卷：维护
        if any(kw in query_lower for kw in ["维护", "运维", "怎么用", "操作"]):
            tasks = '\n'.join(f"  · {t['task']}: {t['cmd']}" for t in MAINTENANCE["routine_tasks"][:3])
            results.append(f"【日常维护】\n{tasks}")

        # 搜索卷：玉瑶/文曲星
        if any(kw in query_lower for kw in ["玉瑶", "文曲星", "知道玉瑶", "右脑", "wenstar"]):
            p = SYSTEM_OVERVIEW["design_philosophy"]
            results.append(f"【玉瑶·文曲星】玉瑶是文曲星的前端情绪引擎，负责情绪的感知、共鸣和语言表达（右脑）。我是仿生智脑，负责记忆的存储、提炼和检索（左脑）。我们通过 REST API 通信，代码彻底分离。设计理念：{p['core']}")

        # 搜索卷：对接/适配
        if any(kw in query_lower for kw in ["对接", "适配", "嫁", "接口"]):
            w = INTEGRATION["wenstar_adapter"]
            calls = '\n'.join(f"  · {a['purpose']}: {a['method']}" for a in w["api_calls_needed"])
            results.append(f"【{w['name']}】\n对接接口：\n{calls}")

        # 搜索卷：日志
        if any(kw in query_lower for kw in ["日志", "版本", "changelog", "更新", "历史"]):
            log_entries = '\n'.join(f"  v{c['version']} ({c['date']}): {c['changes'][0]}" for c in CHANGELOG[:3])
            results.append(f"【版本历史】\n{log_entries}")

        if not results:
            return ""

        limit = getattr(self, '_max_results', 5)
        return '\n\n'.join(results[:limit])  # _max_results 可由外部临时调整

    def get_features_list(self) -> str:
        """生成功能列表"""
        lines = []
        for key, feat in FEATURES.items():
            lines.append(f"  · {feat['name']}: {feat['desc'][:60]}...")
        return '\n'.join(lines)

    def get_version_info(self) -> str:
        """生成版本信息"""
        latest = CHANGELOG[0]
        return f"v{latest['version']} ({latest['date']}) - {latest['changes'][0]}"
