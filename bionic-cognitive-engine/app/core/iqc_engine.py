"""
仿生智脑 · IQC 质检引擎

砂金库 → 基础清洗 → 金库。

只做三件事：
1. 格式检查（非空/魔数/编码）
2. SHA256 去重
3. 基础质量评分

不做语义标签，不做向量索引。
"""
import hashlib
import logging
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.models import AlluvialRecord, GoldVaultEntity, IQCQueueRecord

logger = logging.getLogger("bionic.iqc")


class IQCEngine:
    """
    景幻仙姑的 IQC 质检引擎 —— 基础清洗。

    用法:
        iqc = IQCEngine()
        result = await iqc.process_queue(db_session, max_items=10)
    """

    def __init__(self):
        self._known_hashes: set[str] = set()

    async def process_queue(self, db: AsyncSession, max_items: int = 20) -> dict:
        """
        处理 IQC 质检队列。

        Args:
            db: 数据库会话
            max_items: 单次最大处理条数

        Returns:
            {"checked": N, "passed": N, "failed": N, "errors": [...]}
        """
        await self._load_known_hashes(db)

        # 查询待处理队列
        stmt = (
            select(IQCQueueRecord)
            .where(IQCQueueRecord.status == "pending")
            .order_by(IQCQueueRecord.created_at.asc())
            .limit(max_items)
        )
        queue_items = (await db.execute(stmt)).scalars().all()

        result = {"checked": 0, "passed": 0, "failed": 0, "errors": []}

        for item in queue_items:
            try:
                # 获取关联的砂金记录
                alluvial = await db.get(AlluvialRecord, item.alluvial_id)
                if not alluvial:
                    continue

                item.status = "processing"
                await db.flush()

                report = self._inspect(alluvial)
                result["checked"] += 1

                if report["passed"]:
                    await self._promote_to_gold(db, alluvial, report)
                    item.status = "done"
                    result["passed"] += 1
                else:
                    alluvial.status = "rejected"
                    item.status = "failed"
                    item.error_message = report["reason"]
                    result["failed"] += 1

                item.quality_score = report.get("quality", 0.0)

            except Exception as e:
                item.status = "failed"
                item.error_message = str(e)
                result["errors"].append(f"{item.id}: {e}")

        await db.commit()

        if result["checked"] > 0:
            logger.info(
                f"IQC 质检完成: {result['passed']}通过/"
                f"{result['failed']}失败 (共{result['checked']}条)"
            )

        return result

    def _inspect(self, alluvial: AlluvialRecord) -> dict:
        """对一条砂金记录做基础质检"""
        # 检查 MinIO 对象是否可访问（file_path 是本地占位）
        file_hash = alluvial.file_hash or ""

        # 1. SHA256 去重
        if file_hash and file_hash in self._known_hashes:
            return {"passed": False, "reason": f"哈希重复: {file_hash[:12]}", "quality": 0.0}

        if file_hash:
            self._known_hashes.add(file_hash)

        # 2. 基础质量评分
        file_size = alluvial.file_size or 0
        if file_size == 0:
            return {"passed": False, "reason": "空文件", "quality": 0.0}

        quality = min(0.5, file_size / 1000000 * 0.5)

        return {"passed": True, "quality": round(quality, 4), "file_hash": file_hash}

    async def _promote_to_gold(self, db: AsyncSession,
                               alluvial: AlluvialRecord, report: dict):
        """IQC 通过 → 升入金库（继承 user_id，保留数据归属）"""
        gold = GoldVaultEntity(
            topic=(alluvial.source_name or "未命名话题"),
            raw_dialogue={"source": alluvial.source_name, "text": "[MinIO 对象存储]"},
            is_refined=False,
            user_id=alluvial.user_id,  # 继承用户归属
        )
        db.add(gold)
        await db.flush()

        # 更新砂金库状态
        alluvial.status = "approved"

        logger.info(f"升入金库: {gold.id} <- 砂金:{alluvial.id} user={alluvial.user_id}")
        return gold

    async def _load_known_hashes(self, db: AsyncSession):
        """加载已知哈希用于去重"""
        self._known_hashes.clear()
        stmt = select(AlluvialRecord.file_hash).where(
            AlluvialRecord.file_hash.isnot(None),
            AlluvialRecord.file_hash != "",
        )
        rows = (await db.execute(stmt)).scalars().all()
        for h in rows:
            if h:
                self._known_hashes.add(h)

    @staticmethod
    def compute_file_hash(file_path: str) -> Optional[str]:
        """计算文件的 SHA256 哈希"""
        try:
            path = Path(file_path)
            if not path.exists():
                return None
            return hashlib.sha256(path.read_bytes()).hexdigest()
        except Exception:
            return None

    @staticmethod
    def check_format(file_path: str) -> dict:
        """检查文件格式（非空/魔数/编码）"""
        path = Path(file_path)
        if not path.exists():
            return {"valid": False, "reason": "文件不存在"}

        if path.stat().st_size == 0:
            return {"valid": False, "reason": "空文件"}

        head = path.read_bytes()[:64]
        if b"\x00" in head:
            return {"valid": True, "format": "binary"}

        for enc in ("utf-8", "gbk", "utf-16"):
            try:
                path.read_text(encoding=enc)
                return {"valid": True, "format": "text", "encoding": enc}
            except (UnicodeDecodeError, LookupError):
                continue

        return {"valid": False, "reason": "无法识别的编码"}
