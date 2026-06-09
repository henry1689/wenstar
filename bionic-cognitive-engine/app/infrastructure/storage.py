"""
仿生智脑 · MinIO 对象存储客户端

存储砂金库的原始文件。
使用 AES-256-GCM 加密敏感内容。
"""
import io
import logging
from typing import Optional, Tuple

from minio import Minio
from minio.error import S3Error

from app.core.config import settings

logger = logging.getLogger("bionic.storage")


class StorageManager:
    """
    MinIO 对象存储管理器。

    用法:
        storage = StorageManager()
        storage.initialize()
        storage.upload_file("obj_key", data, length)
        data = storage.download_file("obj_key")
    """

    def __init__(
        self,
        endpoint: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
        bucket: Optional[str] = None,
        encryptor: Optional[object] = None,
    ):
        self.endpoint = endpoint or settings.MINIO_ENDPOINT
        self.access_key = access_key or settings.MINIO_ACCESS_KEY
        self.secret_key = secret_key or settings.MINIO_SECRET_KEY
        self.bucket = bucket or settings.MINIO_BUCKET
        self._client: Optional[Minio] = None
        # AES-256-GCM 加密器（由 main.py 初始化时注入）
        # 所有上传的文件先加密再存储，下载时自动解密
        self.encryptor = encryptor

    def initialize(self) -> bool:
        """初始化 MinIO 客户端 + 确保 bucket 存在"""
        try:
            self._client = Minio(
                endpoint=self.endpoint,
                access_key=self.access_key,
                secret_key=self.secret_key,
                secure=False,  # 内部网络，不启用 TLS
            )
            # 检查 bucket
            if not self._client.bucket_exists(self.bucket):
                self._client.make_bucket(self.bucket)
                logger.info(f"MinIO bucket '{self.bucket}' 已创建")
            else:
                logger.info(f"MinIO bucket '{self.bucket}' 已存在")

            return True

        except Exception as e:
            logger.warning(f"MinIO 初始化失败: {e}")
            self._client = None
            return False

    @property
    def available(self) -> bool:
        return self._client is not None

    def upload_file(self, object_key: str, data: bytes) -> bool:
        """上传文件到 MinIO（自动 AES-256-GCM 加密）"""
        if not self.available:
            return False
        try:
            # 加密后再上传（若有加密器）
            final_data = data
            if self.encryptor:
                final_data = self.encryptor.encrypt(data)

            self._client.put_object(
                bucket_name=self.bucket,
                object_name=object_key,
                data=io.BytesIO(final_data),
                length=len(final_data),
                content_type="application/octet-stream",
            )
            return True
        except S3Error as e:
            logger.error(f"MinIO 上传失败: {e}")
            return False

    def download_file(self, object_key: str) -> Optional[bytes]:
        """从 MinIO 下载文件（自动 AES-256-GCM 解密）"""
        if not self.available:
            return None
        try:
            response = self._client.get_object(self.bucket, object_key)
            encrypted_data = response.read()
            response.close()
            response.release_conn()

            # 解密后返回（若有加密器）
            if self.encryptor and encrypted_data:
                return self.encryptor.decrypt(encrypted_data)
            return encrypted_data
        except S3Error as e:
            logger.error(f"MinIO 下载失败: {e}")
            return None

    def delete_file(self, object_key: str) -> bool:
        """从 MinIO 删除文件"""
        if not self.available:
            return False
        try:
            self._client.remove_object(self.bucket, object_key)
            return True
        except S3Error as e:
            logger.error(f"MinIO 删除失败: {e}")
            return False

    def list_files(self, prefix: str = "") -> list:
        """列出文件"""
        if not self.available:
            return []
        try:
            objects = self._client.list_objects(self.bucket, prefix=prefix)
            return [{"name": o.object_name, "size": o.size, "etag": o.etag} for o in objects]
        except S3Error as e:
            logger.error(f"MinIO 列举失败: {e}")
            return []

    def health_check(self) -> bool:
        """健康检查"""
        try:
            if not self._client:
                return False
            self._client.bucket_exists(self.bucket)
            return True
        except Exception:
            return False
