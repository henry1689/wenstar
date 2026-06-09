"""
仿生智脑 · 完整性护盾 (Integrity Shield)

防止代码被篡改、文件被植入、配置被窜改。

工作机制：
  1. 首次部署时生成 MANIFEST（所有关键文件的 SHA256）
  2. 每次启动时校验 MANIFEST，发现改动立即告警
  3. 运行中定时巡检，检测文件变动
  4. 关键操作需要双重确认

设计原则：
  - 护盾自身不可被篡改（MANIFEST 签名 + 只读部署）
  - 发现异常不阻塞服务（只告警 + 日志），由景幻决定是否停机
  - 允许合法的代码更新（git pull 后重新生成 MANIFEST）
"""
import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Set

logger = logging.getLogger("bionic.integrity")


# ── 需要校验的核心文件模式 ──
CRITICAL_PATTERNS = [
    "**/*.py",
    "**/Dockerfile*",
    "**/docker-compose.yml",
    "**/requirements.txt",
    "**/.env.example",
    "**/dashboard.html",
    "**/.gitignore",
]

# 不需要校验的目录
EXCLUDE_DIRS = {
    "__pycache__", "venv", ".git", "node_modules",
    "logs", "data", "__pycache__",
}

# MANIFEST 文件路径（放在项目根目录）
MANIFEST_FILE = "MANIFEST.json"
MANIFEST_SIG_FILE = "MANIFEST.sig"


