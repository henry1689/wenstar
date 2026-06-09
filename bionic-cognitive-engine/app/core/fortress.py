"""
仿生智脑 · 堡垒配置 (Fortress Config)

系统加固的核心配置验证层。

职责:
  1. 启动时验证所有配置项合法性
  2. 检测运行环境安全性
  3. 提供系统健康状态报告
  4. 配置变更审计
"""
import logging
import os
import socket
import sys
from datetime import datetime, timezone
from typing import List, Optional

from app.core.config import settings

logger = logging.getLogger("bionic.fortress")


class FortressGuard:
    """
    仿生智脑的堡垒守卫。

    启动时执行一系列安全检查，确保系统在安全状态下运行。
    """

    def __init__(self):
        self._checks: List[dict] = []

    # ── 安全检查 ──

    def run_all_checks(self) -> dict:
        """运行全部安全检查"""
        self._checks = []
        self._check_secret_key()
        self._check_postgres_dsn()
        self._check_api_debug()
        self._check_minio_tls()
        self._check_data_dirs()
        return self.report()

    def _check_secret_key(self):
        """检查 API_SECRET_KEY 是否为默认值"""
        if settings.API_SECRET_KEY == "change-me-to-a-random-64-char-string":
            self._checks.append({
                "level": "🔴",
                "module": "配置",
                "message": "API_SECRET_KEY 使用默认值，生产环境必须修改",
                "fix": "在 .env 中设置 API_SECRET_KEY 为一个 64 字符随机字符串",
            })
        elif len(settings.API_SECRET_KEY) < 32:
            self._checks.append({
                "level": "🟡",
                "module": "配置",
                "message": f"API_SECRET_KEY 长度 {len(settings.API_SECRET_KEY)}，建议 >= 32 字符",
                "fix": "增加 API_SECRET_KEY 长度到至少 32 字符",
            })
        else:
            self._checks.append({
                "level": "✅",
                "module": "配置",
                "message": "API_SECRET_KEY 已配置",
            })

    def _check_api_debug(self):
        """检查是否在生产模式"""
        if settings.API_DEBUG:
            self._checks.append({
                "level": "🟡",
                "module": "配置",
                "message": "API_DEBUG=True，生产环境应关闭",
                "fix": "设置 API_DEBUG=false",
            })

    def _check_postgres_dsn(self):
        """检查数据库连接安全"""
        dsn = settings.POSTGRES_DSN
        if "localhost" in dsn or "127.0.0.1" in dsn:
            self._checks.append({
                "level": "✅",
                "module": "数据库",
                "message": "PostgreSQL 本地连接",
            })
        else:
            # 远程数据库，检查是否使用 SSL
            # （生产环境应使用 sslmode=require）
            if "sslmode" not in dsn.lower():
                self._checks.append({
                    "level": "🟡",
                    "module": "数据库",
                    "message": "远程 PostgreSQL 未启用 SSL",
                    "fix": "在 DSN 中添加 ?sslmode=require",
                })

    def _check_minio_tls(self):
        """检查 MinIO 安全"""
        self._checks.append({
            "level": "🟡",
            "module": "存储",
            "message": "MinIO 使用非 TLS 连接（内部网络可接受）",
            "fix": "生产环境应启用 MinIO TLS",
        })

    def _check_data_dirs(self):
        """检查数据目录权限"""
        from pathlib import Path
        base = Path(__file__).parent.parent.parent

        # 检查 .env 文件权限
        env_file = base / ".env"
        if env_file.exists():
            # 在 Windows 上检查 ACL 太复杂，简单检查是否存在
            self._checks.append({
                "level": "🟡",
                "module": "文件",
                "message": ".env 文件存在，请确保只有授权用户可读",
                "fix": "Windows: 右键 .env → 属性 → 安全 → 移除 Everyone",
            })

        # 检查 data 目录
        data_dir = base / "data"
        data_dir.mkdir(exist_ok=True)
        self._checks.append({
            "level": "✅",
            "module": "文件",
            "message": "data/ 目录已就绪",
        })

    # ── 报告 ──

    def report(self) -> dict:
        """生成安全检查报告"""
        passed = sum(1 for c in self._checks if c["level"] == "✅")
        warnings = sum(1 for c in self._checks if c["level"] == "🟡")
        errors = sum(1 for c in self._checks if c["level"] == "🔴")

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "hostname": socket.gethostname(),
            "summary": {
                "total": len(self._checks),
                "passed": passed,
                "warnings": warnings,
                "errors": errors,
            },
            "checks": self._checks,
        }

    def is_safe(self) -> bool:
        """是否可以安全运行（没有致命错误）"""
        return not any(c["level"] == "🔴" for c in self._checks)

    def print_report(self):
        """打印可视化报告（终端环境可能不支持 emoji）"""
        level_map = {"✅": "[OK]", "🟡": "[WARN]", "🔴": "[ERR]"}
        fix_map = {"🔧": "  FIX:"}
        print("\n" + "=" * 55)
        print("  仿生智脑 · 堡垒安全检查报告")
        print("=" * 55)
        for c in self._checks:
            icon = level_map.get(c["level"], c["level"])
            print(f"  {icon} [{c['module']}] {c['message']}")
            if c.get("fix"):
                print(f"     {fix_map.get('🔧','')} {c['fix']}")
        print("=" * 55)
        s = self.report()["summary"]
        print(f"  [OK] {s['passed']}  [WARN] {s['warnings']}  [ERR] {s['errors']}")
        print("=" * 55)
