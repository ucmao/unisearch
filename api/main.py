# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaRadar project.
# Repository: https://github.com/NanmiCoder/MediaRadar/blob/main/api/main.py
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

"""
MediaRadar WebUI API Server
Start command: uvicorn api.main:app --port 8080 --reload
Or: python -m api.main
"""
import os
import sys
from pathlib import Path
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from api.routers import crawler_router, data_router, websocket_router

# Project root directory
PROJECT_ROOT = Path(__file__).parent.parent

app = FastAPI(
    title="MediaRadar WebUI API",
    description="API for controlling MediaRadar from WebUI",
    version="1.0.0"
)

# Get webui static files directory
WEBUI_DIR = os.path.join(os.path.dirname(__file__), "webui")

# CORS configuration - allow frontend dev server access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Backup port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(crawler_router, prefix="/api")
app.include_router(data_router, prefix="/api")
app.include_router(websocket_router, prefix="/api")


@app.get("/")
async def serve_frontend():
    """Return frontend page"""
    index_path = os.path.join(WEBUI_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {
        "message": "MediaRadar WebUI API",
        "version": "1.0.0",
        "docs": "/docs",
        "note": "WebUI not found, please build it first: cd webui && npm run build"
    }


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}


@app.get("/api/env/check")
async def check_environment():
    """Check if MediaRadar environment is configured correctly"""
    try:
        worker_path = PROJECT_ROOT / "api" / "crawler_worker.py"
        if not worker_path.is_file():
            return {
                "success": False,
                "message": "Environment check failed",
                "error": "Crawler worker entrypoint is missing",
            }

        # Import the actual Web worker and browser dependency. This checks the
        # same runtime used by crawler subprocesses without invoking the CLI.
        from api.crawler_worker import read_request  # noqa: F401
        from playwright.async_api import async_playwright  # noqa: F401

        return {
            "success": True,
            "message": "MediaRadar environment configured correctly",
            "output": f"Python {sys.version.split()[0]}; crawler worker ready",
        }
    except Exception as e:
        return {
            "success": False,
            "message": "Environment check error",
            "error": f"{type(e).__name__}: {str(e) or 'Unknown'}"
        }


@app.get("/api/config/platforms")
async def get_platforms():
    """Get list of supported platforms"""
    return {
        "platforms": [
            {"value": "xhs", "label": "小红书", "icon": "book-open"},
            {"value": "dy", "label": "抖音", "icon": "music"},
            {"value": "ks", "label": "快手", "icon": "video"},
            {"value": "bili", "label": "哔哩哔哩", "icon": "tv"},
            {"value": "wb", "label": "微博", "icon": "message-circle"},
            {"value": "tieba", "label": "百度贴吧", "icon": "messages-square"},
            {"value": "zhihu", "label": "知乎", "icon": "help-circle"},
        ]
    }


@app.get("/api/config/options")
async def get_config_options():
    """Get all configuration options"""
    return {
        "login_types": [
            {"value": "qrcode", "label": "二维码登录"},
            {"value": "cookie", "label": "Cookie 登录"},
        ],
        "crawler_types": [
            {"value": "search", "label": "关键词搜索"},
            {"value": "detail", "label": "指定内容详情"},
            {"value": "creator", "label": "创作者主页"},
        ],
    }


# Mount static resources - must be placed after all routes
if os.path.exists(WEBUI_DIR):
    assets_dir = os.path.join(WEBUI_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    # Mount logos directory
    logos_dir = os.path.join(WEBUI_DIR, "logos")
    if os.path.exists(logos_dir):
        app.mount("/logos", StaticFiles(directory=logos_dir), name="logos")
    # Mount other static files (e.g., vite.svg)
    app.mount("/static", StaticFiles(directory=WEBUI_DIR), name="webui-static")


if __name__ == "__main__":
    # Check if we are running the crawler worker sub-process
    if len(sys.argv) > 1 and sys.argv[1] == "--worker":
        from api.crawler_worker import worker_main
        import crawler_runtime
        from tools.app_runner import run as run_app
        run_app(
            worker_main,
            crawler_runtime.async_cleanup,
            cleanup_timeout_seconds=15.0,
            on_first_interrupt=crawler_runtime.force_stop,
        )
        sys.exit(0)

    # Change working directory if packaged to ensure browser profiles and logs write to AppData
    if getattr(sys, 'frozen', False):
        import platform
        if platform.system() == "Windows":
            app_data = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
        else:
            app_data = os.path.expanduser("~/Library/Application Support")
        app_dir = os.path.join(app_data, "unisearch")
        os.makedirs(app_dir, exist_ok=True)
        os.chdir(app_dir)

    # Resolve port from env variable PORT, command-line argument, or default to 8080
    port = 8080
    if os.environ.get("PORT"):
        try:
            port = int(os.environ.get("PORT"))
        except ValueError:
            pass
            
    for arg in sys.argv:
        if arg.startswith("--port="):
            try:
                port = int(arg.split("=")[1])
            except ValueError:
                pass

    uvicorn.run(app, host="127.0.0.1", port=port)
