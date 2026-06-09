"""
仿生智脑 · 领域模型 (SQLAlchemy ORM)

建模三部曲·第一步：
  把"虚无缥缈"的对话，变成"钢筋水泥"的数据结构。

三张核心表：
  - alluvial_records  → 砂金库（原始材料矿井）
  - gold_dialogues    → 金库（无损原声带 + 24D情感向量）
  - black_diamond_events → 黑钻库（结构化事件 + 情感曲谱）

情感向量（24D）是本系统的"灵魂字段"。
金库：保留完整24D情感向量（曲谱不可丢失）。
黑钻库：情感提炼是对曲谱的总结，不是替代。
"""
import uuid
from datetime import datetime, timezone
from typing import Optional, List

from sqlalchemy import (
    Column, String, Text, Boolean, Integer, BigInteger,
    DateTime, Float, ForeignKey, JSON, Enum as SAEnum,
    Index, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    __allow_unmapped__ = True  # 兼容 Column() 风格注解


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


# ═══════════════════════════════════════════════════════════════
# 金库模型：GoldVaultEntity — 无损原声带
# ═══════════════════════════════════════════════════════════════

class GoldVaultEntity(Base):
    """
    金库实体 — 话题级对话切片，原封不动保留。

    对应矿脉图的"金库"：
      - 存完整对话（raw_dialogue 作为 JSON 数组）
      - 24D 情感向量作为一等公民（emotion_vector）
      - 标签采用懒加载（首次检索到时才触发 LLM 打标签）
    """
    __tablename__ = "gold_dialogues"

    id: str = Column(String(36), primary_key=True, default=_new_uuid)
    topic: str = Column(String(255), nullable=False, index=True, comment="对话话题")
    raw_dialogue: dict = Column(JSONB, nullable=False, comment="完整对话列表 [{role, content}]")

    # ── 24D 情感向量（灵魂字段——曲谱不可丢失）──
    emotion_vector: list = Column(
        ARRAY(Float), nullable=True, comment="24D 情感向量数组（valence/arousal/dominance 等维度）"
    )

    # ── VAD 谱曲（歌单的曲谱部分）──
    vad_spectrum: dict = Column(JSONB, nullable=True, comment="VAD完整谱曲（情感谱曲引擎产出）")
    vad_pending: bool = Column(Boolean, default=False, comment="是否待谱曲（谱曲引擎不可用时标记）")

    # ── 元数据 ──
    is_active: bool = Column(Boolean, default=True, comment="是否活跃（非活跃不参与常规检索）")
    is_refined: bool = Column(Boolean, default=False, comment="是否已提炼为黑钻事件")
    vector_id: Optional[str] = Column(String(64), nullable=True, comment="Qdrant 向量点 ID")
    tags: list = Column(JSONB, default=list, comment="标签数组（懒加载）")

    # ── 用户管理 ──
    user_id: Optional[str] = Column(String(36), nullable=True, comment="归属用户 ID")
    is_deleted: bool = Column(Boolean, default=False, comment="软删除标记")

    created_at: datetime = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: datetime = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    # 关系
    diamond_events: list = relationship("BlackDiamondEntity",
                                         secondary="diamond_gold_link",
                                         back_populates="gold_sources",
                                         lazy="selectin")

    __table_args__ = (
        Index("idx_gold_topic", "topic"),
        Index("idx_gold_active", "is_active"),
        Index("idx_gold_refined", "is_refined"),
        Index("idx_gold_user", "user_id"),
        Index("idx_gold_deleted", "is_deleted"),
    )

    def __repr__(self) -> str:
        return f"<GoldVaultEntity {self.topic[:30]} active={self.is_active}>"


# ═══════════════════════════════════════════════════════════════
# 黑钻库模型：BlackDiamondEntity — 精选歌单
# ═══════════════════════════════════════════════════════════════

class BlackDiamondEntity(Base):
    """
    黑钻库实体 — 结构化事件 + 情感曲谱总结。

    对应蓝图中的"事件专有格式"：
      - core_facts: 核心事实（内容提炼）
      - decisions: 关键决策列表
      - emotional_spectrum: 情感曲谱总结（曲线+主导情绪）
      - gold_references: 引用自金库哪些原声

    半衰期机制：
      - decay_days >= 30 → is_active=False（降级）
      - decay_days >= 90 → 归档移出
    """
    __tablename__ = "black_diamond_events"

    id: str = Column(String(36), primary_key=True, default=_new_uuid)
    event_id: str = Column(String(50), unique=True, nullable=False, comment="业务事件 ID (evt_xxx)")
    event_type: str = Column(String(50), nullable=False, index=True, comment="事件类型")
    occurred_at: datetime = Column(DateTime(timezone=True), nullable=False, comment="事件发生时间")

    # ── 内容提炼 ──
    core_facts: str = Column(Text, nullable=False, comment="核心事实（LLM 提炼摘要）")
    decisions: list = Column(JSONB, default=list, comment="关键决策列表 [str]")

    # ── 情感提炼（灵魂字段——歌单的核心价值）──
    emotional_spectrum: dict = Column(
        JSONB, nullable=False,
        comment="情感曲谱总结 {summary, curve[{phase,valence,arousal}], dominant_emotion, user_sentiment}"
    )

    # ── 引用链 ──
    gold_references: list = Column(JSONB, default=list, comment="引用金库 ID 列表")

    # ── 半衰期 ──
    decay_days: int = Column(Integer, default=0, comment="已存在天数")
    last_accessed_at: Optional[datetime] = Column(DateTime(timezone=True), nullable=True, comment="最后访问时间")
    is_active: bool = Column(Boolean, default=True, comment="是否活跃（活跃=高速通讯公路）")

    # ── 元数据 ──
    tags: list = Column(JSONB, default=list, comment="标签")
    vector_id: Optional[str] = Column(String(64), nullable=True, comment="Qdrant 向量点 ID")

    # ── 用户管理 ──
    user_id: Optional[str] = Column(String(36), nullable=True, comment="归属用户 ID")
    is_deleted: bool = Column(Boolean, default=False, comment="软删除标记")

    created_at: datetime = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: datetime = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    __table_args__ = (
        Index("idx_bd_event_type", "event_type"),
        Index("idx_bd_occurred_at", "occurred_at"),
        Index("idx_bd_active", "is_active"),
        Index("idx_bd_decay", "decay_days"),
        Index("idx_bd_user", "user_id"),
        Index("idx_bd_deleted", "is_deleted"),
    )

    def __repr__(self) -> str:
        return f"<BlackDiamondEntity {self.event_id} type={self.event_type} decay={self.decay_days}d>"


# ═══════════════════════════════════════════════════════════════
# 关联表：黑钻 ↔ 金库
# ═══════════════════════════════════════════════════════════════

class DiamondGoldLink(Base):
    """黑钻事件 ↔ 金库对话 多对多关联表"""
    __tablename__ = "diamond_gold_link"

    id: str = Column(String(36), primary_key=True, default=_new_uuid)
    diamond_id: str = Column(String(36), ForeignKey("black_diamond_events.id", ondelete="CASCADE"), nullable=False)
    gold_id: str = Column(String(36), ForeignKey("gold_dialogues.id", ondelete="CASCADE"), nullable=False)
    created_at: datetime = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("diamond_id", "gold_id", name="uq_diamond_gold"),
        Index("idx_link_diamond", "diamond_id"),
        Index("idx_link_gold", "gold_id"),
    )


