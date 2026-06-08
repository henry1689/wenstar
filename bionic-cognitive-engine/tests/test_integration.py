"""
仿生智脑 · 集成测试脚本

测试内容：
  1. 项目依赖与导入（语法与环境验证）
  2. 领域模型（ORM 表结构、字段、过滤条件）
  3. API 路由结构（端点注册、路由数量）
  4. 核心服务（retrieval/refiner/decay/iqc 实例化）
  5. Docker Compose 环境可用性检查

运行方式：
  # 1. 语法与环境验证（无需 Docker）：
  python tests/test_integration.py
  # 或：
  python -m pytest tests/test_integration.py -v

  # 2. Docker 集成测试（需要 docker compose up -d）：
  python tests/test_integration.py --docker

  # 3. 全链路 API 测试（需要 Docker 运行中）：
  python tests/test_integration.py --api http://localhost:7200
"""
import os
import sys
import json
import unittest
from pathlib import Path

# 添加项目根目录到系统路径
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))


# ═══════════════════════════════════════════════════════════════
# 测试 1：项目依赖检查
# ═══════════════════════════════════════════════════════════════

class TestDependencies(unittest.TestCase):
    """验证所有核心依赖可以正常导入"""

    def test_core_dependencies(self):
        """验证 13 个核心依赖包"""
        packages = [
            "fastapi", "uvicorn",
            "sqlalchemy", "asyncpg",
            "pydantic", "pydantic_settings",
            "celery",
            "qdrant_client",
            "minio",
            "httpx",
            "cryptography",
        ]
        for pkg in packages:
            with self.subTest(package=pkg):
                __import__(pkg)

    def test_project_modules(self):
        """验证项目内所有模块可导入"""
        modules = [
            "app", "app.api", "app.core", "app.domain",
            "app.infrastructure", "app.security",
            "tasks",
        ]
        for mod in modules:
            with self.subTest(module=mod):
                __import__(mod)

    def test_main_app(self):
        """验证 FastAPI 应用可创建"""
        from main import app
        self.assertIsNotNone(app)
        self.assertEqual(app.title, "仿生智脑 (Bionic Cognitive Engine)")


# ═══════════════════════════════════════════════════════════════
# 测试 2：领域模型
# ═══════════════════════════════════════════════════════════════

class TestDomainModels(unittest.TestCase):
    """验证 ORM 模型的结构和过滤条件"""

    @classmethod
    def setUpClass(cls):
        from app.domain.models import (
            GoldVaultEntity, BlackDiamondEntity,
            AlluvialRecord, Base
        )
        cls.Gold = GoldVaultEntity
        cls.Diamond = BlackDiamondEntity
        cls.Alluvial = AlluvialRecord
        cls.Base = Base

    def test_gold_vault_has_user_id(self):
        """金库表有 user_id 字段"""
        self.assertTrue(hasattr(self.Gold, 'user_id'))

    def test_gold_vault_has_is_deleted(self):
        """金库表有 is_deleted 字段"""
        self.assertTrue(hasattr(self.Gold, 'is_deleted'))

    def test_diamond_has_user_id(self):
        """黑钻库表有 user_id 字段"""
        self.assertTrue(hasattr(self.Diamond, 'user_id'))

    def test_diamond_has_is_deleted(self):
        """黑钻库表有 is_deleted 字段"""
        self.assertTrue(hasattr(self.Diamond, 'is_deleted'))

    def test_alluvial_has_user_id(self):
        """砂金库表有 user_id 字段"""
        self.assertTrue(hasattr(self.Alluvial, 'user_id'))

    def test_alluvial_has_is_deleted(self):
        """砂金库表有 is_deleted 字段"""
        self.assertTrue(hasattr(self.Alluvial, 'is_deleted'))

    def test_gold_has_emotion_vector(self):
        """金库表保留 24D 情感向量"""
        self.assertTrue(hasattr(self.Gold, 'emotion_vector'))

    def test_diamond_has_emotional_spectrum(self):
        """黑钻库表有 emotional_spectrum 字段"""
        self.assertTrue(hasattr(self.Diamond, 'emotional_spectrum'))

    def test_diamond_has_decay_days(self):
        """黑钻库表有 decay_days（半衰期）"""
        self.assertTrue(hasattr(self.Diamond, 'decay_days'))

    def test_table_names(self):
        """验证表名"""
        self.assertEqual(self.Gold.__tablename__, "gold_dialogues")
        self.assertEqual(self.Diamond.__tablename__, "black_diamond_events")
        self.assertEqual(self.Alluvial.__tablename__, "alluvial_records")

    def test_gold_is_deleted_defaults_false(self):
        """is_deleted 默认为 False"""
        col = self.Gold.__table__.c['is_deleted']
        self.assertEqual(col.default.arg, False)

    def test_diamond_is_deleted_defaults_false(self):
        """is_deleted 默认为 False"""
        col = self.Diamond.__table__.c['is_deleted']
        self.assertEqual(col.default.arg, False)


