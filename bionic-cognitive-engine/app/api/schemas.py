"""
仿生智脑 · API 请求/响应模型 (Pydantic Schemas)

玉瑶通过 REST API 与景幻仙姑通信的数据契约。
"""
from datetime import datetime
from typing import Optional, List, Any

from pydantic import BaseModel, Field


# ── 请求 ──

class IngestResponse(BaseModel):
    """文件上传响应"""
    id: str = Field("", description="砂金库记录 ID")
    status: str = Field("qc_pending", description="入库状态")
    file_hash: str = Field("", description="SHA256 哈希")
    message: str = Field("", description="提示信息")


class SearchRequest(BaseModel):
    """检索请求"""
    query: str = Field(..., min_length=1, max_length=200, description="检索关键词")
    limit: int = Field(5, ge=1, le=50, description="最大返回条数")


class SearchResultItem(BaseModel):
    """检索结果单条"""
    id: str = ""
    event_id: Optional[str] = None
    event_type: Optional[str] = None
    topic: Optional[str] = None
    core_facts: Optional[str] = None
    emotional_spectrum: Optional[dict] = None
    tags: Optional[list] = None
    decay_days: Optional[int] = None
    source: str = ""


class SearchResponse(BaseModel):
    """检索响应"""
    query: str = ""
    source: str = "none"  # vector | fulltext | fallback | none
    results: List[SearchResultItem] = []
    latency_ms: int = 0


class RefineRequest(BaseModel):
    """手动触发提炼请求"""
    max_items: int = Field(5, ge=1, le=50, description="单次最多提炼条数")


class RefineResponse(BaseModel):
    """提炼响应"""
    processed: int = 0
    promoted: int = 0
    failed: int = 0
    errors: List[str] = []


class CreateDiamondRequest(BaseModel):
    """手动创建黑钻事件"""
    event_type: str = "general_conversation"
    core_facts: str = ""
    decisions: List[str] = []
    emotional_spectrum: dict = {}
    gold_references: List[str] = []
    tags: List[str] = []


class DiamondEventResponse(BaseModel):
    """黑钻事件响应"""
    id: str = ""
    event_id: str = ""
    event_type: str = ""
    occurred_at: str = ""
    core_facts: str = ""
    decisions: list = []
    emotional_spectrum: dict = {}
    gold_references: list = []
    decay_days: int = 0
    is_active: bool = True
    tags: list = []
    created_at: str = ""


class StatsResponse(BaseModel):
    """三库统计"""
    alluvial: int = 0
    gold: int = 0
    black_diamond: int = 0
    total: int = 0


class HealthResponse(BaseModel):
    """健康检查响应"""
    status: str = "ok"
    services: dict = {}
    version: str = "1.0.0"


class ErrorResponse(BaseModel):
    """错误响应"""
    error: str = ""
    detail: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# 用户资料管理 (Docs API) — 面向用户界面
# 用户只看到"我的资料"，不感知三库底层
# ═══════════════════════════════════════════════════════════════

class GoldDocSummary(BaseModel):
    """金库资料摘要（列表用）"""
    id: str = ""
    topic: str = ""
    tags: List[str] = []
    emotion_summary: Optional[str] = None  # 情感摘要
    created_at: str = ""
    is_refined: bool = False
    vad_pending: bool = False  # 是否待谱曲


class GoldDocDetail(BaseModel):
    """金库资料详情（原声回放）—— 完整歌单：歌词 + 24D曲谱 + VAD谱曲"""
    id: str = ""
    topic: str = ""
    raw_dialogue: list = []         # [{role, content}, ...]
    emotion_vector: Optional[List[float]] = None  # 24D 情感向量（M3产出）
    vad_spectrum: Optional[dict] = None  # VAD完整谱曲（谱曲引擎产出）
    vad_pending: bool = False       # 是否待谱曲
    tags: List[str] = []
    is_refined: bool = False
    created_at: str = ""
    updated_at: str = ""


class DiamondDocSummary(BaseModel):
    """黑钻资料摘要（列表用）"""
    id: str = ""
    event_id: str = ""
    event_type: str = ""
    core_facts: str = ""
    dominant_emotion: str = ""
    tags: List[str] = []
    decay_days: int = 0
    is_active: bool = True
    created_at: str = ""


class DiamondDocDetail(BaseModel):
    """黑钻资料详情"""
    id: str = ""
    event_id: str = ""
    event_type: str = ""
    occurred_at: str = ""
    core_facts: str = ""
    decisions: List[str] = []
    emotional_spectrum: dict = {}
    gold_references: List[str] = []
    decay_days: int = 0
    is_active: bool = True
    tags: List[str] = []
    created_at: str = ""
    updated_at: str = ""


class UpdateDiamondRequest(BaseModel):
    """更新黑钻资料请求"""
    core_facts: Optional[str] = None
    decisions: Optional[List[str]] = None
    emotional_spectrum: Optional[dict] = None
    tags: Optional[List[str]] = None


class DeleteResponse(BaseModel):
    """删除响应"""
    status: str = "deleted"
    id: str = ""
    message: str = ""


class DocListResponse(BaseModel):
    """资料列表响应（支持分页）"""
    items: list = []
    total: int = 0
    page: int = 1
    page_size: int = 20