BlackDiamondEntity.gold_sources = relationship(
    "GoldVaultEntity",
    secondary="diamond_gold_link",
    back_populates="diamond_events",
    lazy="selectin"
)


# ═══════════════════════════════════════════════════════════════
# 砂金库模型：AlluvialRecord — 原材料矿井
# ═══════════════════════════════════════════════════════════════

class AlluvialRecord(Base):
    """
    砂金库实体 — 原始材料矿井。

    只做基础清洗（格式检查 + SHA256 去重）。
    不做语义标签，不做向量索引。
    不参与搜索——搜不到砂金库里的东西。
    """
    __tablename__ = "alluvial_records"

    id: str = Column(String(36), primary_key=True, default=_new_uuid)
    file_path: str = Column(Text, nullable=False, comment="原始文件路径")
    file_hash: Optional[str] = Column(String(64), nullable=True, comment="SHA256 哈希")
    file_size: int = Column(BigInteger, default=0, comment="文件大小（字节）")
    status: str = Column(String(20), nullable=False, default="raw", comment="状态: raw/qc_pending/approved/rejected/archived")
    minio_object_key: Optional[str] = Column(String(255), nullable=True, comment="MinIO 对象键")
    source_name: Optional[str] = Column(String(255), nullable=True, comment="源文件名")
    checksum_verified: bool = Column(Boolean, default=False, comment="SHA256 校验是否通过")

    # ── 用户管理 ──
    user_id: Optional[str] = Column(String(36), nullable=True, comment="归属用户 ID")
    is_deleted: bool = Column(Boolean, default=False, comment="软删除标记")

    created_at: datetime = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: datetime = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    __table_args__ = (
        Index("idx_alluvial_status", "status"),
        Index("idx_alluvial_hash", "file_hash"),
    )

    def __repr__(self) -> str:
        return f"<AlluvialRecord {self.source_name} status={self.status}>"