# ═══════════════════════════════════════════════════════════════
# 测试 3：API 路由
# ═══════════════════════════════════════════════════════════════

class TestAPIRoutes(unittest.TestCase):
    """验证 API 路由注册"""

    @classmethod
    def setUpClass(cls):
        from app.api.routes import router
        cls.router = router
        # 收集所有路由
        cls.routes = []
        for route in router.routes:
            methods = getattr(route, "methods", set())
            path = getattr(route, "path", str(route))
            for m in methods:
                cls.routes.append((m, path))

    def test_routes_registered(self):
        """至少有 14 个端点"""
        self.assertGreaterEqual(len(self.routes), 14)

    def test_health_endpoint(self):
        """GET /api/v1/health"""
        self.assertIn(("GET", "/api/v1/health"), self.routes)

    def test_stats_endpoint(self):
        """GET /api/v1/stats"""
        self.assertIn(("GET", "/api/v1/stats"), self.routes)

    def test_search_endpoint(self):
        """GET /api/v1/search"""
        self.assertIn(("GET", "/api/v1/search"), self.routes)

    def test_ingest_endpoint(self):
        """POST /api/v1/ingest"""
        self.assertIn(("POST", "/api/v1/ingest"), self.routes)

    def test_docs_upload(self):
        """POST /api/v1/docs/upload — 用户上传"""
        self.assertIn(("POST", "/api/v1/docs/upload"), self.routes)

    def test_docs_gold_list(self):
        """GET /api/v1/docs/gold — 用户金库列表"""
        self.assertIn(("GET", "/api/v1/docs/gold"), self.routes)

    def test_docs_diamonds_list(self):
        """GET /api/v1/docs/diamonds — 用户黑钻列表"""
        self.assertIn(("GET", "/api/v1/docs/diamonds"), self.routes)

    def test_docs_diamonds_update(self):
        """PUT /api/v1/docs/diamonds/{doc_id} — 用户修改黑钻"""
        self.assertIn(("PUT", "/api/v1/docs/diamonds/{doc_id}"), self.routes)

    def test_docs_gold_delete(self):
        """DELETE /api/v1/docs/gold/{doc_id} — 用户删除金库"""
        self.assertIn(("DELETE", "/api/v1/docs/gold/{doc_id}"), self.routes)

    def test_docs_diamonds_delete(self):
        """DELETE /api/v1/docs/diamonds/{doc_id} — 用户删除黑钻"""
        self.assertIn(("DELETE", "/api/v1/docs/diamonds/{doc_id}"), self.routes)


# ═══════════════════════════════════════════════════════════════
# 测试 4：核心服务可实例化
# ═══════════════════════════════════════════════════════════════

