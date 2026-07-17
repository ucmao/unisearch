# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaRadar project.
# Repository: https://github.com/NanmiCoder/MediaRadar/blob/main/api/routers/crawler.py
# GitHub: https://github.com/NanmiCoder
# Licensed under NON-COMMERCIAL LEARNING LICENSE 1.1
#
# 声明：本代码仅供学习和研究目的使用。使用者应遵守以下原则：
# 1. 不得用于任何商业用途。
# 2. 使用时应遵守目标平台的使用条款和robots.txt规则。
# 3. 不得进行大规模爬取或对平台造成运营干扰。
# 4. 应合理控制请求频率，避免给目标平台带来不必要的负担。
# 5. 不得用于任何非法或不当的用途。
#
# 详细许可条款请参阅项目根目录下的LICENSE文件。
# 使用本代码即表示您同意遵守上述原则和LICENSE中的所有条款。

from typing import Optional
from fastapi import APIRouter, HTTPException

from ..schemas import CrawlerStartRequest
from ..services import crawler_manager

router = APIRouter(prefix="/crawler", tags=["crawler"])


@router.post("/start")
async def start_crawler(request: CrawlerStartRequest):
    """Start crawler task"""
    platform = request.platform.value
    success = await crawler_manager.start(request)
    if not success:
        task_status = crawler_manager.get_status(platform)
        if task_status["status"] in ("running", "stopping"):
            raise HTTPException(status_code=400, detail=f"Crawler for {platform} is already running")
        raise HTTPException(status_code=500, detail=f"Failed to start crawler for {platform}")

    task_status = crawler_manager.get_status(platform)
    return {
        "status": "ok",
        "message": f"Crawler for {platform} started successfully",
        "run_id": task_status["run_id"],
    }


@router.post("/stop")
async def stop_crawler(platform: Optional[str] = None):
    """Stop crawler task"""
    success = await crawler_manager.stop(platform)
    if not success:
        raise HTTPException(status_code=400, detail="No crawler is running or stop failed")

    return {"status": "ok", "message": f"Crawler {platform or 'all'} stopped successfully"}


@router.get("/status")
async def get_crawler_status(platform: Optional[str] = None):
    """Get crawler status"""
    return crawler_manager.get_status(platform)


@router.get("/logs")
async def get_logs(platform: Optional[str] = None, limit: int = 100):
    """Get recent logs"""
    logs = crawler_manager.get_logs(platform, limit)
    return {"logs": [log.model_dump() for log in logs]}
