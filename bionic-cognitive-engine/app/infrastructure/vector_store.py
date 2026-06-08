"""
仿生智脑 · Qdrant 向量存储客户端

24D 情感向量和语义向量的存储与检索。
支持：
  - 情感向量检索（按 valence/arousal 相似度排序）
  - 语义检索（按文本 embedding 相似度）
  - 检索降级（Qdrant 不可用时优雅降级）
"""
import logging
from typing import Optional, List

from qdrant_client import QdrantClient as QdrantSyncClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.exceptions import UnexpectedResponse

from app.core.config import settings

logger = logging.getLogger("bionic.vector")


class VectorStore:
    """
    Qdrant 向量数据库客户端。

    用法:
        vs = VectorStore()
        vs.initialize()                     # 建 collection
        vs.upsert_vector(point_id, vector)  # 写入向量
        hits = vs.search(vector, limit=5)   # 检索
    """

    def __init__(self, url: Optional[str] = None, collection: Optional[str] = None):
        self.url = url or settings.QDRANT_URL
        self.collection = collection or settings.QDRANT_COLLECTION
        self._client: Optional[QdrantSyncClient] = None
        self._dimension = 24  # 24D 情感向量

    def initialize(self) -> bool:
        """初始化 Qdrant 客户端 + 创建 collection（如不存在）"""
        try:
            self._client = QdrantSyncClient(url=self.url, timeout=10)
            # 检查 collection 是否存在
            collections = self._client.get_collections().collections
            exists = any(c.name == self.collection for c in collections)

            if not exists:
                self._client.create_collection(
                    collection_name=self.collection,
                    vectors_config=qdrant_models.VectorParams(
                        size=self._dimension,
                        distance=qdrant_models.Distance.COSINE,
                    ),
                )
                logger.info(f"Qdrant collection '{self.collection}' 已创建"
                            f" (dim={self._dimension})")
            else:
                logger.info(f"Qdrant collection '{self.collection}' 已存在")

            return True

        except Exception as e:
            logger.warning(f"Qdrant 初始化失败（将降级为纯文本检索）: {e}")
            self._client = None
            return False

    @property
    def available(self) -> bool:
        return self._client is not None

    def upsert_vector(
        self,
        point_id: str,
        vector: List[float],
        payload: Optional[dict] = None,
    ) -> bool:
        """写入/更新向量"""
        if not self.available:
            return False
        try:
            self._client.upsert(
                collection_name=self.collection,
                points=[qdrant_models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=payload or {},
                )],
            )
            return True
        except Exception as e:
            logger.error(f"Qdrant upsert 失败: {e}")
            return False

    def search(
        self,
        vector: List[float],
        limit: int = 10,
        score_threshold: float = 0.75,
    ) -> List[dict]:
        """向量检索 (cosine similarity)"""
        if not self.available:
            return []
        try:
            hits = self._client.search(
                collection_name=self.collection,
                query_vector=vector,
                limit=limit,
                score_threshold=score_threshold,
            )
            results = []
            for hit in hits:
                results.append({
                    "id": hit.id,
                    "score": hit.score,
                    "payload": hit.payload or {},
                })
            return results

        except Exception as e:
            logger.error(f"Qdrant 检索失败: {e}")
            return []

    def delete_vector(self, point_id: str) -> bool:
        """删除向量"""
        if not self.available:
            return False
        try:
            self._client.delete(
                collection_name=self.collection,
                points_selector=qdrant_models.PointIdsList(
                    points=[point_id]
                ),
            )
            return True
        except Exception as e:
            logger.error(f"Qdrant 删除失败: {e}")
            return False

    def health_check(self) -> bool:
        """健康检查"""
        try:
            if not self._client:
                return False
            self._client.get_collections()
            return True
        except Exception:
            return False