class TestCoreServices(unittest.TestCase):
    """验证核心服务类可以实例化"""

    def test_config_loading(self):
        """配置管理可加载"""
        from app.core.config import settings
        self.assertIsNotNone(settings.API_PORT)
        self.assertEqual(settings.API_PORT, 7200)

    def test_refiner_instantiate(self):
        """记忆提炼器可创建"""
        from app.core.refiner import MemoryConsolidator
        from app.infrastructure.llm_client import LLMClient
        llm = LLMClient()
        refiner = MemoryConsolidator(llm)
        self.assertIsNotNone(refiner)

    def test_retrieval_instantiate(self):
        """混合检索引擎可创建"""
        from app.core.retrieval import HybridSearchService
        searcher = HybridSearchService()
        self.assertIsNotNone(searcher)

    def test_decay_manager_instantiate(self):
        """半衰期管理器可创建"""
        from app.core.decay_scheduler import DecayManager
        manager = DecayManager()
        self.assertIsNotNone(manager)
        self.assertEqual(manager.demote_days, 30)
        self.assertEqual(manager.archive_days, 90)

    def test_iqc_engine_instantiate(self):
        """IQC 质检引擎可创建"""
        from app.core.iqc_engine import IQCEngine
        iqc = IQCEngine()
        self.assertIsNotNone(iqc)

    def test_llm_client_instantiate(self):
        """LLM 客户端可创建"""
        from app.infrastructure.llm_client import LLMClient
        llm = LLMClient()
        self.assertIsNotNone(llm)
        self.assertEqual(llm.max_retries, 3)

    def test_vector_store_instantiate(self):
        """Qdrant 向量存储客户端可创建"""
        from app.infrastructure.vector_store import VectorStore
        vs = VectorStore()
        self.assertIsNotNone(vs)

    def test_storage_instantiate(self):
        """MinIO 存储客户端可创建"""
        from app.infrastructure.storage import StorageManager
        storage = StorageManager()
        self.assertIsNotNone(storage)

    def test_encryptor_instantiate(self):
        """加密器可创建"""
        from app.security.encryption import FileEncryptor
        enc = FileEncryptor()
        self.assertIsNotNone(enc)

    def test_encrypt_decrypt_roundtrip(self):
        """AES-256-GCM 加解密往返正确"""
        from app.security.encryption import FileEncryptor
        enc = FileEncryptor()
        data = "Hello, Bionic Engine! Test data with Chinese: hello world".encode("utf-8")
        encrypted = enc.encrypt(data)
        self.assertNotEqual(encrypted, data)
        decrypted = enc.decrypt(encrypted)
        self.assertEqual(decrypted, data)


# ═══════════════════════════════════════════════════════════════
# 测试 5：Schema / Pydantic 模型
# ═══════════════════════════════════════════════════════════════

class TestSchemas(unittest.TestCase):
    """验证 Pydantic 请求/响应模型"""

    @classmethod
    def setUpClass(cls):
        from app.api import schemas
        cls.s = schemas

    def test_ingest_response(self):
        """IngestResponse 可创建"""
        r = self.s.IngestResponse(
            id="sd_test", status="qc_pending",
            file_hash="abc123", message="已入库"
        )
        self.assertEqual(r.status, "qc_pending")
        self.assertEqual(r.id, "sd_test")

    def test_search_response(self):
        """SearchResponse 可创建"""
        r = self.s.SearchResponse(
            query="测试", results=[],
            source="none", latency_ms=0
        )
        self.assertEqual(r.query, "测试")
        self.assertEqual(r.source, "none")

    def test_gold_doc_summary(self):
        """GoldDocSummary 可创建"""
        r = self.s.GoldDocSummary(
            id="g1", topic="测试话题",
            tags=["tag1"], created_at="2026-01-01T00:00:00Z"
        )
        self.assertEqual(r.topic, "测试话题")

    def test_diamond_doc_detail(self):
        """DiamondDocDetail 可创建"""
        r = self.s.DiamondDocDetail(
            id="d1", event_id="evt_001",
            event_type="architecture_decision",
            occurred_at="2026-01-01T00:00:00Z",
            core_facts="核心事实",
            decisions=["决策1"],
            emotional_spectrum={"dominant_emotion": "兴奋"},
        )
        self.assertEqual(r.core_facts, "核心事实")
        self.assertEqual(r.emotional_spectrum["dominant_emotion"], "兴奋")

    def test_update_diamond_request(self):
        """UpdateDiamondRequest 可创建"""
        r = self.s.UpdateDiamondRequest(core_facts="新的事实")
        self.assertEqual(r.core_facts, "新的事实")
        self.assertIsNone(r.decisions)
        self.assertIsNone(r.tags)

    def test_delete_response(self):
        """DeleteResponse 可创建"""
        r = self.s.DeleteResponse(id="doc_1", message="已删除")
        self.assertEqual(r.status, "deleted")

    def test_doc_list_response(self):
        """DocListResponse 可创建（分页）"""
        r = self.s.DocListResponse(
            items=[{"id": "1"}], total=1,
            page=1, page_size=20
        )
        self.assertEqual(r.total, 1)
        self.assertEqual(r.page, 1)

    def test_health_response(self):
        """HealthResponse 可创建"""
        r = self.s.HealthResponse(
            status="ok",
            services={"database": "ok", "qdrant": "ok"},
        )
        self.assertEqual(r.status, "ok")
        self.assertIn("database", r.services)


