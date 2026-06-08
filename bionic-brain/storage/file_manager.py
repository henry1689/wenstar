"""
景幻仙姑 · 生物智脑 — 文件系统管理器
双写保护：SQLite + 文件系统同时写入
"""
import hashlib
import shutil
from pathlib import Path
import aiofiles
from core.config import ALLUVIAL_DIR, GOLD_DIR, BLACK_DIAMOND_DIR, TMP_DIR


class FileManager:
    """文件系统管理器 — 三库文件存储 + 双写保护"""

    @staticmethod
    def vault_dir(vault: str) -> Path:
        return {
            "alluvial": ALLUVIAL_DIR,
            "gold": GOLD_DIR,
            "black_diamond": BLACK_DIAMOND_DIR,
        }.get(vault, ALLUVIAL_DIR)

    @staticmethod
    def classify_mime(mime_type: str) -> str:
        """根据 MIME 类型分类到子目录"""
        if mime_type.startswith("image/"):
            return "images"
        elif mime_type.startswith("video/"):
            return "videos"
        elif mime_type in ("application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                           "application/vnd.ms-excel", "text/csv"):
            return "data"
        else:
            return "docs"

    @staticmethod
    def sha256(content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    @staticmethod
    async def save_file(content: bytes, doc_id: str, title: str, vault: str, mime_type: str) -> dict:
        """保存文件到对应金库目录，返回路径和哈希"""
        subdir = FileManager.classify_mime(mime_type)
        dest_dir = FileManager.vault_dir(vault) / subdir
        dest_dir.mkdir(parents=True, exist_ok=True)

        # 安全文件名
        safe_name = "".join(c for c in title if c.isalnum() or c in "._- ").strip()[:80]
        if not safe_name:
            safe_name = doc_id[:16]
        ext = _mime_ext(mime_type)
        filename = f"{safe_name}{ext}"
        filepath = dest_dir / filename

        # 防重名
        counter = 1
        while filepath.exists():
            filepath = dest_dir / f"{safe_name}_{counter}{ext}"
            counter += 1

        # 写入文件
        async with aiofiles.open(filepath, "wb") as f:
            await f.write(content)

        # 计算哈希
        file_hash = FileManager.sha256(content)

        return {
            "file_path": str(filepath),
            "file_hash": file_hash,
            "file_size": len(content),
        }

    @staticmethod
    async def read_file(file_path: str) -> Optional[bytes]:
        try:
            async with aiofiles.open(file_path, "rb") as f:
                return await f.read()
        except (FileNotFoundError, OSError):
            return None

    @staticmethod
    async def delete_file(file_path: str):
        try:
            path = Path(file_path)
            if path.exists():
                path.unlink()
        except OSError:
            pass

    @staticmethod
    async def move_file(src_path: str, dest_vault: str, mime_type: str, doc_id: str, title: str) -> Optional[str]:
        """文件在三个金库间迁移"""
        content = await FileManager.read_file(src_path)
        if not content:
            return None
        info = await FileManager.save_file(content, doc_id, title, dest_vault, mime_type)
        return info["file_path"]


def _mime_ext(mime_type: str) -> str:
    ext_map = {
        "text/plain": ".txt", "text/markdown": ".md",
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
        "video/mp4": ".mp4", "video/x-msvideo": ".avi",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
        "text/csv": ".csv", "application/json": ".json",
    }
    return ext_map.get(mime_type, ".dat")
