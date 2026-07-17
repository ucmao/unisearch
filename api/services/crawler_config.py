from __future__ import annotations

import re

import config

from ..schemas import CrawlerStartRequest


_SPECIFIED_ID_CONFIG = {
    "xhs": "XHS_SPECIFIED_NOTE_URL_LIST",
    "bili": "BILI_SPECIFIED_ID_LIST",
    "dy": "DY_SPECIFIED_ID_LIST",
    "wb": "WEIBO_SPECIFIED_ID_LIST",
    "ks": "KS_SPECIFIED_ID_LIST",
    "tieba": "TIEBA_SPECIFIED_ID_LIST",
    "zhihu": "ZHIHU_SPECIFIED_ID_LIST",
}

_CREATOR_ID_CONFIG = {
    "xhs": "XHS_CREATOR_ID_LIST",
    "bili": "BILI_CREATOR_ID_LIST",
    "dy": "DY_CREATOR_ID_LIST",
    "wb": "WEIBO_CREATOR_ID_LIST",
    "ks": "KS_CREATOR_ID_LIST",
    "tieba": "TIEBA_CREATOR_URL_LIST",
    "zhihu": "ZHIHU_CREATOR_URL_LIST",
}


def _split_values(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _normalize_tieba_note_id(value: str) -> str:
    match = re.search(r"/p/(\d+)", value)
    return match.group(1) if match else value


def _normalize_tieba_creator_url(value: str) -> str:
    if value.startswith(("http://", "https://")):
        return value
    return f"https://tieba.baidu.com/home/main?id={value}"


def apply_crawler_request(request: CrawlerStartRequest) -> None:
    """Apply a validated Web request to the crawler's process-local config."""

    platform = request.platform.value
    config.PLATFORM = platform
    config.LOGIN_TYPE = request.login_type.value
    config.CRAWLER_TYPE = request.crawler_type.value
    config.START_PAGE = request.start_page
    config.KEYWORDS = request.keywords
    config.ENABLE_GET_COMMENTS = request.enable_comments
    config.ENABLE_GET_SUB_COMMENTS = request.enable_sub_comments
    config.HEADLESS = request.headless
    config.CDP_HEADLESS = request.headless
    config.SAVE_DATA_OPTION = "sqlite"
    config.COOKIES = request.cookies

    if request.max_notes_count is not None:
        config.CRAWLER_MAX_NOTES_COUNT = request.max_notes_count
    if request.max_comments_count is not None:
        config.CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES = request.max_comments_count

    specified_ids = _split_values(request.specified_ids)
    if platform == "tieba":
        specified_ids = [_normalize_tieba_note_id(item) for item in specified_ids]
    setattr(config, _SPECIFIED_ID_CONFIG[platform], specified_ids)

    creator_ids = _split_values(request.creator_ids)
    if platform == "tieba":
        creator_ids = [_normalize_tieba_creator_url(item) for item in creator_ids]
    setattr(config, _CREATOR_ID_CONFIG[platform], creator_ids)
