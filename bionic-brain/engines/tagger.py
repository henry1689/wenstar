"""
景幻仙姑 · LLM 标签引擎
使用用户配置的 LLM 打标签，非关键词规则。
"""
import json
from typing import Optional
import httpx
from core.config import LLM_API_URL, LLM_API_KEY, LLM_MODEL


class TaggerEngine:
    """LLM 标签引擎 —— 给内容打 3~5 个标签"""

    def __init__(self):
        self.api_url = LLM_API_URL
        self.api_key = LLM_API_KEY

    async def tag(self, title: str, content: str, existing_tags: list[str] = None) -> list[str]:
        """用 LLM 生成标签"""
        if not content and not title:
            return existing_tags or ["未分类"]

        existing = existing_tags or []
        prompt = self._build_prompt(title, content[:2000], existing)

        try:
            tags = await self._call_llm(prompt)
            if tags:
                # 合并现有标签 + 新标签，去重，限制 5 个
                merged = list(dict.fromkeys(existing + tags))
                return merged[:5]
        except Exception as e:
            print(f"[标] LLM 标签失败: {e}")

        # 降级：从标题提取
        fallback = self._fallback_tags(title)
        return list(dict.fromkeys(existing + fallback))[:5]

    def _build_prompt(self, title: str, content: str, existing: list[str]) -> str:
        existing_str = "，".join(existing) if existing else "无"
        return (
            f"给以下内容打 3~5 个中文标签，只返回标签列表（JSON 数组格式），不要解释。\n\n"
            f"标题：{title}\n"
            f"内容摘要：{content[:1500]}\n"
            f"已有标签：{existing_str}\n\n"
            f"标签要求：准确、简洁、每个 2~6 个字。"
            f"返回格式：[\"标签1\", \"标签2\", \"标签3\"]"
        )

    async def _call_llm(self, prompt: str) -> Optional[list[str]]:
        """调用用户配置的 LLM（当前运行的是 DeepSeek/Claude 等）"""
        # 先尝试标准 chat/completions 接口
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    self.api_url,
                    json={
                        "model": LLM_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 200,
                    },
                    headers={"Authorization": f"Bearer {self.api_key}"} if self.api_key else {},
                )
                if resp.is_success:
                    data = resp.json()
                    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
                    return self._parse_tags(text)
        except Exception as e:
            print(f"[标] LLM 调用失败: {e}")

        # 降级：调用本地 WenStar API
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "http://localhost:3000/api/chat",
                    json={"message": prompt},
                )
                if resp.is_success:
                    data = resp.json()
                    return self._parse_tags(data.get("reply", ""))
        except Exception:
            pass

        return None

    def _parse_tags(self, text: str) -> list[str]:
        """从 LLM 输出中解析标签列表"""
        if not text:
            return []
        # 尝试 JSON 解析
        text = text.strip()
        if text.startswith("["):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
        # 尝试行解析
        lines = [l.strip().strip("-*").strip() for l in text.split("\n") if l.strip()]
        # 尝试按逗号/空格分割
        if len(lines) <= 2:
            parts = [p.strip().strip("\"'[]") for p in text.replace("[", "").replace("]", "").split(",")]
            return [p for p in parts if len(p) >= 2 and len(p) <= 12]
        return [l for l in lines if len(l) >= 2 and len(l) <= 12][:5]

    @staticmethod
    def _fallback_tags(title: str) -> list[str]:
        """标题提取降级"""
        import re
        words = re.findall(r"[一-鿿]{2,6}", title)
        return words[:3] if words else ["未分类"]
