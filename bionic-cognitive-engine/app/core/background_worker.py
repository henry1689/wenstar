"""
仿生智脑 · 后台工作者 (Background Worker)

当 Celery Worker 未运行时，由 FastAPI  lifespan 启动的后台任务，
负责执行原本由 Celery 处理的异步操作：

  ① IQC 质检消费 — 砂金库 → 金库
  ② 记忆提炼 — 金库 → 黑钻库
  ③ 半衰期衰减 — 黑钻库降级/归档

设计原则：
  - 与 Celery 任务共享同一套业务逻辑（不重复造轮子）
  - 检测到 Celery 活跃时自动暂停（通过配置 CELERY_ENABLED）
  - 所有操作通过已初始化的服务实例完成（共享连接池）
  - 异常不崩溃：单次失败不影响后续调度
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from app.infrastructure.database import DatabaseManager
from app.core.iqc_engine import IQCEngine
from app.core.refiner import MemoryConsolidator
from app.core.decay_scheduler import DecayManager

logger = logging.getLogger("bionic.background")


class BackgroundWorker:
    """
    后台工作者 — 景幻仙姑的"自动管家"。

    在 Celery Worker 未启动时，接管 IQC/提炼/衰减等异步任务。
    通过 asyncio 定时器在 FastAPI 进程内运行。

    用法:
        worker = BackgroundWorker(db_manager, refiner, ...)
        await worker.start()   # 启动所有后台协程
        await worker.stop()    # 关闭所有后台协程
    """

    def __init__(
        self,
        db_manager: DatabaseManager,
        refiner: Optional[MemoryConsolidator] = None,
        celery_enabled: bool = False,
    ):
        self.db_manager = db_manager
        self.refiner = refiner
        self.celery_enabled = celery_enabled

        # 独立模块（各自管理自己的生命周期）
        self.iqc = IQCEngine()
        self.decay = DecayManager()

        # 后台协程句柄
        self._tasks: list[asyncio.Task] = []
        self._running = False
        self._stats = {
            "iqc_cycles": 0, "iqc_passed": 0, "iqc_failed": 0,
            "consolidate_cycles": 0, "consolidated": 0,
            "decay_cycles": 0, "decay_demoted": 0, "decay_archived": 0,
        }

    async def start(self):
        """启动所有后台协程"""
        if self._running:
            return
        self._running = True

        if self.celery_enabled:
            logger.info("[BK] Celery 已启用，后台工作者进入待命模式")
            return

        logger.info("[BK] 后台工作者启动 (IQC/提炼/衰减)")
        self._tasks = [
            asyncio.create_task(self._iqc_loop(), name="bg-iqc"),
            asyncio.create_task(self._consolidate_loop(), name="bg-consolidate"),
            asyncio.create_task(self._decay_loop(), name="bg-decay"),
        ]

    async def stop(self):
        """停止所有后台协程"""
        self._running = False
        for task in self._tasks:
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
            self._tasks.clear()
        logger.info("[BK] 后台工作者已停止")

    def get_stats(self) -> dict:
        """获取后台工作者统计"""
        return dict(self._stats)

    # ── ① IQC 质检循环（30秒间隔）──

    async def _with_db(self, callback):
        """通用数据库会话包装：获取会话 → 执行 → 关闭"""
        db = await self.db_manager.get_session()
        try:
            return await callback(db)
        finally:
            await db.close()

    async def _iqc_loop(self):
        """IQC 质检队列消费 —— 砂金库 → 金库"""
        while self._running:
            try:
                db = await self.db_manager.get_session()
                try:
                    result = await self.iqc.process_queue(db, max_items=10)
                    if result["checked"] > 0:
                        self._stats["iqc_cycles"] += 1
                        self._stats["iqc_passed"] += result["passed"]
                        self._stats["iqc_failed"] += result["failed"]
                        logger.info(
                            f"[BK-IQC] 处理{result['checked']}条: "
                            f"{result['passed']}通过/{result['failed']}失败"
                        )
                finally:
                    await db.close()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[BK-IQC] 异常: {e}")
            await asyncio.sleep(30)

    # ── ② 记忆提炼循环（5分钟间隔）──

    async def _consolidate_loop(self):
        """自动提炼 —— 金库 → 黑钻库"""
        await asyncio.sleep(60)
        while self._running:
            try:
                if self.refiner:
                    db = await self.db_manager.get_session()
                    try:
                        result = await self.refiner.consolidate_next_batch(db, max_items=5)
                        if result["processed"] > 0:
                            self._stats["consolidate_cycles"] += 1
                            self._stats["consolidated"] += result["promoted"]
                            logger.info(
                                f"[BK-REFINE] 处理{result['processed']}条: "
                                f"晋升{result['promoted']}条/失败{result['failed']}条"
                            )
                    finally:
                        await db.close()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[BK-REFINE] 异常: {e}")
            await asyncio.sleep(300)

    # ── ③ 半衰期衰减循环 ──

    async def _decay_loop(self):
        """半衰期检查 —— 黑钻库降级/归档"""
        await asyncio.sleep(120)
        while self._running:
            try:
                db = await self.db_manager.get_session()
                try:
                    result = await self.decay.run_daily_check(db)
                    if result["checked"] > 0:
                        self._stats["decay_cycles"] += 1
                        self._stats["decay_demoted"] += result["demoted"]
                        self._stats["decay_archived"] += result["archived"]
                        logger.info(
                            f"[BK-DECAY] 检查{result['checked']}条: "
                            f"降级{result['demoted']}条/归档{result['archived']}条"
                        )
                finally:
                    await db.close()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[BK-DECAY] 异常: {e}")
            await asyncio.sleep(1800)
