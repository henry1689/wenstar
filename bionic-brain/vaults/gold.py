"""
景幻仙姑 · 金库 (Gold Vault)
标准馆藏。IQC 通过后的正式馆藏。
支持向量 + 关键词检索。
"""
from typing import Optional
from core.database import Database
from core.schemas import DocumentResponse
import numpy as np


class GoldVault:
    """金库：标准馆藏，图书馆式管理"""

    def __init__(self, db: Database):
        self.db = db
        self._vectors: dict[str, np.ndarray] = {}   # doc_id → vector 缓存
        self._index_ready = False

    async def search(self, keyword: str, limit: int = 10) -> list[DocumentResponse]:
        """金库搜索：关键词 LIKE（低延迟路径）"""
        return await self._keyword_search(keyword, limit)

    async def hybrid_search(self, keyword: str, query_vector: np.ndarray = None,
                            limit: int = 10) -> list[DocumentResponse]:
        """混合搜索：向量语义 + 关键词"""
        # 关键词路径
        keyword_results = await self._keyword_search(keyword, limit * 2)
        seen = {r.id for r in keyword_results}

        # 向量路径（如果有向量）
        vector_results = []
        if query_vector is not None and self._index_ready:
            scored = []
            for doc_id, vec in self._vectors.items():
                sim = self._cosine_similarity(query_vector, vec)
                if sim > 0.6:
                    scored.append((doc_id, sim))
            scored.sort(key=lambda x: -x[1])
            for doc_id, sim in scored[:limit]:
                if doc_id not in seen:
                    doc = await self.db.get_doc(doc_id)
                    if doc:
                        seen.add(doc_id)
                        vector_results.append(_doc_to_response(doc))

        # 合并：向量优先（更准），关键词补足
        merged = vector_results + keyword_results
        return merged[:limit]

    async def get_by_id(self, doc_id: str) -> Optional[DocumentResponse]:
        doc = await self.db.get_doc(doc_id)
        return _doc_to_response(doc) if doc else None

    async def count(self) -> int:
        return await self.db.fetch_val(
            "SELECT COUNT(*) FROM documents WHERE vault='gold' AND status='shelved'"
        )

    async def build_vector_index(self):
        """重建向量索引（做梦模式中调用）"""
        cursor = await self.db.conn.execute(
            "SELECT id, content FROM documents WHERE vault='gold' AND status='shelved' AND content IS NOT NULL"
        )
        rows = await cursor.fetchall()
        for row in rows:
            doc_id = row["id"]
            content = row["content"] or ""
            vec = self._simple_embed(content)
            self._vectors[doc_id] = vec
        self._index_ready = True
        print(f"[金库] 向量索引重建完成: {len(self._vectors)} 条")

    async def _keyword_search(self, keyword: str, limit: int) -> list[DocumentResponse]:
        results = await self.db.search_by_vault("gold", keyword, limit)
        return [_doc_to_response(r) for r in results]

    @staticmethod
    def _simple_embed(text: str) -> np.ndarray:
        """简易 N-gram 嵌入（零依赖，匹配已有方式）"""
        vec = np.zeros(256, dtype=np.float32)
        if not text:
            return vec
        text = text.lower()
        # bigram
        for i in range(len(text) - 1):
            idx = hash(text[i:i+2]) % 256
            vec[idx] += 1.0
        # trigram
        for i in range(len(text) - 2):
            idx = hash(text[i:i+3]) % 256
            vec[idx] += 0.5
        norm = np.linalg.norm(vec)
        return vec / norm if norm > 0 else vec

    @staticmethod
    def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
        dot = float(np.dot(a, b))
        na = float(np.linalg.norm(a))
        nb = float(np.linalg.norm(b))
        return dot / (na * nb) if na > 0 and nb > 0 else 0.0


def _doc_to_response(doc: dict) -> DocumentResponse:
    return DocumentResponse(
        id=doc["id"],
        title=doc["title"],
        content=doc.get("content"),
        status=doc["status"],
        vault=doc["vault"],
        tags=doc.get("tags") or [],
        quality_score=doc.get("quality_score", 0.0) or 0.0,
        call_count=doc.get("call_count", 0) or 0,
        last_called_at=doc.get("last_called_at"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
        version=doc.get("version", 1) or 1,
    )
