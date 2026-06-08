"""
仿生智脑 · Celery 应用定义

启动方式：
  celery -A tasks.celery_app worker -l info
  celery -A tasks.celery_app beat -l info
"""
# 直接使用 infrastructure 中的配置
from app.infrastructure.task_queue import celery_app

__all__ = ["celery_app"]
