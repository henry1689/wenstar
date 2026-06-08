"""
景幻仙姑 · 砂金库 (Alluvial Vault)
原始数据入水口。只存储，不检索。
用户上传的任何东西先进这里。
"""
from pathlib import Path
from core.database import Database, STATUS_RAW, STATUS_QC_PENDING, STATUS_QC_FAILED
from storage.file_manager import FileManager
from core.schemas import UploadRequest


class AlluvialVault:
    """砂金库：原材料矿井，景幻闲了来筛"""

    def __init__(self, db: Database):
        self.db = db

    async def deposit(self, req: UploadRequest, content: bytes) -> dict:
        """存入砂金库（立即完成，不阻塞）"""
        doc_id = _uid()

        # 保存文件
        file_info = await FileManager.save_file(
            content=content,
            doc_id=doc_id,
            title=req.title,
            vault="alluvial",
            mime_type=req.mime_type,
        )

        # 写入数据库
        doc = {
            "id": doc_id,
            "title": req.title,
            "content": req.content or "",
            "file_path": file_info["file_path"],
            "file_hash": file_info["file_hash"],
            "file_size": file_info["file_size"],
            "mime_type": req.mime_type,
            "source_name": req.source_name or req.title,
            "status": STATUS_RAW,
            "vault": "alluvial",
            "tags": req.tags,
        }

        await self.db.insert_doc(doc)

        # 排入 IQC 队列（除非跳过）
        if req.skip_iqc:
            await self.db.update_status(doc_id, "shelved", "gold")
            await self.db.log_iqc(doc_id, "iqc_skip",
                                   "passed", "小权限通道跳过 IQC")
            vault_final = "gold"
            status_msg = "已直接入金库（跳过IQC）"
        else:
            await self.db.update_status(doc_id, STATUS_QC_PENDING, "alluvial")
            await self.db.log_iqc(doc_id, "iqc_enqueue",
                                   "pending", "已排入 IQC 队列，等待做梦模式处理")
            vault_final = "alluvial"
            status_msg = "已入砂金库，等待质检"

        return {
            "id": doc_id,
            "status": STATUS_QC_PENDING if not req.skip_iqc else "shelved",
            "vault": vault_final,
            "message": status_msg,
            "file_hash": file_info["file_hash"],
        }

    async def get_iqc_pending_count(self) -> int:
        """获取待质检数量"""
        rows = await self.db.search_by_vault("alluvial", "", 999)
        return len([r for r in rows if r["status"] == STATUS_QC_PENDING])

    async def reject(self, doc_id: str, reason: str):
        """质检不通过 → 退回砂金库"""
        await self.db.update_status(doc_id, STATUS_QC_FAILED, "alluvial")
        await self.db.log_iqc(doc_id, "iqc_reject", "failed", reason)

    async def promote_to_gold(self, doc_id: str, tags: list, score: float):
        """质检通过 → 升入金库"""
        # 文件迁移到金库目录
        doc = await self.db.get_doc(doc_id)
        if doc and doc.get("file_path"):
            new_path = await FileManager.move_file(
                doc["file_path"], "gold", doc.get("mime_type", "text/plain"),
                doc_id, doc.get("title", "")
            )
        else:
            new_path = doc.get("file_path") if doc else None

        await self.db.update_status(doc_id, "shelved", "gold")
        if new_path:
            now = _now_iso()
            await self.db.conn.execute(
                "UPDATE documents SET file_path=?, updated_at=? WHERE id=?",
                (new_path, now, doc_id)
            )
            await self.db.conn.commit()

        await self.db.update_tags(doc_id, tags, score)
        await self.db.log_iqc(doc_id, "iqc_promote_gold",
                               "passed", f"质检通过，升入金库")


def _uid() -> str:
    import secrets
    return f"al_{secrets.token_hex(8)}"

def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
