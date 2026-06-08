"""
仿生智脑 · LLM HTTP 客户端

调用外部 LLM API 完成结构化提炼任务。

设计原则：
  - Provider Agnostic：用户接的啥就用啥。
  - 重试机制：3 次重试 + 指数退避 (1.5^N)
  - 超时控制：全局 60s 超时
  - JSON 解析：支持多种 LLM 输出格式
"""
import json
import logging
import re
import time
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("bionic.llm")


class LLMClient:
    """
    景幻仙姑的 LLM 调用通道。

    用法:
        client = LLMClient()
        result = client.refine(topic, dialogue)
        # → {"core_facts": "...", "decisions": [...], "emotional_spectrum": {...}, "tags": [...]}
    """

    def __init__(
        self,
        api_url: Optional[str] = None,
        api_key: Optional[str] = None,
        timeout: Optional[int] = None,
        max_retries: Optional[int] = None,
    ):
        self.api_url = api_url or settings.LLM_API_URL
        self.api_key = api_key or settings.LLM_API_KEY
        self.timeout = timeout or settings.LLM_TIMEOUT
        self.max_retries = max_retries or settings.LLM_MAX_RETRIES

        self._stats = {
            "calls": 0, "success": 0, "failed": 0,
            "retries": 0, "total_tokens_est": 0,
        }

    # ── 公共方法 ──

    def call(self, prompt: str, system_prompt: str = "") -> Optional[str]:
        """通用 LLM 调用（同步 HTTP）"""
        self._stats["calls"] += 1
        last_error = ""

        for attempt in range(self.max_retries):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    body = self._build_request(prompt, system_prompt)
                    resp = client.post(self.api_url, json=body)
                    resp.raise_for_status()
                    content = self._extract_content(resp.text)

                    if content:
                        self._stats["success"] += 1
                        self._stats["total_tokens_est"] += len(content) // 4
                        return content

                    last_error = "响应内容为空"

            except httpx.HTTPStatusError as e:
                last_error = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
            except httpx.TimeoutException:
                last_error = f"超时 ({self.timeout}s)"
            except Exception as e:
                last_error = str(e)

            self._stats["retries"] += 1
            if attempt < self.max_retries - 1:
                wait = 1.5 ** (attempt + 1)
                time.sleep(wait)

        self._stats["failed"] += 1
        logger.warning(f"LLM 调用失败（{self.max_retries}次重试后）: {last_error}")
        return None

    async def call_async(self, prompt: str, system_prompt: str = "") -> Optional[str]:
        """通用 LLM 调用（异步 HTTP）"""
        self._stats["calls"] += 1

        for attempt in range(self.max_retries):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    body = self._build_request(prompt, system_prompt)
                    resp = await client.post(self.api_url, json=body)
                    resp.raise_for_status()
                    content = self._extract_content(resp.text)

                    if content:
                        self._stats["success"] += 1
                        self._stats["total_tokens_est"] += len(content) // 4
                        return content

            except Exception as e:
                self._stats["retries"] += 1
                if attempt < self.max_retries - 1:
                    await self._async_wait(1.5 ** (attempt + 1))

        self._stats["failed"] += 1
        return None

    def refine(self, topic: str, dialogue: str,
               emotion_vector: Optional[list] = None) -> Optional[dict]:
        """
        记忆提炼专用：发送提炼 prompt，返回结构化 JSON。

        Args:
            topic: 对话话题
            dialogue: 对话原文
            emotion_vector: 24D 情感向量（如果有）

        Returns:
            {"core_facts", "decisions", "emotional_spectrum", "tags"}
        """
        system_prompt = (
            "你是景幻仙姑的记忆精炼师。你的任务是从对话中提取结构化信息。\n\n"
            "你必须严格遵守：\n"
            "1. 只提炼事实。不虚构、不脑补。\n"
            "2. 情感曲线要有时间顺序——按对话中情感变化的先后排列。\n"
            "3. decisions 只记明确做出的决策，不是潜在选项。\n"
            "4. 输出必须是可以直接用 json.loads() 解析的纯 JSON，不要 markdown 代码块标记。\n"
            "5. 如果你不确定某个值，宁愿省略也不要编造。"
        )

        prompt = self._build_refine_prompt(topic, dialogue, emotion_vector)
        raw = self.call(prompt, system_prompt)
        if raw is None:
            return None

        return self._parse_json_response(raw)

    # ── 请求构建 ──

    def _build_request(self, prompt: str, system_prompt: str = "") -> dict:
        """构建请求体（OpenAI / WenStar 兼容格式）"""
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        return {"messages": messages, "stream": False}

    def _extract_content(self, resp_text: str) -> Optional[str]:
        """从响应中提取 content 字段"""
        try:
            data = json.loads(resp_text)
            # OpenAI 格式
            if "choices" in data:
                return data["choices"][0].get("message", {}).get("content", "")
            # WenStar 格式
            if "data" in data and isinstance(data["data"], dict):
                return data["data"].get("content", "")
            # 直接 content
            if "content" in data:
                return data["content"]
            return resp_text
        except json.JSONDecodeError:
            return resp_text

    # ── Prompt 构建 ──

    def _build_refine_prompt(self, topic: str, dialogue: str,
                             emotion_vector: Optional[list] = None) -> str:
        """构建提炼 prompt"""
        max_chars = 6000
        truncated = dialogue[:max_chars]
        if len(dialogue) > max_chars:
            truncated += "\n\n[...对话过长，已截断...]"

        vec_hint = ""
        if emotion_vector:
            vec_hint = f"\n\n## 已知情感向量（24D 曲谱摘要）\n{emotion_vector[:6]}...\n"

        return (
            f"请分析下面的对话内容，精炼提取结构化信息。\n\n"
            f"## 对话话题\n{topic}\n\n"
            f"## 对话内容\n{truncated}\n{vec_hint}\n\n"
            f"## 输出格式（纯 JSON，不要 markdown 标记）\n"
            f"{{\n"
            f'  "core_facts": "核心事实总结",\n'
            f'  "decisions": ["决策1", "决策2"],\n'
            f'  "emotional_spectrum": {{\n'
            f'    "summary": "情感变化描述",\n'
            f'    "curve": [\n'
            f'      {{"phase": "阶段", "valence": 0.5, "arousal": 0.5}}\n'
            f'    ],\n'
            f'    "dominant_emotion": "主导情绪",\n'
            f'    "user_sentiment": "用户态度"\n'
            f'  }},\n'
            f'  "tags": ["标签1", "标签2"]\n'
            f"}}"
        )

    # ── JSON 解析 ──

    @staticmethod
    def _parse_json_response(raw: str) -> Optional[dict]:
        """从 LLM 响应中提取并解析 JSON"""
        # 尝试直接解析
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass

        # 尝试提取 ```json 代码块
        m = re.search(r"```(?:json)?\s*\n(.*?)\n```", raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass

        # 尝试提取首对 {}
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass

        return None

    # ── 辅助 ──

    @staticmethod
    async def _async_wait(seconds: float):
        """异步等待"""
        import asyncio
        await asyncio.sleep(seconds)

    def get_stats(self) -> dict:
        return dict(self._stats)
