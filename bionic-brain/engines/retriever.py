"""
景幻仙姑 · 检索引擎（懒加载版）
优先级链：黑钻库(高速) → 金库(标准) → 未命中
边用边炼：检索到文档时触发后台懒加载标签+提炼
降级熔断：向量超时自动切换 LIKE
"""
import asyncio
import time
from typing import Optional
from core.config import RETRIEVAL_TIMEOUT_MS
from vaults.black_diamond import BlackDiamondVault
from vaults.gold import GoldVault


class RetrieverEngine:
    """检索引擎 — 优先级链 + 懒加载 + 降级熔断"""

    def __init__(self, bd_vault: BlackDiamondVault, gold_vault: GoldVault, iqc_engine=None):
        self.bd = bd_vault
        self.gold = gold_vault
        self.iqc = iqc_engine
        self._vector_fallback = False

    async def search(self, keyword: str, limit: int = 5) -> dict:
        """优先级检索链"""
        start = time.time()
        timeout_s = max(0.1, RETRIEVAL_TIMEOUT_MS / 1000)

        result = {
            "keyword": keyword,
            "results": [],
            "source": "none",
            "latency_ms": 0,
            "fallback_used": self._vector_fallback,
        }

        # 1. 黑钻库高速通道
        try:
            bd_results = await asyncio.wait_for(
                self.bd.search_active(keyword, limit), timeout=timeout_s)
            if bd_results:
                result["results"] = bd_results[:limit]
                result["source"] = "black_diamond"
                result["latency_ms"] = round((time.time() - start) * 1000)
                return result
        except asyncio.TimeoutError:
            self._vector_fallback = True
        except Exception as e:
            print(f"[检索] 黑钻: {e}")

        # 2. 金库标准检索
        try:
            gold_results = await asyncio.wait_for(
                self.gold.search(keyword, limit), timeout=timeout_s)
            if gold_results:
                result["results"] = gold_results[:limit]
                result["source"] = "gold"
                result["latency_ms"] = round((time.time() - start) * 1000)
                # 触发懒加载标签（后台，不阻塞返回）
                if self.iqc:
                    for doc in gold_results:
                        if doc.tags == ["待提炼"] and doc.content:
                            asyncio.create_task(
                                self.iqc.lazy_tag(doc.id, doc.content, doc.title)
                            )
                return result
        except asyncio.TimeoutError:
            self._vector_fallback = True
        except Exception as e:
            print(f"[检索] 金库: {e}")

        # 3. 降级 LIKE
        if self._vector_fallback:
            try:
                fallback = await self.gold.search(keyword, limit)
                if fallback:
                    result["results"] = fallback
                    result["source"] = "gold_fallback"
                    result["fallback_used"] = True
                    result["latency_ms"] = round((time.time() - start) * 1000)
                    return result
            except Exception as e:
                print(f"[检索] 降级也失败: {e}")

        result["latency_ms"] = round((time.time() - start) * 1000)
        return result

    def reset_fallback(self):
        self._vector_fallback = False
