"""
仿生智脑 · 全局配置 (pydantic-settings)

从环境变量加载，支持 .env 文件覆写。
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """系统全局配置——所有配置项集中在这里"""

    # ── FastAPI ──
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 7200
    API_DEBUG: bool = False
    API_SECRET_KEY: str = "change-me-to-a-random-64-char-string"

    # ── PostgreSQL ──
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str = "bionic"
    POSTGRES_USER: str = "bionic"
    POSTGRES_PASSWORD: str = "bionic_secret_2026"

    @property
    def POSTGRES_DSN(self) -> str:
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def POSTGRES_DSN_SYNC(self) -> str:
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    # ── Redis ──
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0

    @property
    def REDIS_URL(self) -> str:
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # ── Qdrant ──
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333
    QDRANT_COLLECTION: str = "bionic_vectors"

    @property
    def QDRANT_URL(self) -> str:
        return f"http://{self.QDRANT_HOST}:{self.QDRANT_PORT}"

    # ── MinIO ──
    MINIO_HOST: str = "localhost"
    MINIO_PORT: int = 9000
    MINIO_ACCESS_KEY: str = "bionic_admin"
    MINIO_SECRET_KEY: str = "bionic_secret_2026"
    MINIO_BUCKET: str = "bionic-alluvial"

    @property
    def MINIO_ENDPOINT(self) -> str:
        return f"{self.MINIO_HOST}:{self.MINIO_PORT}"

    # ── LLM API ──
    LLM_API_URL: str = "http://localhost:3000/api/chat"
    LLM_API_KEY: str = ""
    LLM_TIMEOUT: int = 60
    LLM_MAX_RETRIES: int = 3

    # ── Decay ──
    DECAY_DEMOTE_DAYS: int = 30
    DECAY_ARCHIVE_DAYS: int = 90

    # ── Celery ──
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

    # ── 模拟模式 ──
    LLM_MOCK: bool = False  # 设为 True 使用 MockLLMClient（测试/演示用）

    # ── 后台任务 ──
    CELERY_ENABLED: bool = False  # 设为 True 时由 Celery Worker 处理异步任务，后台工作者暂停
    BG_IQC_INTERVAL: int = 30  # IQC 质检轮询间隔（秒）
    BG_REFINE_INTERVAL: int = 300  # 记忆提炼轮询间隔（秒）
    BG_DECAY_INTERVAL: int = 1800  # 半衰期检查间隔（秒）

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


# 全局单例
settings = Settings()
