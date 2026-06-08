"""
景幻仙姑 · 生物智脑 — 数据模式 (Pydantic)
"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class UploadRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    content: Optional[str] = None
    source_name: Optional[str] = None
    mime_type: str = "text/plain"
    tags: list[str] = []
    skip_iqc: bool = False  # 小权限通道


class UploadResponse(BaseModel):
    id: str
    status: str
    vault: str
    message: str


class SearchRequest(BaseModel):
    keyword: str = Field(..., min_length=1)
    vault: Optional[str] = None  # 指定搜索哪个库
    limit: int = 10


class DocumentResponse(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    status: str
    vault: str
    tags: list[str] = []
    quality_score: float = 0.0
    call_count: int = 0
    last_called_at: Optional[str] = None
    created_at: str
    updated_at: str
    version: int = 1


class IQCReport(BaseModel):
    doc_id: str
    format_check: bool = False
    sha256_check: Optional[str] = None
    vector_similarity: Optional[float] = None
    is_duplicate: bool = False
    tags: list[str] = []
    quality_score: float = 0.0
    passed: bool = False
    details: str = ""


class HealthResponse(BaseModel):
    status: str
    version: str = "1.0"
    uptime: float = 0.0
    documents: int = 0
    iqc_pending: int = 0
    vaults: dict = {}
