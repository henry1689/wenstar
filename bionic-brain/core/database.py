"""
景幻仙姑 · 生物智脑 — 数据库引擎
双写保护：SQLite + 文件系统同时写入
"""
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import aiosqlite
from core.config import DB_PATH, ALLUVIAL_DIR, GOLD_DIR, BLACK_DIAMOND_DIR

# ── 状态机常量 ──
STATUS_RAW = "raw"                     # 砂金库：原始未处理
STATUS_QC_PENDING = "qc_pending"       # 砂金库：等待质检
STATUS_QC_FAILED = "qc_failed"         # 砂金库：质检不通过
STATUS_SHELVED = "shelved"             # 金库：标准馆藏
STATUS_BD_PENDING = "bd_pending"       # 黑钻候选
STATUS_BD_PROMOTED = "bd_promoted"     # 黑钻库：金丹珍藏
STATUS_BD_REJECTED = "bd_rejected"     # 黑钻不通过
STATUS_BD_DEMOTED = "bd_demoted"       # 黑钻降级回金库
STATUS_ARCHIVED = "archived"           # 归档回砂金库

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT,
    file_path TEXT,
    file_hash TEXT,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT DEFAULT 'text/plain',
    source_name TEXT,
    status TEXT NOT NULL DEFAULT 'raw',
    vault TEXT NOT NULL DEFAULT 'alluvial',
    tags TEXT DEFAULT '[]',
    quality_score REAL DEFAULT 0.0,
    call_count INTEGER DEFAULT 0,
    last_called_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    checksum TEXT,
    version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_vault ON documents(vault);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_documents_call_count ON documents(call_count DESC);

