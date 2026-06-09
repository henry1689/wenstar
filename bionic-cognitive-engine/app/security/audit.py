"""
仿生智脑 · 审计金库 (Audit Vault)

所有操作全量记录，不可篡改的审计追踪。

设计原则：
  - 写前追加：日志只增不减，不覆盖不删除
  - 链式校验：每条日志包含上一条的 SHA256，形成哈希链
  - 双写策略：同时写入 SQLite 审计库 + 日志文件
  - 不可篡改：修改任意一条会破坏整个哈希链
"""
import hashlib
import json
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger("bionic.audit")


class AuditVault:
    """
    仿生智脑的审计金库。

    用法:
        audit = AuditVault()
        audit.record("user_login", {"user_id": "xxx", "ip": "..."})
        audit.record("vault_delete", {"doc_id": "xxx", "user_id": "xxx"})

    查看审计日志:
        audit.query(user_id="xxx", limit=20)
        audit.export_json()
    """

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or str(
            Path(__file__).parent.parent.parent / "data" / "audit.db"
        )
        self._lock = threading.Lock()
        self._ensure_db()
        self._last_hash = self._get_last_hash()

    # ── 记录审计事件 ──

    def record(
        self,
        action: str,
        detail: Optional[dict] = None,
        user_id: Optional[str] = None,
        ip: Optional[str] = None,
    ) -> str:
        """
        记录一条审计事件。

        Args:
            action: 操作类型 (如 'doc_upload', 'doc_delete', 'vault_promote', 'login')
            detail: 操作详情 (JSON dict)
            user_id: 操作用户 ID
            ip: 请求来源 IP

        Returns:
            审计记录 ID (au_xxx)
        """
        import secrets
        record_id = f"au_{secrets.token_hex(8)}"
        now = datetime.now(timezone.utc).isoformat()

        # 构建内容字符串（用于计算哈希）
        content = json.dumps({
            "id": record_id,
            "action": action,
            "detail": detail or {},
            "user_id": user_id or "system",
            "ip": ip or "internal",
            "timestamp": now,
            "previous_hash": self._last_hash,
        }, ensure_ascii=False, sort_keys=True)

        # SHA256 链式哈希
        current_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

        with self._lock:
            try:
                conn = sqlite3.connect(self.db_path)
                conn.execute("""
                    INSERT INTO audit_chain
                    (id, action, detail, user_id, ip, timestamp,
                     previous_hash, current_hash, content_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    record_id, action,
                    json.dumps(detail or {}, ensure_ascii=False),
                    user_id or "system", ip or "internal", now,
                    self._last_hash, current_hash, content,
                ))
                conn.commit()
                conn.close()

                self._last_hash = current_hash
                logger.info(f"AUDIT [{action}] user={user_id or 'system'} id={record_id}")

            except Exception as e:
                logger.error(f"审计记录失败: {e}")

        return record_id

    # ── 查询审计日志 ──

    def query(
        self,
        user_id: Optional[str] = None,
        action: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list:
        """查询审计日志"""
        conditions = []
        params = []

        if user_id:
            conditions.append("user_id = ?")
            params.append(user_id)
        if action:
            conditions.append("action = ?")
            params.append(action)

        where = " AND ".join(conditions) if conditions else "1=1"

        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                f"SELECT * FROM audit_chain WHERE {where} ORDER BY rowid DESC LIMIT ? OFFSET ?",
                (*params, limit, offset)
            )
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()
            return rows
        except Exception as e:
            logger.error(f"审计查询失败: {e}")
            return []

    # ── 哈希链验证 ──

    def verify_chain(self) -> dict:
        """
        验证审计哈希链的完整性。

        Returns:
            {"valid": bool, "records": int, "breaks": [...]}
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(
                "SELECT * FROM audit_chain ORDER BY rowid ASC"
            )
            rows = [dict(r) for r in cursor.fetchall()]
            conn.close()

            breaks = []
            prev_hash = ""

            for r in rows:
                # 重建内容
                content = json.dumps({
                    "id": r["id"],
                    "action": r["action"],
                    "detail": json.loads(r["detail"] or "{}"),
                    "user_id": r["user_id"],
                    "ip": r["ip"],
                    "timestamp": r["timestamp"],
                    "previous_hash": prev_hash,
                }, ensure_ascii=False, sort_keys=True)

                expected_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()

                if expected_hash != r["current_hash"]:
                    breaks.append({
                        "id": r["id"],
                        "detail": "哈希不匹配，内容可能被篡改",
                    })
                elif r["previous_hash"] != prev_hash:
                    breaks.append({
                        "id": r["id"],
                        "detail": "前向哈希链接断裂",
                    })

                prev_hash = r["current_hash"]

            return {
                "valid": len(breaks) == 0,
                "records": len(rows),
                "breaks": breaks,
            }

        except Exception as e:
            return {"valid": False, "records": 0, "breaks": [{"detail": str(e)}]}

    # ── 导出 ──

    def export_json(self, limit: int = 1000) -> str:
        """导出审计日志为 JSON 字符串"""
        rows = self.query(limit=limit)
        return json.dumps(rows, ensure_ascii=False, indent=2)

    # ── 内部 ──

    def _ensure_db(self):
        """确保审计数据库存在"""
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_chain (
                    id TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    detail TEXT,
                    user_id TEXT,
                    ip TEXT,
                    timestamp TEXT NOT NULL,
                    previous_hash TEXT NOT NULL,
                    current_hash TEXT NOT NULL,
                    content_json TEXT NOT NULL
                )
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_chain(action)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_chain(user_id)
            """)
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_chain(timestamp)
            """)
            conn.commit()
            conn.close()
        except Exception as e:
            logger.error(f"审计数据库初始化失败: {e}")

    def _get_last_hash(self) -> str:
        """获取最后一条记录的哈希"""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.execute(
                "SELECT current_hash FROM audit_chain ORDER BY rowid DESC LIMIT 1"
            )
            row = cursor.fetchone()
            conn.close()
            return row[0] if row else ""
        except Exception:
            return ""
