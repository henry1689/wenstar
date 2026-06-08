"""
景幻仙姑 · IQC 质检引擎（懒加载版本）
入库时只做极速基础清洗（去重）。
复杂语义打标签延迟到检索时触发——边用边炼。

修正来源：玉瑶指出"入库时不应该做复杂语义处理，保证秒进"
"""
import hashlib
import numpy as np
from typing import Optional
from core.database import Database, STATUS_QC_PENDING, STATUS_QC_FAILED
from vaults.alluvial import AlluvialVault
from engines.tagger import TaggerEngine


class IQCEngine:
    """IQC 质检引擎 — 懒加载设计"""

    def __init__(self, db: Database, alluvial: AlluvialVault, tagger: TaggerEngine):
        self.db = db
        self.alluvial = alluvial
        self.tagger = tagger
        self._existing_hashes: set[str] = set()

    async def process_queue(self, max_items: int = 20) -> dict:
        """处理 IQC 队列 — 只做基础清洗，不做复杂语义"""
        pending = await self.db.get_pending_iqc(max_items)
        results = {"checked": 0, "passed": 0, "failed": 0, "errors": []}

        await self._load_hashes()

        for doc in pending:
            try:
                result = await self._basic_inspect(doc)
                results["checked"] += 1
                if result["passed"]:
                    # 基础清洗通过 → 直接入金库
                    # 标签和向量索引延迟到检索时再做
                    await self.alluvial.promote_to_gold(
                        doc["id"], ["待提炼"], result["quality_score"]
                    )
                    results["passed"] += 1
                else:
                    await self.alluvial.reject(doc["id"], result["details"])
                    results["failed"] += 1
            except Exception as e:
                results["errors"].append(f"{doc['id']}: {e}")

        return results

    async def _basic_inspect(self, doc: dict) -> dict:
        """基础清洗：格式 + 哈希去重。不做语义标签。"""
        content = doc.get("content") or ""
        title = doc.get("title", "")
        file_hash = doc.get("file_hash", "")

        # 1. 格式检查
        if not content.strip() and not doc.get("file_path"):
            return {"passed": False, "quality_score": 0, "details": "内容为空"}

        # 2. SHA256 去重
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if content_hash in self._existing_hashes:
            return {"passed": False, "quality_score": 0,
                    "details": f"SHA256 重复: {content_hash[:12]}"}

        # 3. 极简质量评分（只基于长度）
        score = min(0.5, len(content) / 10000 * 0.5)

        self._existing_hashes.add(content_hash)
        return {"passed": True, "quality_score": score, "details": "基础清洗通过"}

    async def lazy_tag(self, doc_id: str, content: str, title: str) -> list[str]:
        """懒加载标签 — 检索时触发"""
        try:
            tags = await self.tagger.tag(title, content[:2000], [])
            await self.db.update_tags(doc_id, tags)
            return tags
        except Exception as e:
            print(f"[IQC] 懒加载标签失败: {e}")
            return ["待提炼"]

    async def _load_hashes(self):
        cursor = await self.db.conn.execute(
            "SELECT content FROM documents WHERE content IS NOT NULL"
        )
        rows = await cursor.fetchall()
        for row in rows:
            if row["content"]:
                h = hashlib.sha256(row["content"].encode("utf-8")).hexdigest()
                self._existing_hashes.add(h)
