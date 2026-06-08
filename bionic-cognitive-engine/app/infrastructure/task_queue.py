"""
仿生智脑 · Celery 任务队列配置

做梦模式、记忆提炼、半衰期维护的异步任务框架。
"""
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "bionic",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)

# ── Celery 配置 ──
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Shanghai",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,         # 任务完成后才确认（防丢失）
    worker_prefetch_multiplier=1,  # 一次拿一个任务
    task_soft_time_limit=300,    # 5分钟软限制
    task_time_limit=600,         # 10分钟硬限制
    result_expires=86400,        # 结果保留1天
)

# ── Beat 调度计划 ──
celery_app.conf.beat_schedule = {
    "housekeeping-daily": {
        "task": "tasks.housekeeping.run_housekeeping",
        "schedule": 86400.0,  # 每天一次
        "args": (),
    },
    "consolidate-hourly": {
        "task": "tasks.consolidate.consolidate_pending",
        "schedule": 3600.0,  # 每小时一次
        "args": (5,),        # 每次最多5条
    },
}
