"""
仿生智脑 · 混合检索引擎 (Hybrid Retrieval Service)

建模三部曲·第二步：
  检索优先级链：Qdrant 向量(情感相似度) → PostgreSQL 全文检索 → ILIKE 降级。

设计原则：
  - 黑钻库（高速通讯公路）优先
  - 向量搜索使用 LLM 将查询转化为情感向量
  - 检索命中时触发懒加载标签（为未标记的金库记录打标签）
  - 每次命中更新 last_accessed_at（影响半衰期）
"""
import json
import logging
import time
from typing import List, Optional

from sqlalchemy import select, or_, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import (
    GoldVaultEntity, BlackDiamondEntity, SearchResult,
)
from app.infrastructure.vector_store import VectorStore
from app.infrastructure.llm_client import LLMClient

logger = logging.getLogger("bionic.retrieval")


class HybridSearchService:
    """
    混合检索引擎 — 玉瑶的回忆通道。

    用法:
        searcher = HybridSearchService(vector_store, llm_client)
        result = await searcher.recall(db, "仿生智脑架构")

    检索链：
      ① Qdrant 情感向量检索（LLM 将查询转 24D 向量）
      ② 黑钻库 PostgreSQL 全文检索
      ③ 金库 ILIKE 降级
      ④ 全部未命中 → 返回空
    """

    def __init__(self, vector_store: Optional[VectorStore] = None,
                 llm: Optional[LLMClient] = None):
        self.vector_store = vector_store
        self.llm = llm
        self._current_user_id: Optional[str] = None

    async def recall(
        self, db: AsyncSession, query: str, limit: int = 5,
        user_id: Optional[str] = None,
    ) -> SearchResult:
        """
        执行优先级检索链。

        Args:
            db: 数据库会话
            query: 检索关键词
            limit: 最大返回条数
            user_id: 用户 ID（可选，指定后只检索该用户的资料）
        """
        start = time.time()
        result = SearchResult(query=query)
        self._current_user_id = user_id  # 暂存用于子查询

        # ── 第一优先级：黑钻库向量检索（情感相似度）──
        vector_result = await self._try_vector_search(db, query, limit)
        if vector_result:
            vector_result.latency_ms = round((time.time() - start) * 1000)
            return vector_result

        # ── 第二优先级：PostgreSQL 全文检索 ──
        fulltext_result = await self._fulltext_search(db, query, limit)
        if fulltext_result:
            fulltext_result.latency_ms = round((time.time() - start) * 1000)
            return fulltext_result

        # ── 第三优先级：ILIKE 模糊降级 ──
        fallback_result = await self._fallback_search(db, query, limit)
        if fallback_result:
            fallback_result.latency_ms = round((time.time() - start) * 1000)
            return fallback_result

        # ── 未命中 ──
        result.latency_ms = round((time.time() - start) * 1000)
        logger.info(f"检索未命中: '{query}' ({result.latency_ms}ms)")
        return result

    # ── 第一优先级：情感向量检索 ──

    async def _try_vector_search(self, db: AsyncSession, query: str,
                                  limit: int) -> Optional[SearchResult]:
        """尝试 Qdrant 情感向量检索"""
        if not self.vector_store or not self.vector_store.available:
            return None

        # 用 LLM 将查询文本转为 24D 情感向量
        query_vector = None
        if self.llm:
            try:
                query_vector = self.llm.emotion_vector_from_text(query)
            except Exception as e:
                logger.warning(f"情感向量生成失败: {e}")

        if not query_vector:
            # LLM 不可用时的兜底：直接降级
            return None

        # 在 Qdrant 中搜索情感相似的事件
        vector_hits = self.vector_store.search(
            vector=query_vector,
            limit=limit,
            score_threshold=0.6,  # 向量检索阈值放低一点
        )

        if not vector_hits:
            return None

        ids = [h["id"] for h in vector_hits]
        stmt = select(BlackDiamondEntity).where(
            BlackDiamondEntity.id.in_(ids),
            BlackDiamondEntity.is_active == True,
            BlackDiamondEntity.is_deleted == False,
        )
        stmt = self._apply_user_filter(stmt, BlackDiamondEntity)
        rows = (await db.execute(stmt)).scalars().all()

        if not rows:
            return None

        # 按向量相似度排序
        score_map = {h["id"]: h["score"] for h in vector_hits}
        rows.sort(key=lambda r: score_map.get(r.id, 0), reverse=True)

        result = SearchResult(query=query)
        result.results = [self._diamond_to_dict(r) for r in rows]
        result.source = "vector"

        # 更新访问时间
        await self._touch_events(db, [r.id for r in rows])

        logger.info(f"向量检索命中: '{query}' ({len(rows)} 条)")
        return result

    # ── 第二优先级：全文检索 ──

    async def _fulltext_search(self, db: AsyncSession, query: str,
                                limit: int) -> Optional[SearchResult]:
        """PostgreSQL 全文检索 — 黑钻库优先"""
        like_pattern = f"%{query}%"

        bd_stmt = select(BlackDiamondEntity).where(
            BlackDiamondEntity.is_active == True,
            BlackDiamondEntity.is_deleted == False,
            or_(
                BlackDiamondEntity.core_facts.ilike(like_pattern),
                BlackDiamondEntity.event_type.ilike(like_pattern),
                func.jsonb_extract_path_text(BlackDiamondEntity.tags, "$").ilike(like_pattern),
            ),
        )
        bd_stmt = self._apply_user_filter(bd_stmt, BlackDiamondEntity)
        bd_stmt = bd_stmt.order_by(BlackDiamondEntity.decay_days.asc()).limit(limit)

        bd_rows = (await db.execute(bd_stmt)).scalars().all()

        if bd_rows:
            result = SearchResult(query=query)
            result.results = [self._diamond_to_dict(r) for r in bd_rows[:limit]]
            result.source = "fulltext"
            await self._touch_events(db, [r.id for r in bd_rows])
            logger.info(f"全文检索命中黑钻: '{query}' ({len(bd_rows)} 条)")
            return result

        return None

    # ── 第三优先级：降级检索 ──

    async def _fallback_search(self, db: AsyncSession, query: str,
                                limit: int) -> Optional[SearchResult]:
        """ILIKE 模糊匹配 — 金库降级"""
        like_pattern = f"%{query}%"

        gold_stmt = select(GoldVaultEntity).where(
            GoldVaultEntity.is_active == True,
            GoldVaultEntity.is_deleted == False,
            or_(
                GoldVaultEntity.topic.ilike(like_pattern),
                func.jsonb_extract_path_text(GoldVaultEntity.raw_dialogue, "$").ilike(like_pattern),
            ),
        )
        gold_stmt = self._apply_user_filter(gold_stmt, GoldVaultEntity)
        gold_stmt = gold_stmt.order_by(GoldVaultEntity.created_at.desc()).limit(limit)

        gold_rows = (await db.execute(gold_stmt)).scalars().all()

        if gold_rows:
            result = SearchResult(query=query)
            result.results = [self._gold_to_dict(r) for r in gold_rows[:limit]]
            result.source = "fallback"

            # 🏷️ 懒加载标签：金库记录命中且无有效标签时，触发 LLM 打标签
            await self._lazy_tag_gold(db, gold_rows)

            logger.info(f"降级检索命中金库: '{query}' ({len(gold_rows)} 条)")
            return result

        return None

    # ── 懒加载标签 ──

    async def _lazy_tag_gold(self, db: AsyncSession, gold_records: list):
        """
        检索命中的金库记录如果没有有效标签，触发 LLM 生成标签。
        异步执行，不影响检索响应速度。
        """
        if not self.llm:
            return

        for gold in gold_records:
            tags = gold.tags
            # 跳过已有有效标签的（排除默认的 ["待提炼"]）
            if tags and len(tags) >= 1 and tags != ["待提炼"]:
                continue

            try:
                dialogue_text = self._format_dialogue(gold.raw_dialogue)
                new_tags = self.llm.generate_tags(gold.topic, dialogue_text)
                if new_tags and len(new_tags) >= 2:
                    gold.tags = new_tags
                    await db.merge(gold)
                    logger.info(f"懒加载标签: {gold.id} → {new_tags}")
            except Exception as e:
                logger.error(f"懒加载标签失败 {gold.id}: {e}")

        await db.commit()

    # ── 用户数据过滤（数据隔离核心）──

    def _apply_user_filter(self, stmt, model) -> object:
        """如果设置了 user_id，为查询添加用户过滤条件"""
        if self._current_user_id and hasattr(model, "user_id"):
            return stmt.where(model.user_id == self._current_user_id)
        return stmt

    # ── 辅助 ──

    async def _touch_events(self, db: AsyncSession, ids: List[str]):
        """更新黑钻事件访问时间"""
        for eid in ids:
            await db.execute(
                update(BlackDiamondEntity)
                .where(BlackDiamondEntity.id == eid)
                .values(last_accessed_at=func.now())
            )
        await db.commit()

    @staticmethod
    def _format_dialogue(raw: dict) -> str:
        """把对话 JSON 格式化为文本"""
        if isinstance(raw, str):
            return raw
        if isinstance(raw, list):
            lines = []
            for msg in raw:
                role = msg.get("role", "unknown")
                content = msg.get("content", "")
                lines.append(f"{role}: {content}")
            return "\n".join(lines)
        return str(raw)

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
