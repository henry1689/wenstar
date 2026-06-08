"""
仿生智脑 · 记忆提炼器 (Memory Consolidation Service)

建模三部曲·第二步：
  把金库(原声带) → LLM 提炼 → 黑钻库(事件+情感曲谱)。

核心流程：
  1. 从 PostgreSQL 加载金库对话
  2. 调用 LLM 提炼 prompt → 解析结构化 JSON
  3. 创建黑钻事件 (PostgreSQL)
  4. 生成向量 embedding → 存入 Qdrant
  5. 标记金库记录 is_refined=True

设计原则：
  - 24D 情感向量在提炼过程中不可丢失
  - LLM 失败不阻塞：单条失败不影响其他记录
  - 重试机制：最多 3 次，指数退避
"""
import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import (
    GoldVaultEntity, BlackDiamondEntity, DiamondGoldLink,
    BlackDiamondEvent, EmotionalSpectrum, EmotionalCurvePoint,
)
from app.infrastructure.llm_client import LLMClient
from app.infrastructure.vector_store import VectorStore

logger = logging.getLogger("bionic.refiner")


class MemoryConsolidator:
    """
    景幻仙姑的记忆提炼器。

    用法:
        consolidator = MemoryConsolidator(llm, vector_store)
        result = await consolidator.consolidate_next_batch(db_session, max_items=5)
    """

    def __init__(self, llm: LLMClient, vector_store: Optional[VectorStore] = None):
        self.llm = llm
        self.vector_store = vector_store
        self._stats = {"total_refined": 0, "total_promoted": 0, "total_failed": 0}

    async def consolidate_next_batch(
        self, db: AsyncSession, max_items: int = 5
    ) -> dict:
        """
        处理一批未提炼的金库记录。

        Returns:
            {"processed": N, "promoted": N, "failed": N, "errors": [...]}
        """
        # 查询未提炼记录
        result = await db.execute(
            select(GoldVaultEntity)
            .where(
                GoldVaultEntity.is_active == True,
                GoldVaultEntity.is_refined == False,
                GoldVaultEntity.is_deleted == False,
            )
            .order_by(GoldVaultEntity.created_at.asc())
            .limit(max_items)
        )
        unrefined = list(result.scalars().all())

        if not unrefined:
            return {"processed": 0, "promoted": 0, "failed": 0, "errors": []}

        batch_result = {"processed": 0, "promoted": 0, "failed": 0, "errors": []}

        for gold in unrefined:
            try:
                success = await self._consolidate_one(db, gold)
                batch_result["processed"] += 1
                if success:
                    batch_result["promoted"] += 1
                    self._stats["total_promoted"] += 1
                else:
                    batch_result["failed"] += 1
                    self._stats["total_failed"] += 1
            except Exception as e:
                batch_result["failed"] += 1
                batch_result["errors"].append(f"{gold.id}: {e}")
                self._stats["total_failed"] += 1

            time.sleep(0.5)

        if batch_result["promoted"] > 0:
            self._stats["total_refined"] += batch_result["promoted"]
            logger.info(
                f"记忆提炼完成: 处理{batch_result['processed']}条, "
                f"晋升{batch_result['promoted']}条, 失败{batch_result['failed']}条"
            )

        return batch_result

    async def _consolidate_one(self, db: AsyncSession, gold: GoldVaultEntity) -> bool:
        """提炼单条金库记录 → 黑钻事件"""
        dialogue_text = self._format_dialogue(gold.raw_dialogue)
        if not dialogue_text.strip():
            gold.is_refined = True
            await db.merge(gold)
            return False

        # 调用 LLM 提炼
        refined = self.llm.refine(gold.topic, dialogue_text, gold.emotion_vector)
        if refined is None:
            return False

        # 构建黑钻事件
        event = self._build_event(refined, gold)
        diamond = BlackDiamondEntity(
            event_id=event.event_id,
            event_type=event.event_type,
            occurred_at=datetime.fromisoformat(event.timestamp) if event.timestamp else datetime.now(timezone.utc),
            core_facts=event.core_facts,
            decisions=event.decisions,
            emotional_spectrum=event.emotional_spectrum.model_dump() if isinstance(event.emotional_spectrum, EmotionalSpectrum) else event.emotional_spectrum,
            gold_references=[gold.id],
            tags=event.tags,
            user_id=gold.user_id,  # 保留归属用户
        )
        db.add(diamond)
        await db.flush()

        # 建立关联
        link = DiamondGoldLink(diamond_id=diamond.id, gold_id=gold.id)
        db.add(link)

        # 标记金库已提炼
        gold.is_refined = True
        await db.merge(gold)

        # 写入向量库（如果有）
        if self.vector_store and self.vector_store.available and gold.emotion_vector:
            self.vector_store.upsert_vector(
                point_id=diamond.id,
                vector=gold.emotion_vector,
                payload={
                    "event_id": diamond.event_id,
                    "event_type": diamond.event_type,
                    "core_facts": diamond.core_facts[:200],
                    "topic": gold.topic,
                },
            )
            diamond.vector_id = diamond.id

        await db.commit()
        logger.info(f"晋升黑钻: {diamond.event_id} <- 金库:{gold.id} topic={gold.topic}")
        return True

    def _build_event(self, refined: dict, gold: GoldVaultEntity) -> BlackDiamondEvent:
        """构建黑钻事件专有格式"""
        emotional = refined.get("emotional_spectrum", {})
        if isinstance(emotional, str):
            emotional = json.loads(emotional)

        curve_points = [
            EmotionalCurvePoint(**p) for p in emotional.get("curve", [])
        ]

        return BlackDiamondEvent(
            event_id=f"evt_{int(time.time())}_{gold.id[:8]}",
            event_type=self._infer_event_type(refined, gold.topic),
            timestamp=datetime.now(timezone.utc).isoformat(),
            core_facts=refined.get("core_facts", gold.topic),
            decisions=refined.get("decisions", []),
            emotional_spectrum=EmotionalSpectrum(
                summary=emotional.get("summary", ""),
                curve=curve_points,
                dominant_emotion=emotional.get("dominant_emotion", "平静"),
                user_sentiment=emotional.get("user_sentiment", "中性"),
            ),
            gold_references=[gold.id],
            tags=refined.get("tags", ["未分类"]),
        )

    @staticmethod
    def _infer_event_type(refined: dict, topic: str) -> str:
        """从提炼结果推断事件类型"""
        tags = refined.get("tags", [])
        if not tags:
            return "general_conversation"

        type_map = {
            "架构": "architecture_decision", "设计": "design_discussion",
            "技术": "technical_discussion", "bug": "bug_fix",
            "修复": "bug_fix", "情感": "emotional_exchange",
            "日常": "daily_conversation", "规划": "planning",
            "决策": "decision", "学习": "learning", "知识": "knowledge",
        }
        for tag in tags:
            for key, etype in type_map.items():
                if key in tag:
                    return etype
        return "general_conversation"

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

    def get_stats(self) -> dict:
        return dict(self._stats)