# ═══════════════════════════════════════════════════════════════
# IQC 队列模型
# ═══════════════════════════════════════════════════════════════

class IQCQueueRecord(Base):
    """IQC 质检队列"""
    __tablename__ = "iqc_queue"

    id: str = Column(String(36), primary_key=True, default=_new_uuid)
    alluvial_id: str = Column(String(36), ForeignKey("alluvial_records.id"), nullable=False)
    status: str = Column(String(20), nullable=False, default="pending", comment="pending/processing/done/failed")
    retry_count: int = Column(Integer, default=0, comment="重试次数")
    error_message: Optional[str] = Column(Text, nullable=True, comment="错误信息")
    quality_score: Optional[float] = Column(Float, nullable=True, comment="基础质量评分")

    created_at: datetime = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: datetime = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False)

    __table_args__ = (
        Index("idx_iqc_status", "status"),
    )


# ═══════════════════════════════════════════════════════════════
# Pydantic 领域模型（API 层使用）
# ═══════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field
from typing import Optional as Opt, List as L


class EmotionalCurvePoint(BaseModel):
    """情感曲线上的一个点"""
    phase: str = Field("", description="阶段描述，如'提出问题时'、'确认方案时'")
    valence: float = Field(0.0, ge=0.0, le=1.0, description="愉悦度: 0=负面, 0.5=中性, 1.0=正面")
    arousal: float = Field(0.0, ge=0.0, le=1.0, description="唤醒度: 0=平静, 0.5=中等, 1.0=强烈")


class EmotionalSpectrum(BaseModel):
    """情感曲谱总结——灵魂字段"""
    summary: str = Field("", description="情感变化的整体描述")
    curve: L[EmotionalCurvePoint] = Field(default_factory=list, description="情感曲线（按时间顺序）")
    dominant_emotion: str = Field("平静", description="主导情绪")
    user_sentiment: str = Field("中性", description="用户在这段对话中的态度")


class BlackDiamondEvent(BaseModel):
    """黑钻事件专有格式（蓝图卷三·3.4）"""
    event_id: str = Field("", description="业务事件 ID (evt_xxx)")
    event_type: str = Field("general_conversation", description="事件类型")
    timestamp: str = Field("", description="发生时间 ISO8601")
    core_facts: str = Field("", description="核心事实（LLM 提炼）")
    decisions: L[str] = Field(default_factory=list, description="关键决策列表")
    emotional_spectrum: EmotionalSpectrum = Field(default_factory=EmotionalSpectrum, description="情感曲谱总结")
    gold_references: L[str] = Field(default_factory=list, description="引用的金库 ID")
    tags: L[str] = Field(default_factory=list, description="标签")


class DialogueChunk(BaseModel):
    """金库对话切片（原声带）"""
    topic: str = Field("", description="话题")
    raw_dialogue: L[dict] = Field(default_factory=list, description="对话列表 [{role, content}]")
    emotion_vector: Opt[L[float]] = Field(None, description="24D 情感向量")


class SearchResult(BaseModel):
    """检索结果"""
    query: str = ""
    source: str = "none"  # vector | fulltext | fallback | none
    results: L[dict] = Field(default_factory=list)
    latency_ms: int = 0
