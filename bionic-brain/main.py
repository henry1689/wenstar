#!/usr/bin/env python3
"""
景幻仙姑 · 生物智脑 (Bionic Cognitive Engine)
太虚境底层知识管理微服务 —— 完全独立、可调试、高可靠。

调用者（玉瑶/WenStar）只看到：Input → Output。
景幻仙姑在后台管理三库流转、IQC质检、做梦模式、黑钻晋升。

端口：7200（不与 WenStar 3000/3002 冲突）
运行：python main.py
"""
import time
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from core.database import Database
from core.config import HOST, PORT
from vaults.alluvial import AlluvialVault
from vaults.gold import GoldVault
from vaults.black_diamond import BlackDiamondVault
from engines.iqc import IQCEngine
from engines.dream_mode import DreamModeScheduler
from engines.retriever import RetrieverEngine
from engines.tagger import TaggerEngine
from api.routes import router

START_TIME = time.time()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """景幻仙姑生命周期管理"""
    print(f"""
╔══════════════════════════════════════════════╗
║                                              ║
║    景幻仙姑 · 生物智脑                        ║
║    TaiXu Bionic Cognitive Engine             ║
║                                              ║
║    砂金库 → IQC → 金库 → 黑钻IQC → 黑钻库   ║
║                                              ║
║    调用者不知其存在。                           ║
║    用户只知道玉瑶。                            ║
║                                              ║
╚══════════════════════════════════════════════╝
    """)

    # ── 初始化基础设施 ──
    db = Database()
    await db.initialize()
    print("[景幻] 数据库就绪")

    # ── 初始化金库 ──
    alluvial = AlluvialVault(db)
    gold = GoldVault(db)
    bd = BlackDiamondVault(db)
    tagger = TaggerEngine()
    iqc = IQCEngine(db, alluvial, tagger)
    retriever = RetrieverEngine(bd, gold, iqc)
    dream = DreamModeScheduler(iqc, gold, bd, db)

    # 注入到应用状态
    app.state.db = db
    app.state.alluvial = alluvial
    app.state.gold = gold
    app.state.bd = bd
    app.state.iqc = iqc
    app.state.retriever = retriever
    app.state.dream = dream
    app.state.tagger = tagger

    # ── 启动做梦模式 ──
    await dream.start()

    # 初始重建向量索引
    try:
        await gold.build_vector_index()
    except Exception as e:
        print(f"[景幻] 初始向量索引失败: {e}")

    yield

    # ── 关闭 ──
    await dream.stop()
    await db.close()
    print("[景幻] 已关闭")


app = FastAPI(
    title="景幻仙姑 · 生物智脑",
    description="太虚境底层知识管理微服务。调用者无感，景幻仙姑在后台管理三库流转。",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


@app.get("/")
async def root():
    return {
        "service": "景幻仙姑 · 生物智脑",
        "version": "1.0.0",
        "uptime": round(time.time() - START_TIME, 1),
        "docs": "/docs",
    }


# ── 记录活动中间件（通知做梦模式有用户操作）──

@app.middleware("http")
async def record_activity(request: Request, call_next):
    if hasattr(request.app.state, "dream"):
        request.app.state.dream.record_activity()
    response = await call_next(request)
    return response


if __name__ == "__main__":
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
