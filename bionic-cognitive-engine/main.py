"""
仿生智脑 v1.0 · 入口 (FastAPI Application)

启动方式:
  # 开发模式（本地调试）：
  uvicorn main:app --reload --port 7200

  # 生产模式：
  uvicorn main:app --host 0.0.0.0 --port 7200 --workers 4

  # Docker（推荐）：
  docker compose up -d
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.api.deps import db_manager
from app.api.routes import router as api_router, init_services
from app.infrastructure.vector_store import VectorStore
from app.infrastructure.llm_client import LLMClient
from app.core.refiner import MemoryConsolidator
from app.core.retrieval import HybridSearchService

# ── 日志配置 ──
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("bionic")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理——启动时初始化基础设施"""
    logger.info("═" * 50)
    logger.info("仿生智脑 (Bionic Cognitive Engine) v1.0 启动")
    logger.info("景幻仙姑 — 仿生智脑的掌管者、大英图书馆馆长")
    logger.info("═" * 50)

    # ── 初始化数据库 ──
    try:
        await db_manager.initialize()
        logger.info("[OK] 数据库已连接")
    except Exception as e:
        logger.warning(f"[WARN] 数据库连接失败: {e}")

    # ── 初始化 Qdrant ──
    vs = VectorStore()
    vs_ok = vs.initialize()
    if vs_ok:
        logger.info("[OK] Qdrant 向量存储已就绪")
    else:
        logger.warning("[WARN] Qdrant 未就绪，检索将降级为纯文本")

    # ── 初始化业务服务 ──
    llm = LLMClient()
    consolidator = MemoryConsolidator(llm, vs)
    searcher = HybridSearchService(vs)

    # 注入到 API 路由
    init_services(vs, consolidator, searcher)
    logger.info("[OK] 业务服务已就绪")

    yield  # ← 应用在此运行

    # ── 关闭 ──
    await db_manager.close()
    logger.info("仿生智脑已关闭。景幻仙姑回归虚无。")


# ═══════════════════════════════════════════════════════════════
# FastAPI 应用
# ═══════════════════════════════════════════════════════════════

app = FastAPI(
    title="仿生智脑 (Bionic Cognitive Engine)",
    description="景幻仙姑的大英图书馆——三库流转的知识引擎",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS（允许玉瑶跨域调用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 注册路由 ──
app.include_router(api_router)


# ── 根路径 ──
@app.get("/")
async def root():
    return {
        "service": "仿生智脑 (Bionic Cognitive Engine)",
        "version": "1.0.0",
        "keeper": "景幻仙姑",
        "api": "/api/v1/health",
    }
