"""
仿生智脑 · API 依赖注入

提供 FastAPI 依赖函数，统一管理数据库会话、认证和服务实例。
"""
import logging
from typing import AsyncGenerator, Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.infrastructure.database import DatabaseManager

logger = logging.getLogger("bionic.deps")

# ── 数据库管理器全局单例 ──
db_manager = DatabaseManager()

# ── Bearer Token 认证 ──
security = HTTPBearer(auto_error=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    数据库会话依赖。

    用法:
        @router.get("/items")
        async def get_items(db: AsyncSession = Depends(get_db)):
            ...
    """
    async for session in db_manager.session():
        yield session


async def verify_token(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> bool:
    """
    Bearer Token 验证。

    如果 API_SECRET_KEY 是默认值，跳过认证（开发模式）。
    否则检查 Bearer Token 是否匹配。
    """
    if settings.API_SECRET_KEY == "change-me-to-a-random-64-char-string":
        return True  # 开发模式，不鉴权

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少认证 Token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if credentials.credentials != settings.API_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token 无效",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return True
