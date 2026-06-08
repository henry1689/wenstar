"""
仿生智脑 · 记忆提炼异步任务 (Celery)

做梦模式的核心引擎——金库→黑钻库的异步提炼。

触发方式：
  - Celery Beat 定时触发（每小时）
  - 手动 API 触发（POST /api/v1/refine）
  - 积压自动触发（未提炼 > 5 条时）
"""
import asyncio
import logging

from tasks.celery_app import celery_app
from app.infrastructure.database import DatabaseManager
from app.infrastructure.llm_client import LLMClient
from app.infrastructure.vector_store import VectorStore
from app.core.refiner import MemoryConsolidator

logger = logging.getLogger("bionic.tasks.consolidate")


@celery_app.task(bind=True, max_retries=3, soft_time_limit=300)
def consolidate_memory(self, gold_id: str):
    """
    提炼单条金库记录为黑钻事件。

    Args:
        gold_id: GoldVaultEntity 的 UUID

    由 Celery Worker 异步执行。
    重试机制：最多 3 次，指数退避 60s * (2 ^ retry)
    """
    try:
        result = _run_async_consolidate(gold_id)
        if result:
            logger.info(f"记忆提炼完成: gold={gold_id}")
        else:
            logger.warning(f"记忆提炼返回空: gold={gold_id}")
        return result

    except Exception as exc:
        logger.error(f"记忆提炼失败 gold={gold_id}: {exc}")
        raise self.retry(exc=exc, countdown=60 * (2 ** self.request.retries))


@celery_app.task(bind=True, soft_time_limit=300)
def consolidate_pending(self, max_items: int = 5):
    """
    处理一批待提炼的金库记录。

    Args:
        max_items: 单次最多处理条数

    由 Celery Beat 每小时触发一次。
    """
    try:
        result = _run_async_batch(max_items)
        logger.info(
            f"批量提炼完成: "
            f"处理{result.get('processed', 0)}条, "
            f"晋升{result.get('promoted', 0)}条"
        )
        return result

    except Exception as exc:
        logger.error(f"批量提炼失败: {exc}")
        return {"error": str(exc), "processed": 0, "promoted": 0}


def _run_async_consolidate(gold_id: str) -> dict:
    """同步包装器：在 Celery Worker 中运行异步代码"""
    async def _run():
        db_mgr = DatabaseManager()
        await db_mgr.initialize()
        db = await db_mgr.get_session()

        try:
            llm = LLMClient()
            vs = VectorStore()
            vs.initialize()
            consolidator = MemoryConsolidator(llm, vs)

            # 直接提炼单条
            from sqlalchemy import select
            from app.domain.models import GoldVaultEntity

            stmt = select(GoldVaultEntity).where(GoldVaultEntity.id == gold_id)
            result = await db.execute(stmt)
            gold = result.scalar_one_or_none()

            if not gold:
                return {"error": "gold_id not found"}

            success = await consolidator._consolidate_one(db, gold)
            return {"success": success, "gold_id": gold_id}

        finally:
            await db.close()
            await db_mgr.close()

    return asyncio.run(_run())


def _run_async_batch(max_items: int) -> dict:
    """同步包装器：运行异步批量提炼"""
    async def _run():
        db_mgr = DatabaseManager()
        await db_mgr.initialize()
        db = await db_mgr.get_session()

        try:
            llm = LLMClient()
            vs = VectorStore()
            vs.initialize()
            consolidator = MemoryConsolidator(llm, vs)

            result = await consolidator.consolidate_next_batch(db, max_items)
            return result

        finally:
            await db.close()
            await db_mgr.close()

    return asyncio.run(_run())
