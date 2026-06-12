"""
仿生智脑 · FastAPI 路由定义

景幻仙姑的 REST API 接口。
调用者（玉瑶）只看到 Input → Output，内部三库流转完全无感。

路由前缀: /api/v1
"""
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    IngestResponse, SearchResponse, SearchResultItem,
    RefineResponse, CreateDiamondRequest, DiamondEventResponse,
    StatsResponse, HealthResponse, DocListResponse, GoldDocSummary,
    GoldDocDetail, DiamondDocSummary, DiamondDocDetail,
    UpdateDiamondRequest, DeleteResponse,
)
from app.api.deps import get_db, verify_token
from app.core.config import settings
from app.domain.models import (
    AlluvialRecord, GoldVaultEntity, BlackDiamondEntity, IQCQueueRecord,
)
from app.infrastructure.vector_store import VectorStore

logger = logging.getLogger("bionic.api")

# ── 路由实例 ──
router = APIRouter(prefix="/api/v1", dependencies=[Depends(verify_token)])

# ── 全局服务实例（由 main.py 注入）──
vector_store: Optional[VectorStore] = None
refiner = None
searcher = None


def init_services(vs: VectorStore, ref, search):
    """由 main.py 调用，注入服务实例"""
    global vector_store, refiner, searcher
    vector_store = vs
    refiner = ref
    searcher = search


# ── 安全模块实例（由 main.py 注入）──
_audit_vault = None
_fortress = None


def _set_audit_vault(vault):
    global _audit_vault
    _audit_vault = vault


def _set_fortress(fortress):
    global _fortress
    _fortress = fortress


def _audit(action: str, detail: dict = None, user_id: str = None, ip: str = None):
    """统一的审计记录入口"""
    if _audit_vault:
        try:
            _audit_vault.record(action, detail, user_id, ip)
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════
# 路由：健康检查
# ═══════════════════════════════════════════════════════════════

@router.get("/health", response_model=HealthResponse)
async def health_check(db: AsyncSession = Depends(get_db)):
    """健康检查（含各依赖服务状态）"""
    services = {}

    # 数据库
    try:
        await db.execute(func.now())
        services["database"] = "ok"
    except Exception as e:
        services["database"] = f"error: {e}"

    # Qdrant
    if vector_store:
        services["qdrant"] = "ok" if vector_store.health_check() else "unavailable"
    else:
        services["qdrant"] = "not_configured"

    return HealthResponse(
        status="ok",
        services=services,
        version="1.1.0",
    )


# ═══════════════════════════════════════════════════════════════
# 路由：三库统计
# ═══════════════════════════════════════════════════════════════

@router.get("/stats", response_model=StatsResponse)
async def get_stats(db: AsyncSession = Depends(get_db)):
    """获取三库统计"""
    alluvial = (await db.execute(
        select(func.count(AlluvialRecord.id)))).scalar() or 0
    gold = (await db.execute(
        select(func.count(GoldVaultEntity.id)))).scalar() or 0
    bd = (await db.execute(
        select(func.count(BlackDiamondEntity.id)))).scalar() or 0

    return StatsResponse(
        alluvial=alluvial, gold=gold,
        black_diamond=bd, total=alluvial + gold + bd,
    )


# ═══════════════════════════════════════════════════════════════
# 路由：砂金库入库
# ═══════════════════════════════════════════════════════════════

