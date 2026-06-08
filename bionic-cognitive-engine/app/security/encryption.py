"""
仿生智脑 · 安全层

文件加密（AES-256-GCM）与 IQC 质检规则。
"""
import os
import base64
import logging
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger("bionic.security")


class FileEncryptor:
    """
    AES-256-GCM 文件加密器。

    用法:
        encryptor = FileEncryptor(key)
        encrypted = encryptor.encrypt(data)
        decrypted = encryptor.decrypt(encrypted)
    """

    def __init__(self, key: Optional[bytes] = None):
        """key 必须是 32 字节（AES-256）"""
        if key is None:
            key = os.urandom(32)
        self.key = key

    def encrypt(self, data: bytes) -> bytes:
        """加密数据。返回 nonce + ciphertext + tag"""
        aesgcm = AESGCM(self.key)
        nonce = os.urandom(12)  # 96-bit nonce
        return nonce + aesgcm.encrypt(nonce, data, None)

    def decrypt(self, data: bytes) -> Optional[bytes]:
        """解密数据。输入 nonce + ciphertext + tag"""
        try:
            aesgcm = AESGCM(self.key)
            nonce = data[:12]
            ciphertext = data[12:]
            return aesgcm.decrypt(nonce, ciphertext, None)
        except Exception as e:
            logger.error(f"解密失败: {e}")
            return None

    @staticmethod
    def generate_key() -> bytes:
        """生成新的 32 字节密钥"""
        return os.urandom(32)

    @staticmethod
    def key_to_base64(key: bytes) -> str:
        return base64.b64encode(key).decode()

    @staticmethod
    def key_from_base64(b64: str) -> bytes:
        return base64.b64decode(b64)


class IQCRules:
    """IQC 质检规则定义"""

    # 文件大小限制
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB

    # 支持的文件类型
    SUPPORTED_TEXT_EXTENSIONS = {
        ".txt", ".md", ".json", ".yaml", ".yml",
        ".py", ".js", ".ts", ".rs", ".go", ".java",
        ".html", ".css", ".xml", ".csv",
    }

    SUPPORTED_BINARY_EXTENSIONS = {
        ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp",
        ".mp3", ".wav", ".ogg",
        ".mp4", ".avi", ".mov",
        ".pdf", ".doc", ".docx",
    }

    @classmethod
    def is_supported(cls, filename: str) -> bool:
        """检查文件类型是否被支持"""
        ext = os.path.splitext(filename)[1].lower()
        return ext in cls.SUPPORTED_TEXT_EXTENSIONS or \
               ext in cls.SUPPORTED_BINARY_EXTENSIONS

    @classmethod
    def check_size(cls, size: int) -> dict:
        """检查文件大小"""
        if size <= 0:
            return {"valid": False, "reason": "空文件"}
        if size > cls.MAX_FILE_SIZE:
            return {"valid": False, "reason": f"超过大小限制 ({cls.MAX_FILE_SIZE//1024//1024}MB)"}
        return {"valid": True, "size_mb": round(size / 1024 / 1024, 2)}
