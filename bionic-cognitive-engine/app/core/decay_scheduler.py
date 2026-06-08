"""
仿生智脑 · 半衰期衰减调度器 (Decay Manager)

建模三部曲·第二步：
  赋予系统"遗忘"的能力。

规则（源自蓝图）：
  - 30天未调用 → 降级金库（is_active=False，不参与检索）
  - 90天未调用 → 归档砂金库（标记 archived）
  - 每次检索命中时自动更新 last_accessed_at

"用户越用→黑钻库越精准→响应越快→玉瑶越懂用户。
 这是一个活的、会生长的系统。"
"""
import logging
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import BlackDiamondEntity, AlluvialRecord
from app.core.config import settings

logger = logging.getLogger("bionic.decay")


class DecayManager:
    """
    黑钻库半衰期管理器。

    用法:
        manager = DecayManager()
        result = await manager.run_daily_check(db)
    """

    def __init__(
        self,
        demote_days: int = settings.DECAY_DEMOTE_DAYS,
        archive_days: int = settings.DECAY_ARCHIVE_DAYS,
    ):
        self.demote_days = demote_days
        self.archive_days = archive_days

    async def run_daily_check(self, db: AsyncSession) -> dict:
        """
    执行每日半衰期检查。

    Returns:
        {"checked": N, "demoted": N, "archived": N, "errors": [...]}
    """
        now = datetime.now(timezone.utc)
        result = {"checked": 0, "demoted": 0, "archived": 0, "errors": []}

        # 查询所有活跃的黑钻事件
        stmt = select(BlackDiamondEntity).where(
            BlackDiamondEntity.is_active == True,
            BlackDiamondEntity.is_deleted == False,
        )
        rows = (await db.execute(stmt)).scalars().all()

        for event in rows:
            try:
                result["checked"] += 1
                # 计算已存在天数
                created = event.created_at
                if not created:
                    continue

                days = (now - created).days
                last_access = event.last_accessed_at or created

                # 实际有效天数 = 最后访问到现在的天数
                effective_days = (now - last_access).days

                # 更新 decay_days
                event.decay_days = max(days, 0)

                if effective_days >= self.archive_days:
                    # 归档到砂金库
                    event.is_active = False
                    event.tags = list(event.tags or []) + ["archived"]
                    logger.info(
                        f"黑钻归档: {event.event_id} "
                        f"({effective_days}d 未调用)"
                    )
                    result["archived"] += 1

                elif effective_days >= self.demote_days:
                    # 降级（移出高速检索）
                    event.is_active = False
                    event.tags = list(event.tags or []) + ["demoted"]
                    logger.info(
                        f"黑钻降级: {event.event_id} "
                        f"({effective_days}d 未调用)"
                    )
                    result["demoted"] += 1

            except Exception as e:
                result["errors"].append(f"{event.event_id}: {e}")
                logger.error(f"半衰期检查失败 {event.event_id}: {e}")

        if result["checked"] > 0:
            await db.commit()
            logger.info(
                f"半衰期检查完成: 检查{result['checked']}条, "
                f"降级{result['demoted']}条, 归档{result['archived']}条"
            )

        return result

    async def promote_back(self, db: AsyncSession, event_id: str) -> bool:
        """
        手动恢复降级的黑钻事件（用户再次访问时触发）。

        如果用户搜索命中了一个降级事件，自动恢复其活跃状态。
        """
        stmt = select(BlackDiamondEntity).where(
            BlackDiamondEntity.event_id == event_id
        )
        event = (await db.execute(stmt)).scalar_one_or_none()

        if not event:
            return False

        event.is_active = True
        event.last_accessed_at = datetime.now(timezone.utc)
        event.decay_days = 0

        # 移除降级/归档标签
        if event.tags:
            event.tags = [
                t for t in event.tags
                if t not in ("demoted", "archived")
            ]

        await db.commit()
        logger.info(f"黑钻恢复活跃: {event_id}")
        return True
