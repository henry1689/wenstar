"""
仿生智脑 · 领域枚举 (Domain Enums)

定义系统中所有状态枚举和类型常量。
遵循 DDD 原则：枚举即业务语言。
"""
import enum


class AlluvialStatus(str, enum.Enum):
    """砂金库记录状态"""
    RAW = "raw"                       # 原始状态，刚入库
    QC_PENDING = "qc_pending"         # 待 IQC 质检
    QC_PROCESSING = "qc_processing"   # 质检中
    APPROVED = "approved"             # 质检通过 → 升入金库
    REJECTED = "rejected"             # 质检不通过
    ARCHIVED = "archived"             # 已归档


class IQCQueueStatus(str, enum.Enum):
    """IQC 队列条目状态"""
    PENDING = "pending"               # 待处理
    PROCESSING = "processing"         # 处理中
    DONE = "done"                     # 处理完成
    FAILED = "failed"                 # 处理失败（超过重试次数）


class DiamondEventType(str, enum.Enum):
    """黑钻事件类型"""
    ARCHITECTURE_DECISION = "architecture_decision"
    DESIGN_DISCUSSION = "design_discussion"
    TECHNICAL_DISCUSSION = "technical_discussion"
    BUG_FIX = "bug_fix"
    EMOTIONAL_EXCHANGE = "emotional_exchange"
    DAILY_CONVERSATION = "daily_conversation"
    PLANNING = "planning"
    DECISION = "decision"
    LEARNING = "learning"
    KNOWLEDGE = "knowledge"
    GENERAL_CONVERSATION = "general_conversation"


class EventType(str, enum.Enum):
    """系统事件类型"""
    INGEST = "ingest"                  # 砂金入库
    IQC_COMPLETE = "iqc_complete"      # IQC 完成
    PROMOTE_TO_GOLD = "promote_to_gold"  # 升入金库
    PROMOTE_TO_DIAMOND = "promote_to_diamond"  # 升入黑钻库
    DEMOTE = "demote"                  # 降级
    ARCHIVE = "archive"                # 归档
    ERROR = "error"                    # 错误事件
