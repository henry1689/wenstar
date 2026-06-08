"""
仿生智脑 · 数据库基础设施 (PostgreSQL + SQLAlchemy 2.0)

管理数据库连接、会话工厂、自动建表。
使用 asyncpg 驱动实现异步操作。
"""
import logging
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import (
    AsyncSession, async_sessionmaker, create_async_engine
)
from sqlalchemy import text

from app.core.config import settings
from app.domain.models import Base

logger = logging.getLogger("bionic.db")


class DatabaseManager:
    """
    PostgreSQL 连接管理器。

    用法:
        db = DatabaseManager()
        await db.initialize()          # 建表
        async with db.session() as s:  # 获取会话
            ...
        await db.close()
    """

    def __init__(self, dsn: Optional[str] = None):
        self.dsn = dsn or settings.POSTGRES_DSN
        self._engine = None
        self._session_factory = None

    async def initialize(self):
        """创建引擎 + 建表"""
        self._engine = create_async_engine(
            self.dsn,
            echo=settings.API_DEBUG,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
        )
        self._session_factory = async_sessionmaker(
            self._engine, class_=AsyncSession, expire_on_commit=False
        )

        # 自动建表
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

        logger.info("数据库连接建立，表结构已就绪")
        return self

    async def session(self) -> AsyncGenerator[AsyncSession, None]:
        """获取数据库会话（用于 FastAPI 依赖注入）"""
        async with self._session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    async def get_session(self) -> AsyncSession:
        """直接获取会话（用于非 API 场景）"""
        return self._session_factory()

    async def health_check(self) -> bool:
        """健康检查"""
        try:
            async with self._session_factory() as session:
                await session.execute(text("SELECT 1"))
            return True
        except Exception as e:
            logger.error(f"数据库健康检查失败: {e}")
            return False

    async def close(self):
        """关闭连接池"""
        if self._engine:
            await self._engine.dispose()
            logger.info("数据库连接已关闭")
