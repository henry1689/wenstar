"""
景幻仙姑 · 做梦模式调度器 (Dream Mode Scheduler)
后台守护进程。空闲时自动执行 IQC、标签、分类、晋升评估。
景幻仙姑在"睡觉"时处理白天积累的工作。
"""
import asyncio
import time
from datetime import datetime, timezone
from typing import Optional
from core.config import DREAM_IDLE_SECONDS, DREAM_QUEUE_THRESHOLD, DREAM_INTERVAL_SECONDS


class DreamModeScheduler:
    """做梦模式调度器 — 景幻仙姑的潜意识处理"""

    def __init__(self, iqc_engine, gold_vault, bd_vault, db):
        self.iqc = iqc_engine
        self.gold = gold_vault
        self.bd = bd_vault
        self.db = db
        self._last_activity = time.time()
        self._running = False
        self._dream_task: Optional[asyncio.Task] = None
        self._stats = {"dream_cycles": 0, "iqc_processed": 0, "bd_promoted": 0,
                       "bd_demoted": 0, "archived": 0, "errors": 0}

    def record_activity(self):
        """记录用户活动（外部调用）"""
        self._last_activity = time.time()

    @property
    def idle_seconds(self) -> float:
        return time.time() - self._last_activity

    async def start(self):
        """启动做梦模式守护进程"""
        if self._running:
            return
        self._running = True
        print("[景幻·梦] 做梦模式启动")
        self._dream_task = asyncio.create_task(self._dream_loop())

    async def stop(self):
        self._running = False
        if self._dream_task:
            self._dream_task.cancel()
            try:
                await self._dream_task
            except asyncio.CancelledError:
                pass
        print("[景幻·梦] 做梦模式停止")

    async def _dream_loop(self):
        """做梦主循环 — 空闲时自动触发"""
        while self._running:
            try:
                # 检查触发条件
                if self.idle_seconds >= DREAM_IDLE_SECONDS:
                    await self._dream_cycle()
                elif await self._queue_overflow():
                    print(f"[景幻·梦] 队列积压，提前入梦")
                    await self._dream_cycle()

                # 定时触发（即使不空闲也每小时检查一次）
                await asyncio.sleep(min(DREAM_INTERVAL_SECONDS, 30))
            except asyncio.CancelledError:
                break
            except Exception as e:
                self._stats["errors"] += 1
                print(f"[景幻·梦] 做梦异常: {e}")
                await asyncio.sleep(60)

    async def _dream_cycle(self):
        """一次完整的做梦周期"""
        if not self._running:
            return
        self._stats["dream_cycles"] += 1
        cycle_id = self._stats["dream_cycles"]
        print(f"[景幻·梦] 🌙 第 {cycle_id} 次入梦...")

        dream_start = time.time()

        # ── 任务 1：IQC 质检 ──
        try:
            iqc_result = await self.iqc.process_queue(max_items=10)
            self._stats["iqc_processed"] += iqc_result["passed"]
            if iqc_result["passed"] > 0:
                print(f"[景幻·梦]   ✅ IQC: {iqc_result['passed']} 条通过")
            if iqc_result["failed"] > 0:
                print(f"[景幻·梦]   ⛔ IQC: {iqc_result['failed']} 条不通过")
        except Exception as e:
            print(f"[景幻·梦]   ❌ IQC 失败: {e}")

        # ── 任务 2：重建向量索引 ──
        try:
            await self.gold.build_vector_index()
        except Exception as e:
            print(f"[景幻·梦]   ❌ 向量索引重建失败: {e}")

        # ── 任务 3：黑钻晋升评估 ──
        try:
            candidates = await self.bd.evaluate_candidates()
            promoted = 0
            for c in candidates:
                if c["promotable"]:
                    success = await self.bd.promote(c["id"])
                    if success:
                        promoted += 1
            if promoted > 0:
                self._stats["bd_promoted"] += promoted
                print(f"[景幻·梦]   💎 黑钻晋升: {promoted} 条")
        except Exception as e:
            print(f"[景幻·梦]   ❌ 黑钻评估失败: {e}")

        # ── 任务 4：不活跃降级（dry_run=False 时实际执行） ──
        try:
            demoted = await self.bd.demote_inactive(dry_run=True)
            if not demoted:
                demoted = await self.bd.demote_inactive(dry_run=False)
            if demoted:
                self._stats["bd_demoted"] += len(demoted)
                print(f"[景幻·梦]   📉 降级: {len(demoted)} 条回金库")
        except Exception as e:
            print(f"[景幻·梦]   ❌ 降级失败: {e}")

        # ── 任务 5：长期归档 ──
        try:
            archived = await self.bd.archive_stale(dry_run=True)
            if archived:
                # 第二次实际执行
                archived = await self.bd.archive_stale(dry_run=False)
                if archived:
                    self._stats["archived"] += len(archived)
                    print(f"[景幻·梦]   📦 归档: {len(archived)} 条回砂金库")
        except Exception as e:
            print(f"[景幻·梦]   ❌ 归档失败: {e}")

        # ── 梦境小结 ──
        elapsed = time.time() - dream_start
        print(f"[景幻·梦] ☀️ 第 {cycle_id} 次梦醒 ({elapsed:.1f}s)")

    async def _queue_overflow(self) -> bool:
        """检查 IQC 队列是否积压过多"""
        try:
            cursor = await self.db.conn.execute(
                "SELECT COUNT(*) as cnt FROM documents WHERE status='qc_pending'"
            )
            row = await cursor.fetchone()
            return row[0] >= DREAM_QUEUE_THRESHOLD
        except Exception:
            return False

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "idle_seconds": round(self.idle_seconds, 1),
            "dream_cycles": self._stats["dream_cycles"],
            "last_activity": datetime.fromtimestamp(self._last_activity, tz=timezone.utc).isoformat(),
        }
