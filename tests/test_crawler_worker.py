import io

import pytest
from unittest.mock import AsyncMock, Mock

import config
from api import crawler_worker
from api.schemas import CrawlerStartRequest
from api.services.crawler_config import apply_crawler_request


def test_worker_reads_structured_request_with_secret_cookie():
    request = CrawlerStartRequest(
        platform="xhs",
        login_type="cookie",
        crawler_type="detail",
        specified_ids="https://example.com/note/1",
        cookies="session=value with spaces; token=秘密",
        max_notes_count=25,
    )

    parsed = crawler_worker.read_request(io.StringIO(request.model_dump_json()))

    assert parsed == request
    assert parsed.cookies == "session=value with spaces; token=秘密"


def test_worker_rejects_empty_request():
    with pytest.raises(RuntimeError, match="empty request"):
        crawler_worker.read_request(io.StringIO("  "))


def test_apply_request_maps_web_config_and_tieba_ids(monkeypatch):
    changed_names = [
        "PLATFORM",
        "LOGIN_TYPE",
        "CRAWLER_TYPE",
        "START_PAGE",
        "KEYWORDS",
        "ENABLE_GET_COMMENTS",
        "ENABLE_GET_SUB_COMMENTS",
        "HEADLESS",
        "CDP_HEADLESS",
        "SAVE_DATA_OPTION",
        "COOKIES",
        "CRAWLER_MAX_NOTES_COUNT",
        "CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES",
        "TIEBA_SPECIFIED_ID_LIST",
        "TIEBA_CREATOR_URL_LIST",
    ]
    for name in changed_names:
        monkeypatch.setattr(config, name, getattr(config, name))

    request = CrawlerStartRequest(
        platform="tieba",
        login_type="cookie",
        crawler_type="detail",
        start_page=3,
        keywords="测试",
        enable_comments=True,
        enable_sub_comments=True,
        headless=True,
        cookies="session=secret",
        specified_ids="https://tieba.baidu.com/p/10451142633, 9835114923",
        creator_ids="tb.1.example, https://tieba.baidu.com/home/main?id=tb.1.raw",
        max_notes_count=50,
        max_comments_count=5,
    )

    apply_crawler_request(request)

    assert config.PLATFORM == "tieba"
    assert config.LOGIN_TYPE == "cookie"
    assert config.CRAWLER_TYPE == "detail"
    assert config.START_PAGE == 3
    assert config.KEYWORDS == "测试"
    assert config.ENABLE_GET_COMMENTS is True
    assert config.ENABLE_GET_SUB_COMMENTS is True
    assert config.HEADLESS is True
    assert config.CDP_HEADLESS is True
    assert config.SAVE_DATA_OPTION == "sqlite"
    assert config.COOKIES == "session=secret"
    assert config.CRAWLER_MAX_NOTES_COUNT == 50
    assert config.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES == 5
    assert config.TIEBA_SPECIFIED_ID_LIST == ["10451142633", "9835114923"]
    assert config.TIEBA_CREATOR_URL_LIST == [
        "https://tieba.baidu.com/home/main?id=tb.1.example",
        "https://tieba.baidu.com/home/main?id=tb.1.raw",
    ]


@pytest.mark.asyncio
async def test_worker_applies_request_before_starting_crawler(monkeypatch):
    request = CrawlerStartRequest(platform="bili", keywords="AI")
    read_request = lambda: request
    apply_request = Mock()
    run_crawler = AsyncMock()
    monkeypatch.setattr(crawler_worker, "read_request", read_request)
    monkeypatch.setattr(crawler_worker, "apply_crawler_request", apply_request)
    monkeypatch.setattr(crawler_worker.crawler_runtime, "run_crawler", run_crawler)

    await crawler_worker.worker_main()

    apply_request.assert_called_once_with(request)
    run_crawler.assert_awaited_once()