@router.post("/ingest", response_model=IngestResponse)
async def ingest_file(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    文件上传 → 砂金库入库。

    只做基础清洗：格式检查 + SHA256 去重。
    不做语义标签，不做向量索引。
    """
    content = await file.read()
    file_size = len(content)

    if file_size == 0:
        raise HTTPException(status_code=400, detail="空文件")

    # SHA256 去重
    import hashlib
    file_hash = hashlib.sha256(content).hexdigest()

    existing = (await db.execute(
        select(AlluvialRecord).where(
            AlluvialRecord.file_hash == file_hash,
            AlluvialRecord.status.in_(["approved", "qc_pending"]),
        )
    )).scalar_one_or_none()

    if existing:
        return IngestResponse(
            id=existing.id,
            status="duplicate",
            file_hash=file_hash,
            message=f"SHA256 重复: {file_hash[:12]}",
        )

    # 写入数据库
    record = AlluvialRecord(
        file_path=file.filename or "unknown",
        file_hash=file_hash,
        file_size=file_size,
        status="qc_pending",
        source_name=file.filename or "unknown",
    )
    db.add(record)
    await db.flush()

    # 排入 IQC 队列
    iqc_item = IQCQueueRecord(
        alluvial_id=record.id,
        status="pending",
    )
    db.add(iqc_item)

    # 写入 MinIO（如果有）
    from app.infrastructure.storage import StorageManager
    storage = StorageManager()
    if storage.initialize():
        obj_key = f"{file_hash[:8]}_{file.filename}"
        storage.upload_file(obj_key, content)
        record.minio_object_key = obj_key

    await db.commit()

    logger.info(f"砂金入库: {record.id} file={file.filename} size={file_size}")
    _audit("ingest", {"file": file.filename, "size": file_size})
    return IngestResponse(
        id=record.id, status="qc_pending",
        file_hash=file_hash,
        message=f"已入砂金库，待质检。哈希: {file_hash[:12]}",
    )


# ═══════════════════════════════════════════════════════════════
# 路由：检索
# ═══════════════════════════════════════════════════════════════

@router.get("/search", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, max_length=200, description="检索关键词"),
    limit: int = Query(5, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    user_id: str = Query("default_user", description="用户 ID（由调用方传入）"),
):
    """
    混合检索：黑钻(向量) → 黑钻(全文) → 金库(ILIKE) → 未命中。

    玉瑶说"我想起上次我们聊的..."，系统自动优先查黑钻库。
    自动按当前用户过滤数据（默认用户为 default_user）。
    玉瑶调用时请传入 X-User-Id 请求头，系统自动提取 user_id。
    """
    if not searcher:
        # 降级为直接数据库查询（也传 user_id）
        return await _fallback_search(db, q, limit, user_id)

    result = await searcher.recall(db, q, limit, user_id=user_id)

    items = []
    for r in result.results:
        items.append(SearchResultItem(**r))

    return SearchResponse(
        query=q, source=result.source,
        results=items, latency_ms=result.latency_ms,
    )


async def _fallback_search(db: AsyncSession, q: str, limit: int,
                            user_id: str = "default_user") -> SearchResponse:
    """降级检索（无向量服务时），自动按用户过滤"""
    import time
    start = time.time()
    like = f"%{q}%"

    # 黑钻库优先（按用户过滤）
    stmt = select(BlackDiamondEntity).where(
        BlackDiamondEntity.is_active == True,
        BlackDiamondEntity.is_deleted == False,
        BlackDiamondEntity.core_facts.ilike(like),
        BlackDiamondEntity.user_id == user_id,
    ).order_by(BlackDiamondEntity.decay_days.asc()).limit(limit)

    rows = (await db.execute(stmt)).scalars().all()

    if rows:
        items = []
        for r in rows:
            items.append(SearchResultItem(
                id=r.id, event_id=r.event_id,
                event_type=r.event_type,
                core_facts=r.core_facts[:200],
                tags=r.tags, decay_days=r.decay_days,
                source="fulltext",
            ))
        return SearchResponse(
            query=q, source="fulltext",
            results=items, latency_ms=round((time.time() - start) * 1000),
        )

    # 金库降级（按用户过滤）
    stmt2 = select(GoldVaultEntity).where(
        GoldVaultEntity.is_active == True,
        GoldVaultEntity.is_deleted == False,
        GoldVaultEntity.topic.ilike(like),
        GoldVaultEntity.user_id == user_id,
    ).order_by(GoldVaultEntity.created_at.desc()).limit(limit)

    rows2 = (await db.execute(stmt2)).scalars().all()

    items = []
    for g in rows2:
        items.append(SearchResultItem(
            id=g.id, topic=g.topic, source="gold",
        ))

    return SearchResponse(
        query=q, source="gold" if items else "none",
        results=items,
        latency_ms=round((time.time() - start) * 1000),
    )


# ═══════════════════════════════════════════════════════════════
# 路由：黑钻事件
# ═══════════════════════════════════════════════════════════════

@router.get("/diamonds", response_model=list[DiamondEventResponse])
async def list_diamonds(
    limit: int = Query(20, ge=1, le=100),
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
):
    """获取黑钻事件列表"""
    stmt = select(BlackDiamondEntity).order_by(
        BlackDiamondEntity.created_at.desc()
    ).limit(limit)

    if active_only:
        stmt = stmt.where(BlackDiamondEntity.is_active == True)

    stmt = stmt.where(BlackDiamondEntity.is_deleted == False)

    rows = (await db.execute(stmt)).scalars().all()

    return [
        DiamondEventResponse(
            id=r.id, event_id=r.event_id,
            event_type=r.event_type,
            occurred_at=r.occurred_at.isoformat() if r.occurred_at else "",
            core_facts=r.core_facts,
            decisions=r.decisions or [],
            emotional_spectrum=r.emotional_spectrum or {},
            gold_references=r.gold_references or [],
            decay_days=r.decay_days or 0,
            is_active=r.is_active,
            tags=r.tags or [],
            created_at=r.created_at.isoformat() if r.created_at else "",
        ) for r in rows
    ]


@router.post("/diamonds", response_model=DiamondEventResponse)
async def create_diamond(
    req: CreateDiamondRequest,
    db: AsyncSession = Depends(get_db),
):
    """手动创建黑钻事件"""
    import secrets
    event = BlackDiamondEntity(
        event_id=f"evt_{secrets.token_hex(8)}",
        event_type=req.event_type,
        occurred_at=datetime.now(timezone.utc),
        core_facts=req.core_facts,
        decisions=req.decisions,
        emotional_spectrum=req.emotional_spectrum,
        gold_references=req.gold_references,
        tags=req.tags,
    )
    db.add(event)
    await db.commit()

    return DiamondEventResponse(
        id=event.id, event_id=event.event_id,
        event_type=event.event_type,
        occurred_at=event.occurred_at.isoformat() if event.occurred_at else "",
        core_facts=event.core_facts,
        decisions=event.decisions or [],
        emotional_spectrum=event.emotional_spectrum or {},
        gold_references=event.gold_references or [],
        decay_days=event.decay_days or 0,
        is_active=event.is_active,
        tags=event.tags or [],
        created_at=event.created_at.isoformat() if event.created_at else "",
    )


@router.delete("/diamonds/{event_id}")
async def delete_diamond(
    event_id: str,
    db: AsyncSession = Depends(get_db),
):
    """降级/删除黑钻事件"""
    stmt = select(BlackDiamondEntity).where(
        BlackDiamondEntity.event_id == event_id
    )
    event = (await db.execute(stmt)).scalar_one_or_none()

    if not event:
        raise HTTPException(status_code=404, detail="事件不存在")

    event.is_active = False
    await db.commit()

    return {"status": "demoted", "event_id": event_id}


# ═══════════════════════════════════════════════════════════════
# 路由：记忆提炼
# ═══════════════════════════════════════════════════════════════

@router.post("/refine", response_model=RefineResponse)
async def trigger_refine(
    max_items: int = Form(5),
    db: AsyncSession = Depends(get_db),
):
    """手动触发记忆提炼（金库→黑钻库）"""
    if not refiner:
        raise HTTPException(status_code=503, detail="记忆提炼器未初始化")

    result = await refiner.consolidate_next_batch(db, max_items)
    return RefineResponse(**result)


# ═══════════════════════════════════════════════════════════════
# 路由：用户资料管理 (Docs API) — 面向用户界面
# 用户只看到"我的资料"，不感知三库底层。
# 所有操作同步响应（不走 Celery），保证掌控感。
# ═══════════════════════════════════════════════════════════════

_DOC_ROUTER_PREFIX = "/docs"


def _get_user_id(auth=Depends(verify_token)) -> str:
    """
    获取当前用户 ID。
    生产环境应从 JWT Token 解析。
    当前简化：通过 X-User-Id 请求头传递。
    """
    # TODO: 集成真实用户认证后，从 token 中解析 user_id
    return "default_user"


@router.get(f"{_DOC_ROUTER_PREFIX}/gold", response_model=DocListResponse)
async def list_gold_docs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    📚 获取当前用户的金库资料列表。

    用户看到的是"我的对话原声带"——
    每一条都是一段完整的对话记录，保留情感曲谱。
    """
    # 查询总数
    count_stmt = select(func.count(GoldVaultEntity.id)).where(
        GoldVaultEntity.user_id == user_id,
        GoldVaultEntity.is_deleted == False,
    )
    total = (await db.execute(count_stmt)).scalar() or 0

    # 查询分页
    offset = (page - 1) * page_size
    stmt = select(GoldVaultEntity).where(
        GoldVaultEntity.user_id == user_id,
        GoldVaultEntity.is_deleted == False,
    ).order_by(GoldVaultEntity.created_at.desc()).offset(offset).limit(page_size)

    rows = (await db.execute(stmt)).scalars().all()

    items = []
    for r in rows:
        emotion_summary = None
        if r.emotion_vector:
            try:
                avg_val = sum(r.emotion_vector[::2]) / max(len(r.emotion_vector[::2]), 1)
                emotion_summary = f"情感倾向: {avg_val:.2f}"
            except (ZeroDivisionError, IndexError):
                pass

        items.append(GoldDocSummary(
            id=r.id, topic=r.topic,
            tags=r.tags or [],
            emotion_summary=emotion_summary,
            created_at=r.created_at.isoformat() if r.created_at else "",
            is_refined=r.is_refined,
            vad_pending=r.vad_pending if hasattr(r, 'vad_pending') else False,
        ))

    return DocListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get(f"{_DOC_ROUTER_PREFIX}/gold/{{doc_id}}", response_model=GoldDocDetail)
async def get_gold_doc(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    📖 查看某条金库资料的完整原文和情感曲谱。
    用户在界面上点击一条资料时调用，展示完整内容。
    """
    stmt = select(GoldVaultEntity).where(
        GoldVaultEntity.id == doc_id,
        GoldVaultEntity.user_id == user_id,
        GoldVaultEntity.is_deleted == False,
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="资料不存在")

    return GoldDocDetail(
        id=doc.id, topic=doc.topic,
        raw_dialogue=doc.raw_dialogue or [],
        emotion_vector=doc.emotion_vector,
        vad_spectrum=doc.vad_spectrum if hasattr(doc, 'vad_spectrum') else None,
        vad_pending=doc.vad_pending if hasattr(doc, 'vad_pending') else False,
        tags=doc.tags or [],
        is_refined=doc.is_refined,
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
    )


@router.get(f"{_DOC_ROUTER_PREFIX}/diamonds", response_model=DocListResponse)
async def list_diamond_docs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    💎 获取当前用户的黑钻库摘要列表。

    用户看到的是"我的精选记忆"——
    每一条都是经过提炼的核心事件 + 情感曲谱。
    """
    count_stmt = select(func.count(BlackDiamondEntity.id)).where(
        BlackDiamondEntity.user_id == user_id,
        BlackDiamondEntity.is_deleted == False,
    )
    total = (await db.execute(count_stmt)).scalar() or 0

    offset = (page - 1) * page_size
    stmt = select(BlackDiamondEntity).where(
        BlackDiamondEntity.user_id == user_id,
        BlackDiamondEntity.is_deleted == False,
    ).order_by(BlackDiamondEntity.created_at.desc()).offset(offset).limit(page_size)

    rows = (await db.execute(stmt)).scalars().all()

    items = []
    for r in rows:
        es = r.emotional_spectrum or {}
        if isinstance(es, str):
            try:
                es = json.loads(es)
            except (json.JSONDecodeError, TypeError):
                es = {}

        items.append(DiamondDocSummary(
            id=r.id, event_id=r.event_id,
            event_type=r.event_type,
            core_facts=r.core_facts[:200] if r.core_facts else "",
            dominant_emotion=es.get("dominant_emotion", ""),
            tags=r.tags or [],
            decay_days=r.decay_days or 0,
            is_active=r.is_active,
            created_at=r.created_at.isoformat() if r.created_at else "",
        ))

    return DocListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get(f"{_DOC_ROUTER_PREFIX}/diamonds/{{doc_id}}", response_model=DiamondDocDetail)
async def get_diamond_doc(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    💎 查看某条黑钻资料的详细总结。
    包含完整的情感曲线和决策列表。
    """
    stmt = select(BlackDiamondEntity).where(
        BlackDiamondEntity.id == doc_id,
        BlackDiamondEntity.user_id == user_id,
        BlackDiamondEntity.is_deleted == False,
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="资料不存在")

    es = doc.emotional_spectrum or {}
    if isinstance(es, str):
        try:
            es = json.loads(es)
        except (json.JSONDecodeError, TypeError):
            es = {}

    return DiamondDocDetail(
        id=doc.id, event_id=doc.event_id,
        event_type=doc.event_type,
        occurred_at=doc.occurred_at.isoformat() if doc.occurred_at else "",
        core_facts=doc.core_facts,
        decisions=doc.decisions or [],
        emotional_spectrum=es,
        gold_references=doc.gold_references or [],
        decay_days=doc.decay_days or 0,
        is_active=doc.is_active,
        tags=doc.tags or [],
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
    )


@router.post(f"{_DOC_ROUTER_PREFIX}/upload", response_model=IngestResponse)
async def upload_doc(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    📤 用户上传原始资料。

    上传的文件进入砂金库，自动触发后台 IQC 质检。
    用户立即收到入库结果，后续加工异步完成。
    """
    content = await file.read()
    file_size = len(content)

    if file_size == 0:
        raise HTTPException(status_code=400, detail="空文件")

    import hashlib
    import secrets
    file_hash = hashlib.sha256(content).hexdigest()

    # 写入砂金库（带 user_id）
    sand_id = f"sd_{secrets.token_hex(8)}"
    now = datetime.now(timezone.utc).isoformat()
    record = AlluvialRecord(
        id=sand_id,
        file_path=file.filename or "unknown",
        file_hash=file_hash,
        file_size=file_size,
        status="qc_pending",
        source_name=file.filename or "unknown",
        user_id=user_id,
    )
    db.add(record)
    await db.flush()

    # 排入 IQC 队列
    iqc_item = IQCQueueRecord(
        alluvial_id=record.id,
        status="pending",
    )
    db.add(iqc_item)

    await db.commit()

    logger.info(f"用户上传: {record.id} file={file.filename} user={user_id}")
    _audit("doc_upload", {"file": file.filename, "sand_id": record.id}, user_id)
    return IngestResponse(
        id=record.id, status="qc_pending",
        file_hash=file_hash,
        message="上传成功，已进入加工队列",
    )


@router.put(f"{_DOC_ROUTER_PREFIX}/diamonds/{{doc_id}}", response_model=DiamondDocDetail)
async def update_diamond_doc(
    doc_id: str,
    req: UpdateDiamondRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    ✏️ 用户手动修改黑钻资料的总结内容。

    系统同步更新数据库，用户立即看到修改结果。
    修改内容不影响原始金库原声带。
    """
    stmt = select(BlackDiamondEntity).where(
        BlackDiamondEntity.id == doc_id,
        BlackDiamondEntity.user_id == user_id,
        BlackDiamondEntity.is_deleted == False,
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="资料不存在")

    # 更新非空字段
    if req.core_facts is not None:
        doc.core_facts = req.core_facts
    if req.decisions is not None:
        doc.decisions = req.decisions
    if req.emotional_spectrum is not None:
        doc.emotional_spectrum = req.emotional_spectrum
    if req.tags is not None:
        doc.tags = req.tags

    doc.updated_at = datetime.now(timezone.utc)
    await db.commit()

    _audit("doc_update", {"doc_id": doc_id, "vault": "diamond"}, user_id)

    es = doc.emotional_spectrum or {}
    if isinstance(es, str):
        try:
            es = json.loads(es)
        except (json.JSONDecodeError, TypeError):
            es = {}

    return DiamondDocDetail(
        id=doc.id, event_id=doc.event_id,
        event_type=doc.event_type,
        occurred_at=doc.occurred_at.isoformat() if doc.occurred_at else "",
        core_facts=doc.core_facts,
        decisions=doc.decisions or [],
        emotional_spectrum=es,
        gold_references=doc.gold_references or [],
        decay_days=doc.decay_days or 0,
        is_active=doc.is_active,
        tags=doc.tags or [],
        created_at=doc.created_at.isoformat() if doc.created_at else "",
        updated_at=doc.updated_at.isoformat() if doc.updated_at else "",
    )


@router.delete(f"{_DOC_ROUTER_PREFIX}/gold/{{doc_id}}", response_model=DeleteResponse)
async def delete_gold_doc(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    🗑️ 用户删除金库资料（软删除）。

    前端不再展示，后台保留用于审计或恢复。
    同步操作，即时响应。
    """
    stmt = select(GoldVaultEntity).where(
        GoldVaultEntity.id == doc_id,
        GoldVaultEntity.user_id == user_id,
        GoldVaultEntity.is_deleted == False,
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="资料不存在")

    doc.is_deleted = True
    await db.commit()

    logger.info(f"用户删除金库: {doc_id} user={user_id}")
    return DeleteResponse(status="deleted", id=doc_id, message="已删除（可恢复）")


@router.delete(f"{_DOC_ROUTER_PREFIX}/diamonds/{{doc_id}}", response_model=DeleteResponse)
async def delete_diamond_doc(
    doc_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    🗑️ 用户删除黑钻资料（软删除）。

    同时停止该事件的衰减计算。
    同步操作，即时响应。
    """
    stmt = select(BlackDiamondEntity).where(
        BlackDiamondEntity.id == doc_id,
        BlackDiamondEntity.user_id == user_id,
        BlackDiamondEntity.is_deleted == False,
    )
    doc = (await db.execute(stmt)).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="资料不存在")

    doc.is_deleted = True
    await db.commit()

    logger.info(f"用户删除黑钻: {doc_id} user={user_id}")
    _audit("doc_delete", {"doc_id": doc_id, "vault": "diamond"}, user_id)
    return DeleteResponse(status="deleted", id=doc_id, message="已删除（已停止衰减计算）")


# ═══════════════════════════════════════════════════════════════
# 路由：测试专用（仅调试模式可用）
# ═══════════════════════════════════════════════════════════════

@router.post("/ingest-test")
async def ingest_test(
    body: dict,
    db: AsyncSession = Depends(get_db),
):
    """
    🧪 测试专用：直接将对话注入金库（绕过砂金→IQC）。
    仅开发调试模式可用。
    """
    import time as _time
    from app.domain.models import GoldVaultEntity

    topic = body.get("topic", "测试话题")
    raw_dialogue_raw = body.get("raw_dialogue", "[]")
    emotion_vec = body.get("emotion_vector")
    tags = body.get("tags", ["待提炼"])
    user_id = body.get("user_id", "test_user")
    vad_spectrum = body.get("vad_spectrum")

    # 处理 raw_dialogue
    if isinstance(raw_dialogue_raw, str):
        try:
            raw_dialogue = json.loads(raw_dialogue_raw)
        except:
            raw_dialogue = [{"role": "system", "content": raw_dialogue_raw}]
    else:
        raw_dialogue = raw_dialogue_raw

    # 创建金库记录（歌词+曲谱一体存储）
    # 注意: vad_spectrum 和 vad_pending 用 SQL 直写（SQLAlchemy ORM 不认 ALTER TABLE 后加列）
    gold = GoldVaultEntity(
        topic=topic,
        raw_dialogue=raw_dialogue,
        emotion_vector=emotion_vec,
        tags=tags,
        is_refined=False,
        user_id=user_id,
    )
    db.add(gold)
    await db.flush()

    # 用 raw SQL 写入 vad_spectrum/vad_pending
    from sqlalchemy import text as sa_text
    import json as _json
    logger.info(f"[VAD] 收到 vad_spectrum={type(vad_spectrum).__name__} topic={topic[:20]}")
    try:
        if vad_spectrum is not None:
            vs_json = _json.dumps(vad_spectrum, ensure_ascii=False)
            sql = sa_text(f"UPDATE gold_dialogues SET vad_spectrum = '{vs_json}'::jsonb, vad_pending = false WHERE id = '{gold.id}'")
            logger.info(f"[VAD] SQL: UPDATE gold_dialogues SET vad_spectrum=... vad_pending=false WHERE id={gold.id[:12]}...")
            await db.execute(sql)
        else:
            await db.execute(
                sa_text(f"UPDATE gold_dialogues SET vad_pending = true WHERE id = '{gold.id}'")
            )
    except Exception as e:
        logger.error(f"[VAD] 写入异常: {e}")
        import traceback
        logger.error(traceback.format_exc())
    await db.commit()

    # 如果有 emotion_vector 且 Qdrant 可用，写入向量库
    if emotion_vec and vector_store and vector_store.available:
        vector_store.upsert_vector(
            point_id=gold.id,
            vector=emotion_vec,
            payload={
                "topic": topic,
                "user_id": user_id,
            },
        )
        gold.vector_id = gold.id
        await db.merge(gold)
        await db.commit()

    logger.info(f"[TEST] 注入金库: {gold.id} topic={topic}")
    return {"id": gold.id, "topic": topic, "status": "injected"}


# ═══════════════════════════════════════════════════════════════
# 路由：安全与维护 (Security)
# 只有景幻仙姑（管理员）可以访问
# ═══════════════════════════════════════════════════════════════

@router.get("/security/status")
async def security_status():
    """🔒 安全状态总览"""
    result = {
        "fortress": None,
        "integrity": None,
        "audit": None,
    }

    # 堡垒检查
    if _fortress:
        result["fortress"] = _fortress.report()
    else:
        result["fortress"] = {"error": "未加载"}

    # 完整性校验
    try:
        from app.security.integrity import IntegrityShield
        shield = IntegrityShield()
        integrity = shield.verify_startup()
        result["integrity"] = {
            "passed": integrity["passed"],
            "file_count": integrity["file_count"],
            "violations": integrity["violations"],
        }
    except Exception as e:
        result["integrity"] = {"error": str(e)}

    # 审计金库状态
    if _audit_vault:
        chain = _audit_vault.verify_chain()
        result["audit"] = {
            "records": chain["records"],
            "chain_valid": chain["valid"],
        }
    else:
        result["audit"] = {"error": "未加载"}

    return result


@router.get("/security/audit")
async def get_audit_logs(
    action: str = Query(None, description="按操作类型筛选"),
    user_id: str = Query(None, description="按用户筛选"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """📋 查看审计日志（需管理员权限）"""
    if not _audit_vault:
        raise HTTPException(status_code=503, detail="审计金库未加载")

    rows = _audit_vault.query(
        user_id=user_id, action=action,
        limit=limit, offset=offset,
    )
    return {"total": len(rows), "records": rows}


@router.get("/security/audit/verify")
async def verify_audit_chain():
    """🔗 验证审计哈希链完整性"""
    if not _audit_vault:
        raise HTTPException(status_code=503, detail="审计金库未加载")

    result = _audit_vault.verify_chain()
    return result


@router.post("/security/manifest/generate")
async def generate_manifest():
    """📝 生成/更新代码完整性 MANIFEST"""
    try:
        from app.security.integrity import IntegrityShield
        shield = IntegrityShield()
        path = shield.generate_manifest()
        _audit("manifest_generate", {"path": path})
        return {"status": "ok", "path": path, "message": "MANIFEST 已生成"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/security/backup")
async def trigger_backup():
    """💾 手动触发全量备份"""
    try:
        from app.core.backup import BackupManager
        backup = BackupManager()
        result = backup.run_full_backup()
        _audit("backup_manual", {"tag": result["tag"]})
        return {"status": "ok", **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/security/backups")
async def list_backups():
    """列出所有备份"""
    try:
        from app.core.backup import BackupManager
        backup = BackupManager()
        backups = backup.list_backups()
        return {"backups": backups}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ═══════════════════════════════════════════════════════════════
# 路由：景幻仙姑管理员对话 (Admin Chat)
# ═══════════════════════════════════════════════════════════════

_admin_assistant = None


def _set_admin_assistant(assistant):
    global _admin_assistant
    _admin_assistant = assistant


@router.post("/admin/chat")
async def admin_chat(
    body: dict,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(_get_user_id),
):
    """
    与景幻仙姑对话。

    Body: {"message": "你好，介绍一下这个系统"}
    """
    if not _admin_assistant:
        raise HTTPException(status_code=503, detail="景幻仙姑助理未初始化")

    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="消息不能为空")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="消息太长")

    try:
        result = await _admin_assistant.chat_async(message, user_id, db)
        _audit("admin_chat", {"msg": message[:80]}, user_id)
        return result
    except Exception as e:
        logger.error(f"景幻对话失败: {e}")
        return {"reply": f"对话处理异常", "actions": [], "proposal": None, "history_length": 0}


@router.get("/admin/proposals")
async def list_admin_proposals(
    status: str = Query(None, description="filter: pending_review/approved/rejected"),
):
    """列出改善建议"""
    if not _admin_assistant:
        raise HTTPException(status_code=503, detail="未初始化")
    props = _admin_assistant.get_proposals(status)
    return {"total": len(props), "proposals": props}


@router.get("/admin/conversation")
async def get_admin_conversation():
    """获取当前对话历史"""
    if not _admin_assistant:
        raise HTTPException(status_code=503, detail="未初始化")
    return {"messages": _admin_assistant.conversation[-20:], "total": len(_admin_assistant.conversation)}


@router.post("/admin/reset")
async def reset_admin_conversation():
    """重置对话"""
    global _admin_assistant
    if _admin_assistant:
        _admin_assistant.conversation = []
    return {"status": "ok", "message": "对话已重置"}
