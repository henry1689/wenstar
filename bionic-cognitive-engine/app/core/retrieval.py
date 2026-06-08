"""
仿生智脑 · 混合检索引擎 (Hybrid Retrieval Service)

建模三部曲·第二步：
  检索优先级链：Qdrant 向量 → PostgreSQL 全文检索 → ILIKE 降级。

设计原则：
  - 黑钻库（高速通讯公路）优先
  - 向量搜索失效 → 自动降级全文检索
  - 检索 < 200ms
  - 每次命中更新 last_accessed_at（影响半衰期）
"""
import logging
import time
from typing import List, Optional

from sqlalchemy import select, or_, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import (
    GoldVaultEntity, BlackDiamondEntity, SearchResult,
)
from app.infrastructure.vector_store import VectorStore

logger = logging.getLogger("bionic.retrieval")


class HybridSearchService:
    """
    混合检索引擎。

    用法:
        searcher = HybridSearchService(vector_store)
        result = await searcher.recall(db, "仿生智脑架构")
    """

    def __init__(self, vector_store: Optional[VectorStore] = None):
        self.vector_store = vector_store

    async def recall(
        self, db: AsyncSession, query: str, limit: int = 5
    ) -> SearchResult:
        """
        执行优先级检索链。

        1. 黑钻库向量检索（Qdrant 情感相似度）
        2. ↓ 未命中足够
           黑钻库 + 金库 PostgreSQL 全文检索
        3. ↓ 未命中足够
           ILIKE 模糊匹配降级
        4. ↓ 全部未命中
           返回空（触发懒加载标签）

        Args:
            db: 数据库会话
            query: 检索关键词
            limit: 最大返回条数

        Returns:
            SearchResult {query, source, results, latency_ms}
        """
        start = time.time()
        result = SearchResult(query=query)

        # ── 第一优先级：黑钻库向量检索 ──
        if self.vector_store and self.vector_store.available:
            # 模拟向量检索（实际场景这里会用 query 的 embedding）
            vector_hits = self.vector_store.search(
                vector=[0.5] * 24,  # placeholder: 需要 embedding 模型
                limit=limit,
                score_threshold=0.75,
            )
            if vector_hits:
                ids = [h["id"] for h in vector_hits]
                stmt = select(BlackDiamondEntity).where(
                    BlackDiamondEntity.id.in_(ids),
                    BlackDiamondEntity.is_active == True,
                    BlackDiamondEntity.is_deleted == False,
                )
                rows = (await db.execute(stmt)).scalars().all()

                if rows:
                    result.results = [self._diamond_to_dict(r) for r in rows]
                    result.source = "vector"
                    result.latency_ms = round((time.time() - start) * 1000)

                    # 更新访问时间
                    await self._touch_events(db, [r.id for r in rows])

                    return result

        # ── 第二优先级：PostgreSQL 全文检索 ──
        like_pattern = f"%{query}%"

        # 黑钻库优先
        bd_stmt = select(BlackDiamondEntity).where(
            BlackDiamondEntity.is_active == True,
            BlackDiamondEntity.is_deleted == False,
            or_(
                BlackDiamondEntity.core_facts.ilike(like_pattern),
                BlackDiamondEntity.event_type.ilike(like_pattern),
                func.jsonb_extract_path_text(BlackDiamondEntity.tags, "$").ilike(like_pattern),
            ),
        ).order_by(BlackDiamondEntity.decay_days.asc()).limit(limit)

        bd_rows = (await db.execute(bd_stmt)).scalars().all()

        if bd_rows:
            result.results = [self._diamond_to_dict(r) for r in bd_rows[:limit]]
            result.source = "fulltext"
            result.latency_ms = round((time.time() - start) * 1000)
            await self._touch_events(db, [r.id for r in bd_rows])
            return result

        # ── 第三优先级：金库 ILIKE 降级 ──
        gold_stmt = select(GoldVaultEntity).where(
            GoldVaultEntity.is_active == True,
            GoldVaultEntity.is_deleted == False,
            or_(
                GoldVaultEntity.topic.ilike(like_pattern),
                func.jsonb_extract_path_text(GoldVaultEntity.raw_dialogue, "$").ilike(like_pattern),
            ),
        ).order_by(GoldVaultEntity.created_at.desc()).limit(limit)

        gold_rows = (await db.execute(gold_stmt)).scalars().all()

        if gold_rows:
            result.results = [self._gold_to_dict(r) for r in gold_rows[:limit]]
            result.source = "fallback"
            result.latency_ms = round((time.time() - start) * 1000)
            return result

        # ── 未命中 ──
        result.source = "none"
        result.latency_ms = round((time.time() - start) * 1000)
        logger.info(f"检索未命中: '{query}' ({result.latency_ms}ms)")
        return result

    # ── 辅助 ──

    async def _touch_events(self, db: AsyncSession, ids: List[str]):
        """更新黑钻事件访问时间"""
        now = time.time()
        for eid in ids:
            await db.execute(
                update(BlackDiamondEntity)
                .where(BlackDiamondEntity.id == eid)
                .values(last_accessed_at=func.now())
            )
        await db.commit()

    @staticmethod
    def _diamond_to_dict(d: BlackDiamondEntity) -> dict:
        return {
            "id": d.id,
            "event_id": d.event_id,
            "event_type": d.event_type,
            "core_facts": d.core_facts,
            "decisions": d.decisions,
            "emotional_spectrum": d.emotional_spectrum,
            "tags": d.tags,
            "decay_days": d.decay_days,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }

    @staticmethod
    def _gold_to_dict(g: GoldVaultEntity) -> dict:
        return {
            "id": g.id,
            "topic": g.topic,
            "raw_dialogue": g.raw_dialogue,
            "tags": g.tags,
            "created_at": g.created_at.isoformat() if g.created_at else None,
        }