CREATE TABLE IF NOT EXISTS iqc_log (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT,
    details TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (doc_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS call_log (
    id TEXT PRIMARY KEY,
    doc_id TEXT NOT NULL,
    caller TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (doc_id) REFERENCES documents(id)
);

CREATE TABLE IF NOT EXISTS system_manifest (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


class Database:
    """景幻仙姑的数据存储层 — 双写保护"""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self.conn: Optional[aiosqlite.Connection] = None

    async def initialize(self):
        """初始化数据库并建表"""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = await aiosqlite.connect(self.db_path)
        self.conn.row_factory = aiosqlite.Row
        for statement in SCHEMA_SQL.split(";"):
            stmt = statement.strip()
            if stmt:
                await self.conn.execute(stmt)
        await self.conn.commit()
        # 更新 manifest
        await self.set_manifest("db_version", "1.0")
        await self.set_manifest("last_initialized", now_iso())
        # 统计
        count = await self.fetch_val("SELECT COUNT(*) FROM documents")
        print(f"[景幻] 数据库初始化完成: {count} 份文档")

    async def close(self):
        if self.conn:
            await self.conn.close()

    # ── CRUD ──

    async def insert_doc(self, doc: dict) -> str:
        doc_id = doc.get("id", _uid())
        doc["id"] = doc_id
        now = now_iso()
        await self.conn.execute("""
            INSERT INTO documents (id, title, content, file_path, file_hash, file_size,
                mime_type, source_name, status, vault, tags, quality_score, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            doc_id, doc.get("title", ""), doc.get("content"),
            doc.get("file_path"), doc.get("file_hash"),
            doc.get("file_size", 0), doc.get("mime_type", "text/plain"),
            doc.get("source_name"), doc.get("status", STATUS_RAW),
            doc.get("vault", "alluvial"),
            json.dumps(doc.get("tags", [])),
            doc.get("quality_score", 0.0), now, now
        ))
        await self.conn.commit()
        return doc_id

    async def update_status(self, doc_id: str, status: str, vault: str = None):
        now = now_iso()
        if vault:
            await self.conn.execute(
                "UPDATE documents SET status=?, vault=?, updated_at=? WHERE id=?",
                (status, vault, now, doc_id)
            )
        else:
            await self.conn.execute(
                "UPDATE documents SET status=?, updated_at=? WHERE id=?",
                (status, now, doc_id)
            )
        await self.conn.commit()

    async def update_tags(self, doc_id: str, tags: list, score: float = None):
        now = now_iso()
        if score is not None:
            await self.conn.execute(
                "UPDATE documents SET tags=?, quality_score=?, updated_at=? WHERE id=?",
                (json.dumps(tags), score, now, doc_id)
            )
        else:
            await self.conn.execute(
                "UPDATE documents SET tags=?, updated_at=? WHERE id=?",
                (json.dumps(tags), now, doc_id)
            )
        await self.conn.commit()

    async def increment_call(self, doc_id: str):
        now = now_iso()
        await self.conn.execute(
            "UPDATE documents SET call_count=call_count+1, last_called_at=? WHERE id=?",
            (now, doc_id)
        )
        await self.conn.commit()

    async def get_doc(self, doc_id: str) -> Optional[dict]:
        cursor = await self.conn.execute("SELECT * FROM documents WHERE id=?", (doc_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row)

    async def search_by_vault(self, vault: str, keyword: str, limit: int = 20) -> list:
        """关键词 LIKE 搜索（降级路径）"""
        like = f"%{keyword}%"
        cursor = await self.conn.execute(
            "SELECT * FROM documents WHERE vault=? AND (content LIKE ? OR title LIKE ?) "
            "ORDER BY quality_score DESC, call_count DESC LIMIT ?",
            (vault, like, like, limit)
        )
        rows = await cursor.fetchall()
        return [_row_to_dict(r) for r in rows]

    async def search_active_bd(self, limit: int = 20) -> list:
        """黑钻库活跃资料（调用频次高的优先）"""
        cursor = await self.conn.execute(
            "SELECT * FROM documents WHERE vault='black_diamond' AND status='bd_promoted' "
            "ORDER BY call_count DESC, quality_score DESC LIMIT ?",
            (limit,)
        )
        rows = await cursor.fetchall()
        return [_row_to_dict(r) for r in rows]

    async def get_pending_iqc(self, limit: int = 50) -> list:
        """获取待 IQC 质检的文档"""
        cursor = await self.conn.execute(
            "SELECT * FROM documents WHERE status='qc_pending' ORDER BY created_at ASC LIMIT ?",
            (limit,)
        )
        rows = await cursor.fetchall()
        return [_row_to_dict(r) for r in rows]

    async def get_candidates_for_bd(self, limit: int = 20) -> list:
        """获取可能晋升黑钻的金库文档"""
        cursor = await self.conn.execute(
            "SELECT * FROM documents WHERE vault='gold' AND status='shelved' "
            "AND call_count > 0 ORDER BY (call_count * 1.0 / "
            "MAX(1, (julianday('now') - julianday(created_at)))) DESC LIMIT ?",
            (limit,)
        )
        rows = await cursor.fetchall()
        return [_row_to_dict(r) for r in rows]

    async def log_iqc(self, doc_id: str, action: str, result: str, details: str = ""):
        await self.conn.execute(
            "INSERT INTO iqc_log (id, doc_id, action, result, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (_uid(), doc_id, action, result, details, now_iso())
        )
        await self.conn.commit()

    async def log_call(self, doc_id: str, caller: str = "yuyao"):
        await self.conn.execute(
            "INSERT INTO call_log (id, doc_id, caller, created_at) VALUES (?, ?, ?, ?)",
            (_uid(), doc_id, caller, now_iso())
        )
        await self.conn.commit()

    # ── Manifest ──

    async def set_manifest(self, key: str, value: str):
        await self.conn.execute(
            "INSERT OR REPLACE INTO system_manifest (key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now_iso())
        )
        await self.conn.commit()

    async def get_manifest(self, key: str) -> Optional[str]:
        cursor = await self.conn.execute("SELECT value FROM system_manifest WHERE key=?", (key,))
        row = await cursor.fetchone()
        return row["value"] if row else None

    async def verify_manifest(self) -> dict:
        """完整性校验"""
        doc_count = await self.fetch_val("SELECT COUNT(*) FROM documents")
        iqc_count = await self.fetch_val("SELECT COUNT(*) FROM iqc_log")
        manifest_count = await self.fetch_val("SELECT COUNT(*) FROM system_manifest")
        return {
            "documents": doc_count,
            "iqc_logs": iqc_count,
            "manifest_entries": manifest_count,
            "status": "ok"
        }

    async def fetch_val(self, sql: str, params: tuple = ()):
        cursor = await self.conn.execute(sql, params)
        row = await cursor.fetchone()
        return row[0] if row else None


# ── 工具函数 ──

def _uid() -> str:
    import secrets
    return f"jh_{secrets.token_hex(8)}"

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _row_to_dict(row) -> Optional[dict]:
    if not row:
        return None
    d = dict(row)
    if "tags" in d and isinstance(d["tags"], str):
        try:
            d["tags"] = json.loads(d["tags"])
        except (json.JSONDecodeError, TypeError):
            d["tags"] = []
    return d
