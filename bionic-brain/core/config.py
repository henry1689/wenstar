"""
景幻仙姑 · 生物智脑 — 配置
"""
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent

# ── 服务器 ──
HOST = os.getenv("JH_HOST", "0.0.0.0")
PORT = int(os.getenv("JH_PORT", "7200"))

# ── 数据库 ──
DB_PATH = os.getenv("JH_DB_PATH", str(PROJECT_ROOT / "data" / "jinghuan.db"))
DB_ECHO = os.getenv("JH_DB_ECHO", "false").lower() == "true"

# ── 三库存储路径 ──
ALLUVIAL_DIR = os.getenv("JH_ALLUVIAL_DIR", str(PROJECT_ROOT / "data" / "alluvial"))
GOLD_DIR = os.getenv("JH_GOLD_DIR", str(PROJECT_ROOT / "data" / "gold"))
BLACK_DIAMOND_DIR = os.getenv("JH_BD_DIR", str(PROJECT_ROOT / "data" / "black_diamond"))
TMP_DIR = os.getenv("JH_TMP_DIR", str(PROJECT_ROOT / "data" / "tmp"))

# ── LLM 配置（调用 WenStar 或其他 LLM 端点）──
LLM_API_URL = os.getenv("JH_LLM_API_URL", "http://localhost:3000/api/chat")
LLM_API_KEY = os.getenv("JH_LLM_API_KEY", "")
LLM_MODEL = os.getenv("JH_LLM_MODEL", "deepseek-chart")

# ── 做梦模式 ──
DREAM_IDLE_SECONDS = int(os.getenv("JH_DREAM_IDLE", "30"))       # 用户空闲多久触发做梦
DREAM_QUEUE_THRESHOLD = int(os.getenv("JH_DREAM_QUEUE", "5"))     # 积压多少触发
DREAM_INTERVAL_SECONDS = int(os.getenv("JH_DREAM_INTERVAL", "3600"))  # 定时检查

# ── 黑钻库 ──
BD_PROMOTE_THRESHOLD = float(os.getenv("JH_BD_THRESHOLD", "0.35"))   # 晋升阈值
BD_COOLDOWN_DAYS = int(os.getenv("JH_BD_COOLDOWN", "7"))             # 冷却期
BD_DEMOTE_DAYS = int(os.getenv("JH_BD_DEMOTE", "90"))                # 不活跃降级天数
BD_ARCHIVE_DAYS = int(os.getenv("JH_BD_ARCHIVE", "365"))             # 长期沉寂归档天数

# ── 性能 ──
RETRIEVAL_TIMEOUT_MS = int(os.getenv("JH_RETRIEVAL_TIMEOUT", "200")) # 检索超时
VECTOR_DIMENSION = int(os.getenv("JH_VECTOR_DIM", "256"))            # 向量维度

# ── 所有路径 ──
for d in [ALLUVIAL_DIR, GOLD_DIR, BLACK_DIAMOND_DIR, TMP_DIR]:
    Path(d).mkdir(parents=True, exist_ok=True)