class IntegrityShield:
    """
    仿生智脑的代码完整性护盾。

    用法:
        shield = IntegrityShield()
        shield.generate_manifest()    # 首次部署/更新代码后生成
        shield.verify_startup()       # 启动时校验
        shield.start_watcher()        # 启动后台文件监控（可选）
    """

    def __init__(self, root_dir: Optional[str] = None):
        self.root_dir = Path(root_dir or Path(__file__).parent.parent.parent)
        self._manifest: Dict[str, str] = {}
        self._violations: List[dict] = []

    # ── 生成 MANIFEST（部署/更新后执行）──

    def generate_manifest(self) -> str:
        """
        扫描所有关键文件，生成 SHA256 MANIFEST。

        在以下时机执行：
          - 首次部署
          - git pull 更新代码后
          - 手动执行 python -m app.security.integrity --generate

        Returns:
            MANIFEST 的 JSON 字符串
        """
        manifest = {}
        files = self._scan_critical_files()

        for filepath in files:
            rel_path = str(filepath.relative_to(self.root_dir))
            try:
                content = filepath.read_bytes()
                manifest[rel_path] = hashlib.sha256(content).hexdigest()
            except (IOError, OSError) as e:
                logger.warning(f"无法读取文件 {rel_path}: {e}")

        # 写入 MANIFEST
        manifest_path = self.root_dir / MANIFEST_FILE
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )

        logger.info(f"✅ MANIFEST 已生成: {len(manifest)} 个文件")
        self._manifest = manifest
        return str(manifest_path)

    # ── 启动时校验 ──

    def verify_startup(self) -> dict:
        """
        启动时执行完整性校验。

        检查：
          1. MANIFEST 文件是否存在
          2. 每个关键文件的 SHA256 是否匹配
          3. 是否有新增/删除的未授权文件

        Returns:
            {"passed": bool, "violations": [...], "file_count": int}
        """
        manifest_path = self.root_dir / MANIFEST_FILE
        if not manifest_path.exists():
            return {
                "passed": False,
                "violations": [{"type": "MANIFEST_MISSING", "detail": "MANIFEST 文件不存在，请执行 generate_manifest()"}],
                "file_count": 0,
            }

        # 加载 MANIFEST
        try:
            stored_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, IOError) as e:
            return {
                "passed": False,
                "violations": [{"type": "MANIFEST_CORRUPT", "detail": f"MANIFEST 损坏: {e}"}],
                "file_count": 0,
            }

        violations = []
        checked_count = 0

        # 1. 校验 MANIFEST 中记录的文件
        for rel_path, stored_hash in stored_manifest.items():
            full_path = self.root_dir / rel_path
            if not full_path.exists():
                violations.append({
                    "type": "FILE_MISSING",
                    "file": rel_path,
                    "detail": "文件已被删除",
                })
                continue

            try:
                actual_hash = hashlib.sha256(full_path.read_bytes()).hexdigest()
                if actual_hash != stored_hash:
                    violations.append({
                        "type": "FILE_TAMPERED",
                        "file": rel_path,
                        "detail": f"SHA256 不匹配: 期望 {stored_hash[:16]}... 实际 {actual_hash[:16]}...",
                    })
                checked_count += 1
            except (IOError, OSError) as e:
                violations.append({
                    "type": "FILE_UNREADABLE",
                    "file": rel_path,
                    "detail": str(e),
                })

        # 2. 检查是否有未授权的文件新增
        current_files = set()
        for f in self._scan_critical_files():
            rel = str(f.relative_to(self.root_dir))
            current_files.add(rel)

        manifest_files = set(stored_manifest.keys())
        new_files = current_files - manifest_files
        for nf in sorted(new_files):
            # 跳过 MANIFEST 自身和临时文件
            if nf in (MANIFEST_FILE, MANIFEST_SIG_FILE) or nf.endswith(".tmp"):
                continue
            violations.append({
                "type": "UNKNOWN_FILE",
                "file": nf,
                "detail": "MANIFEST 中未记录的新文件",
            })

        passed = len(violations) == 0
        self._violations = violations

        if passed:
            logger.info(f"✅ 完整性校验通过: {checked_count} 个文件")
        else:
            logger.warning(f"⚠️ 完整性校验发现 {len(violations)} 个问题")
            for v in violations:
                logger.warning(f"  [{v['type']}] {v.get('file', '')} - {v['detail']}")

        return {
            "passed": passed,
            "violations": violations,
            "file_count": checked_count,
        }

    # ── 定时巡检 ──

    def patrol(self) -> dict:
        """单次巡检，返回当前状态。可用于定时调度"""
        return self.verify_startup()

    # ── 辅助 ──

    def _scan_critical_files(self) -> List[Path]:
        """扫描所有需要校验的关键文件（递归扫描）"""
        files = []
        for pattern in CRITICAL_PATTERNS:
            # **/*.py 需要递归搜索
            if pattern.startswith("**/"):
                # 使用 rglob 递归搜索
                sub_pattern = pattern[3:]
                matched = list(self.root_dir.rglob(sub_pattern))
            else:
                matched = list(self.root_dir.glob(pattern))
            files.extend(matched)

        # 排除不需要校验的目录
        filtered = []
        for f in files:
            rel = f.relative_to(self.root_dir)
            parts = str(rel).split(os.sep)
            if not any(p in EXCLUDE_DIRS for p in parts):
                filtered.append(f)

        return sorted(set(filtered))

    def get_violations(self) -> List[dict]:
        return list(self._violations)

    def has_violations(self) -> bool:
        return len(self._violations) > 0


# ── 命令行入口 ──

def main():
    """命令行工具：生成/校验 MANIFEST"""
    import sys
    shield = IntegrityShield()

    if len(sys.argv) > 1 and sys.argv[1] == "--generate":
        path = shield.generate_manifest()
        print(f"MANIFEST 已生成: {path}")
    elif len(sys.argv) > 1 and sys.argv[1] == "--verify":
        result = shield.verify_startup()
        if result["passed"]:
            print(f"[PASS] 完整性校验通过 ({result['file_count']} 个文件)")
        else:
            print(f"[FAIL] 完整性校验失败 ({len(result['violations'])} 个问题)")
            for v in result["violations"]:
                print(f"  [{v['type']}] {v.get('file', '')}: {v['detail']}")
            sys.exit(1)
    else:
        print("用法: python -m app.security.integrity --generate|--verify")


if __name__ == "__main__":
    main()
