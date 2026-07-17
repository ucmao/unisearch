# -*- coding: utf-8 -*-
import sys

import pytest
import config
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from cmd_arg import parse_cmd
from api.schemas import PlatformEnum
from api.services.crawler_manager import CrawlerManager
from api.main import app

@pytest.mark.asyncio
async def test_cmd_arg_crawler_max_notes_count():
    # Store original values
    orig_notes = config.CRAWLER_MAX_NOTES_COUNT
    orig_comments = config.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES

    try:
        await parse_cmd([
            "--platform", "xhs",
            "--crawler_max_notes_count", "42",
            "--max_comments_count_singlenotes", "24"
        ])
        assert config.CRAWLER_MAX_NOTES_COUNT == 42
        assert config.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES == 24
    finally:
        config.CRAWLER_MAX_NOTES_COUNT = orig_notes
        config.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES = orig_comments


def test_crawler_manager_uses_fixed_worker_command():
    cm = CrawlerManager()
    assert cm._build_worker_command() == [sys.executable, "-m", "api.crawler_worker"]


def test_environment_check_uses_web_worker_runtime():
    response = TestClient(app).get("/api/env/check")

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert "crawler worker ready" in response.json()["output"]


def test_api_start_crawler_with_limits():
    client = TestClient(app)

    with patch("api.routers.crawler.crawler_manager.start", new_callable=AsyncMock) as mock_start:
        mock_start.return_value = True

        # Test case 1: with limits
        response = client.post("/api/crawler/start", json={
            "platform": "xhs",
            "login_type": "qrcode",
            "crawler_type": "search",
            "keywords": "test",
            "max_notes_count": 50,
            "max_comments_count": 5
        })

        assert response.status_code == 200
        assert response.json() == {
            "status": "ok",
            "message": "Crawler for xhs started successfully",
            "run_id": None,
        }

        mock_start.assert_called_once()
        called_request = mock_start.call_args[0][0]
        assert called_request.platform == PlatformEnum.XHS
        assert called_request.max_notes_count == 50
        assert called_request.max_comments_count == 5


def test_api_start_crawler_without_limits():
    client = TestClient(app)

    with patch("api.routers.crawler.crawler_manager.start", new_callable=AsyncMock) as mock_start:
        mock_start.return_value = True

        # Test case 2: without limits
        response = client.post("/api/crawler/start", json={
            "platform": "xhs",
            "login_type": "qrcode",
            "crawler_type": "search",
            "keywords": "test"
        })

        assert response.status_code == 200
        mock_start.assert_called_once()
        called_request = mock_start.call_args[0][0]
        assert called_request.platform == PlatformEnum.XHS
        assert called_request.max_notes_count is None
        assert called_request.max_comments_count is None


@pytest.mark.parametrize(
    ("field_name", "value"),
    [
        ("max_notes_count", 0),
        ("max_notes_count", -1),
        ("max_notes_count", 10001),
        ("max_comments_count", 0),
        ("max_comments_count", -1),
        ("max_comments_count", 10001),
    ],
)
def test_api_rejects_invalid_limits(field_name, value):
    client = TestClient(app)
    payload = {
        "platform": "xhs",
        "login_type": "qrcode",
        "crawler_type": "search",
        "keywords": "test",
        field_name: value,
    }

    with patch("api.routers.crawler.crawler_manager.start", new_callable=AsyncMock) as mock_start:
        response = client.post("/api/crawler/start", json=payload)

    assert response.status_code == 422
    mock_start.assert_not_called()