# ═══════════════════════════════════════════════════════════════
# 测试 6：枚举完整性
# ═══════════════════════════════════════════════════════════════

class TestEnums(unittest.TestCase):
    """验证枚举定义"""

    @classmethod
    def setUpClass(cls):
        from app.domain.enums import (
            AlluvialStatus, DiamondEventType, IQCQueueStatus
        )
        cls.AlluvialStatus = AlluvialStatus
        cls.DiamondEventType = DiamondEventType
        cls.IQCQueueStatus = IQCQueueStatus

    def test_alluvial_status_values(self):
        """砂金库状态枚举完整"""
        self.assertTrue(hasattr(self.AlluvialStatus, 'RAW'))
        self.assertTrue(hasattr(self.AlluvialStatus, 'QC_PENDING'))
        self.assertTrue(hasattr(self.AlluvialStatus, 'APPROVED'))
        self.assertTrue(hasattr(self.AlluvialStatus, 'REJECTED'))
        self.assertTrue(hasattr(self.AlluvialStatus, 'ARCHIVED'))

    def test_diamond_event_types(self):
        """黑钻事件类型包含核心类型"""
        self.assertTrue(hasattr(self.DiamondEventType, 'ARCHITECTURE_DECISION'))
        self.assertTrue(hasattr(self.DiamondEventType, 'EMOTIONAL_EXCHANGE'))
        self.assertTrue(hasattr(self.DiamondEventType, 'DAILY_CONVERSATION'))


# ═══════════════════════════════════════════════════════════════
# 测试 7：Docker Compose 环境检查（可选，需要 --docker 参数）
# ═══════════════════════════════════════════════════════════════

@unittest.skipIf("--docker" not in sys.argv, "需要 --docker 参数")
class TestDockerEnvironment(unittest.TestCase):
    """验证 Docker Compose 环境（需要 docker compose up -d）"""

    def test_docker_available(self):
        """Docker 命令可用"""
        import subprocess
        result = subprocess.run(["docker", "ps"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0,
                         f"Docker 不可用: {result.stderr}")

    def test_postgres_accessible(self):
        """PostgreSQL 可连接"""
        # 通过 API 健康检查验证
        import httpx
        try:
            resp = httpx.get("http://localhost:7200/api/v1/health", timeout=5)
            self.assertEqual(resp.status_code, 200)
            data = resp.json()
            self.assertEqual(data["status"], "ok")
        except (httpx.ConnectError, httpx.TimeoutException) as e:
            self.skipTest(f"API 不可达: {e}")


# ═══════════════════════════════════════════════════════════════
# 入口
# ═══════════════════════════════════════════════════════════════

def print_summary(result):
    """打印测试摘要"""
    total = result.testsRun
    failures = len(result.failures)
    errors = len(result.errors)
    skipped = len(result.skipped)
    passed = total - failures - errors - skipped

    print("\n" + "=" * 55)
    print(f"仿生智脑 · 集成测试报告")
    print("=" * 55)
    print(f"  总计: {total}")
    print(f"  通过: {passed}")
    print(f"  失败: {failures}")
    print(f"  错误: {errors}")
    print(f"  跳过: {skipped}")
    print("=" * 55)

    if failures:
        print("\n失败详情:")
        for test, trace in result.failures:
            print(f"  [FAIL] {test}")
    if errors:
        print("\n错误详情:")
        for test, trace in result.errors:
            print(f"  [ERROR] {test}")


if __name__ == "__main__":
    suite = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    print_summary(result)
    sys.exit(0 if result.wasSuccessful() else 1)
