"""
景幻仙姑 · 黑钻库 (Black Diamond Vault)
金丹级珍藏。活跃资料走"高速通讯公路"。
半衰期机制：30天未调用降级金库，90天未调用降级砂金。
晋升条件：调用频次 × 被采纳率。不只是看频次。
"""
from datetime import datetime, timezone
from typing import Optional
from core.database import Database, STATUS_BD_PROMOTED, STATUS_BD_DEMOTED, \
    STATUS_ARCHIVED, STATUS_SHELVED
from core.config import BD_COOLDOWN_DAYS, BD_DEMOTE_DAYS, BD_ARCHIVE_DAYS
from vaults.gold import _doc_to_response
from core.schemas import DocumentResponse


class BlackDiamondVault:
    """黑钻库 — 半衰期+采纳率机制"""

    def __init__(self, db: Database):
        self.db = db

    async def search_active(self, keyword: str, limit: int = 10) -> list[DocumentResponse]:
        """高速通讯公路 — 仅搜索活跃的黑钻资料"""
        results = await self.db.search_by_vault("black_diamond", keyword, limit)
        active = [r for r in results if r.get("call_count", 0) > 0]
        for r in active:
            await self.db.increment_call(r["id"])
            await self.db.log_call(r["id"], "yuyao_highway")
        return [_doc_to_response(r) for r in active[:limit]]

    async def promote(self, doc_id: str, adoption_rate: float = 1.0) -> bool:
        """升入黑钻库（采纳率是核心条件）"""
        doc = await self.db.get_doc(doc_id)
        if not doc:
            return False
        from storage.file_manager import FileManager
        if doc.get("file_path"):
            new_path = await FileManager.move_file(
                doc["file_path"], "black_diamond",
                doc.get("mime_type", "text/plain"),
                doc_id, doc.get("title", "")
            )
            if new_path:
                now = _now_iso()
                await self.db.conn.execute(
                    "UPDATE documents SET file_path=?, updated_at=? WHERE id=?",
                    (new_path, now, doc_id)
                )
                await self.db.conn.commit()
        await self.db.update_status(doc_id, STATUS_BD_PROMOTED, "black_diamond")
        await self.db.log_iqc(doc_id, "bd_promote",
                               "promoted", f"晋升黑钻 (采纳率={adoption_rate:.2f})")
        return True

    async def demote_inactive(self, dry_run: bool = True) -> list[str]:
        """
        半衰期降级机制：
        - 30天未调用 → 降级回金库
        - 90天未调用 → 归档回砂金库
        """
        now = datetime.now(timezone.utc)
        demoted = []
        cursor = await self.db.conn.execute(
            "SELECT * FROM documents WHERE vault='black_diamond' AND status='bd_promoted'"
        )
        rows = await cursor.fetchall()
        for row in rows:
            doc = dict(row)
            last_called = doc.get("last_called_at")
            if not last_called:
                continue
            try:
                last = datetime.fromisoformat(last_called)
            except (ValueError, TypeError):
                continue
            days = (now - last).days

            if days >= BD_ARCHIVE_DAYS:
                # 90天 → 归档砂金库
                demoted.append(f"{doc['id']}(archive)")
                if not dry_run:
                    from storage.file_manager import FileManager
                    if doc.get("file_path"):
                        await FileManager.move_file(
                            doc["file_path"], "alluvial",
                            doc.get("mime_type", "text/plain"),
                            doc["id"], doc.get("title", "")
                        )
                    await self.db.update_status(doc["id"], STATUS_ARCHIVED, "alluvial")
                    await self.db.log_iqc(doc["id"], "bd_archive",
                                           "archived", f"{days}天未调用，归档回砂金库")

            elif days >= BD_DEMOTE_DAYS:
                # 30天 → 降级金库
                demoted.append(f"{doc['id']}(demote)")
                if not dry_run:
                    from storage.file_manager import FileManager
                    if doc.get("file_path"):
                        await FileManager.move_file(
                            doc["file_path"], "gold",
                            doc.get("mime_type", "text/plain"),
                            doc["id"], doc.get("title", "")
                        )
                    await self.db.update_status(doc["id"], STATUS_BD_DEMOTED, "gold")
                    await self.db.log_iqc(doc["id"], "bd_demote",
                                           "demoted", f"{days}天未调用，降级回金库")
        return demoted

    async def evaluate_candidates(self) -> list[dict]:
        """
        晋升评估：调用频次 × 被采纳率。
        被采纳率 = 有意义的调用 / 总调用次数（简单版本用 quality_score 替代）
        """
        candidates = await self.db.get_candidates_for_bd(20)
        evaluated = []
        for doc in candidates:
            days_since = _days_since(doc.get("created_at", ""))
            if days_since < BD_COOLDOWN_DAYS:
                continue
            freq = doc.get("call_count", 0) / max(days_since, 1)
            adoption = doc.get("quality_score", 0.0) or 0.0
            threshold = min(1.0, freq * 2.0 + adoption * 0.3)
            evaluated.append({
                "id": doc["id"],
                "title": doc["title"],
                "frequency": round(freq, 4),
                "adoption_rate": round(adoption, 4),
                "threshold": round(threshold, 4),
                "promotable": threshold >= 0.5,
                "days_since_created": days_since,
            })
        evaluated.sort(key=lambda x: -x["threshold"])
        return evaluated

    async def get_active_count(self) -> int:
        return await self.db.fetch_val(
            "SELECT COUNT(*) FROM documents WHERE vault='black_diamond' AND status='bd_promoted'"
        )

def _days_since(iso_str: str) -> int:
    try:
        then = datetime.fromisoformat(iso_str)
        return (datetime.now(timezone.utc) - then).days
    except (ValueError, TypeError):
        return 999

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
