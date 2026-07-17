# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaRadar project.
# Repository: https://github.com/NanmiCoder/MediaRadar/blob/main/api/routers/data.py
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

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from io import BytesIO
from urllib.parse import quote

from ..services.analytics_repository import analytics_repository

router = APIRouter(prefix="/data", tags=["data"])


@router.get("/analytics/summary")
async def get_analytics_summary(
    run_id: Optional[str] = None,
    platform: Optional[str] = None,
    keyword: Optional[str] = None,
):
    """Return keyword/platform aggregates for the result dashboard."""
    return analytics_repository.summary(run_id=run_id, platform=platform, keyword=keyword)


@router.get("/analytics/contents")
async def get_analytics_contents(
    run_id: Optional[str] = None,
    platform: Optional[str] = None,
    keyword: Optional[str] = None,
    query: Optional[str] = None,
    sort_by: str = Query(default="engagement"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """Return normalized content rows with server-side search, sort and pagination."""
    try:
        return analytics_repository.query_contents(
            run_id=run_id,
            platform=platform,
            keyword=keyword,
            query=query,
            sort_by=sort_by,
            sort_order=sort_order,
            page=page,
            page_size=page_size,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("/analytics/comments")
async def get_analytics_comments(
    run_id: Optional[str] = None,
    platform: Optional[str] = None,
    content_id: Optional[str] = None,
    level: Optional[int] = Query(default=None, ge=1, le=2),
    query: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """Return collected first- and second-level comments from SQLite."""
    return analytics_repository.query_comments(
        run_id=run_id,
        platform=platform,
        content_id=content_id,
        level=level,
        query=query,
        page=page,
        page_size=page_size,
    )


@router.get("/analytics/comments/threads")
async def get_analytics_comment_threads(
    platform: str,
    content_id: str,
    run_id: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """Return all collected comments for one content item, grouped by parent comment."""
    return analytics_repository.query_comment_threads(
        platform=platform,
        content_id=content_id,
        run_id=run_id,
        page=page,
        page_size=page_size,
    )


@router.get("/analytics/runs")
async def get_analytics_runs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    """Return persistent crawler task history."""
    return analytics_repository.list_runs(page=page, page_size=page_size)


@router.delete("/analytics/runs/{run_id}")
async def delete_analytics_run(run_id: str):
    """Delete a finished task record and all analytics rows belonging to it."""
    try:
        deleted = analytics_repository.delete_run(run_id)
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if not deleted:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "ok", "run_id": run_id}


@router.get("/analytics/export")
async def export_analytics_contents(
    run_id: Optional[str] = None,
    platform: Optional[str] = None,
    keyword: Optional[str] = None,
    query: Optional[str] = None,
    sort_by: str = Query(default="engagement"),
):
    """Export the current content filters as an Excel-compatible UTF-8 CSV."""
    try:
        payload = analytics_repository.export_csv(run_id, platform, keyword, query, sort_by)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    filename = quote(f"MediaRadar结果_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv")
    return StreamingResponse(
        BytesIO(payload),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{filename}"},
    )
