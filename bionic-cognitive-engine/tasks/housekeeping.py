"""
仿生智脑 · 半衰期维护异步任务 (Celery)

每天凌晨执行：
  1. 检查黑钻库所有事件的有效天数
  2. 降级超过 30 天未调用的（is_active=False）
  3. 归档超过 90 天未调用的
  4. IQC 队列重试（处理三次失败的）
"""
import asyncio
import logging

from tasks.celery_app import celery_app
from app.infrastructure.database import DatabaseManager
from app.core.decay_scheduler import DecayManager

logger = logging.getLogger("bionic.tasks.housekeeping")


@celery_app.task(bind=True, soft_time_limit=600)
def run_housekeeping(self):
    """
    执行每日维护任务。

    由 Celery Beat 每天凌晨 2:00 触发。
    """
    try:
        result = _run_async_housekeeping()
        logger.info(
            f"日常维护完成: "
            f"检查{result.get('checked', 0)}条, "
            f"降级{result.get('demoted', 0)}条, "
            f"归档{result.get('archived', 0)}条"
        )
        return result

    except Exception as exc:
        logger.error(f"日常维护失败: {exc}")
        return {"error": str(exc)}


@celery_app.task(bind=True, soft_time_limit=120)
def retry_failed_iqc(self):
    """重试失败的 IQC 质检条目"""
    try:
        result = _run_async_iqc_retry()
        logger.info(f"IQC 重试完成: {result}")
        return result
    except Exception as exc:
        logger.error(f"IQC 重试失败: {exc}")
        return {"error": str(exc)}


def _run_async_housekeeping() -> dict:
    """同步包装器"""
    async def _run():
        db_mgr = DatabaseManager()
        await db_mgr.initialize()
        db = await db_mgr.get_session()

        try:
            manager = DecayManager()
            result = await manager.run_daily_check(db)
            return result
        finally:
            await db.close()
            await db_mgr.close()

    return asyncio.run(_run())


def _run_async_iqc_retry() -> dict:
    """同步包装器：重试失败的 IQC"""
    async def _run():
        db_mgr = DatabaseManager()
        await db_mgr.initialize()
        db = await db_mgr.get_session()

        try:
            from sqlalchemy import select, update
            from app.domain.models import IQCQueueRecord

            # 查询失败且重试次数 < 3 的记录
            stmt = select(IQCQueueRecord).where(
                IQCQueueRecord.status == "failed",
                IQCQueueRecord.retry_count < 3,
            )
            failed_items = (await db.execute(stmt)).scalars().all()

            for item in failed_items:
                item.retry_count += 1
                item.status = "pending"
                item.error_message = None

            await db.commit()
            return {"retried": len(failed_items)}

        finally:
            await db.close()
            await db_mgr.close()

    return asyncio.run(_run())
