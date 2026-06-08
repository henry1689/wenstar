"""
景幻仙姑 · 生物智脑 — REST API 路由
调用者视角：上传 → 搜索 → 获取结果。
完全无感内部三库/IQC/星云等逻辑。
"""
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Depends
from core.schemas import UploadRequest, UploadResponse, SearchRequest, DocumentResponse, HealthResponse
from core.database import Database
from vaults.alluvial import AlluvialVault
from vaults.gold import GoldVault
from vaults.black_diamond import BlackDiamondVault
from engines.iqc import IQCEngine
from engines.dream_mode import DreamModeScheduler
from engines.retriever import RetrieverEngine
from engines.tagger import TaggerEngine

router = APIRouter()


def get_deps(request):
    """依赖注入 — 由 main.py 在启动时设置"""
    return request.app.state


# ── 上传 ──

@router.post("/upload", response_model=UploadResponse, summary="上传文档到景幻仙姑")
async def upload_document(
    title: str = Form(...),
    file: UploadFile = None,
    content: str = Form(None),
    source_name: str = Form(None),
    skip_iqc: bool = Form(False),
    deps=Depends(get_deps),
):
    """上传文档。异步处理：立即返回，IQC 在景幻的做梦模式中执行。"""
    alluvial: AlluvialVault = deps["alluvial"]
    dream: DreamModeScheduler = deps["dream"]

    # 读取文件内容
    if file and file.filename:
        file_bytes = await file.read()
        content_str = content or ""
        mime_type = file.content_type or "text/plain"
        src_name = source_name or file.filename
    elif content:
        file_bytes = content.encode("utf-8")
        content_str = content
        mime_type = "text/plain"
        src_name = source_name or title
    else:
        raise HTTPException(400, "需要文件或内容")

    req = UploadRequest(
        title=title,
        content=content_str,
        source_name=src_name,
        mime_type=mime_type,
        skip_iqc=skip_iqc,
    )

    result = await alluvial.deposit(req, file_bytes)

    # 通知做梦模式（如果有积压）
    dream.record_activity()

    return result


# ── 搜索 ──

@router.post("/search", summary="搜索知识（调用者无感内部三库）")
async def search(req: SearchRequest, deps=Depends(get_deps)):
    """按优先级检索：黑钻库高速 → 金库标准 → 降级 LIKE"""
    retriever: RetrieverEngine = deps["retriever"]
    result = await retriever.search(req.keyword, req.limit)
    return result


@router.post("/hybrid-search", summary="混合搜索（向量 + 关键词）")
async def hybrid_search(req: SearchRequest, deps=Depends(get_deps)):
    """带向量语义的混合搜索"""
    retriever: RetrieverEngine = deps["retriever"]
    result = await retriever.hybrid_search(req.keyword, req.limit)
    return result


# ── 获取文档 ──

@router.get("/documents/{doc_id}", response_model=DocumentResponse)
async def get_document(doc_id: str, deps=Depends(get_deps)):
    gold: GoldVault = deps["gold"]
    doc = await gold.get_by_id(doc_id)
    if not doc:
        raise HTTPException(404, "文档不存在")
    return doc


# ── 健康检查 ──

@router.get("/health", response_model=HealthResponse)
async def health(deps=Depends(get_deps)):
    db: Database = deps["db"]
    dream: DreamModeScheduler = deps["dream"]
    bd: BlackDiamondVault = deps["bd"]

    manifest = await db.verify_manifest()
    iqc_pending = await db.fetch_val(
        "SELECT COUNT(*) FROM documents WHERE status='qc_pending'"
    )

    counts = {}
    for v in ["alluvial", "gold", "black_diamond"]:
        counts[v] = await db.fetch_val(
            "SELECT COUNT(*) FROM documents WHERE vault=?", (v,)
        )

    return HealthResponse(
        status="ok",
        documents=manifest["documents"],
        iqc_pending=iqc_pending or 0,
        vaults=counts,
    )


# ── 做梦模式状态 ──

@router.get("/dream/status")
async def dream_status(deps=Depends(get_deps)):
    dream: DreamModeScheduler = deps["dream"]
    bd: BlackDiamondVault = deps["bd"]
    return {
        "dream_mode": dream.get_status(),
        "black_diamond_count": await bd.get_active_count(),
    }


# ── 黑钻库评估 ──

@router.get("/black-diamond/candidates")
async def bd_candidates(deps=Depends(get_deps)):
    bd: BlackDiamondVault = deps["bd"]
    return {"candidates": await bd.evaluate_candidates()}


# ── 手动触发做梦 ──

@router.post("/dream/trigger")
async def trigger_dream(deps=Depends(get_deps)):
    dream: DreamModeScheduler = deps["dream"]
    iqc: IQCEngine = deps["iqc"]
    gold: GoldVault = deps["gold"]
    bd: BlackDiamondVault = deps["bd"]
    results = {}
    results["iqc"] = await iqc.process_queue(20)
    await gold.build_vector_index()
    results["bd_candidates"] = await bd.evaluate_candidates()
    return {"dream_triggered": True, "results": results}


# ── 总结 ──

@router.post("/summarize", summary="跨文档总结")
async def summarize(keyword: str = "", limit: int = 5, deps=Depends(get_deps)):
    """
    跨文档总结：搜到相关文档 → LLM 总结 → 返回摘要
    注意：实际 LLM 调用需要在 WenStar 侧完成，
    此端点返回文档内容供 WenStar 的 LLM 做总结。
    """
    retriever: RetrieverEngine = deps["retriever"]
    result = await retriever.search(keyword, limit)
    return result
