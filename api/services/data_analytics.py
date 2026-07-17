# -*- coding: utf-8 -*-
"""Normalize SQLite crawler output for the WebUI analytics workspace."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


PLATFORM_LABELS = {
    "xhs": "小红书",
    "dy": "抖音",
    "ks": "快手",
    "bili": "Bilibili",
    "wb": "微博",
    "tieba": "贴吧",
    "zhihu": "知乎",
}

SQLITE_CONTENT_TABLES = {
    "xhs": "xhs_note",
    "dy": "douyin_aweme",
    "ks": "kuaishou_video",
    "bili": "bilibili_video",
    "wb": "weibo_note",
    "tieba": "tieba_note",
    "zhihu": "zhihu_content",
}

SQLITE_COMMENT_TABLES = {
    "xhs": ("xhs_note_comment", "note_id"),
    "dy": ("douyin_aweme_comment", "aweme_id"),
    "ks": ("kuaishou_video_comment", "video_id"),
    "bili": ("bilibili_video_comment", "video_id"),
    "wb": ("weibo_note_comment", "note_id"),
    "tieba": ("tieba_comment", "note_id"),
    "zhihu": ("zhihu_comment", "content_id"),
}


def parse_metric(value: Any) -> int:
    """Convert platform counters such as ``2.4万`` or ``1,200`` to integers."""
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        return max(0, int(value))

    text = str(value).strip().lower().replace(",", "").replace("+", "")
    multipliers = {"万": 10_000, "w": 10_000, "千": 1_000, "k": 1_000}
    multiplier = 1
    if text and text[-1] in multipliers:
        multiplier = multipliers[text[-1]]
        text = text[:-1]
    try:
        return max(0, int(float(text) * multiplier))
    except (TypeError, ValueError):
        return 0


def _first(record: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = record.get(key)
        if value is not None and value != "":
            return value
    return default


def _timestamp(value: Any) -> int:
    if value is None or value == "":
        return 0
    if isinstance(value, (int, float)):
        timestamp = int(value)
    else:
        text = str(value).strip()
        try:
            timestamp = int(float(text))
        except ValueError:
            try:
                return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp())
            except ValueError:
                return 0
    return timestamp // 1000 if timestamp > 10_000_000_000 else timestamp


def _cover_url(platform: str, record: dict[str, Any]) -> str:
    value = _first(
        record,
        "cover_url",
        "video_cover_url",
        "image_list",
        default="",
    )
    if isinstance(value, list):
        value = value[0] if value else ""
    text = str(value or "")
    if platform == "xhs" and "," in text:
        text = text.split(",", 1)[0]
    return text


def normalize_content(platform: str, record: dict[str, Any], source_file: str) -> dict[str, Any] | None:
    content_id = str(_first(record, "note_id", "aweme_id", "video_id", "content_id", default="")).strip()
    if not content_id:
        return None

    title = str(_first(record, "title", "content", "content_text", "desc", default="")).strip()
    description = str(_first(record, "desc", "content", "content_text", default="")).strip()
    creator_name = str(_first(record, "nickname", "user_nickname", "user_name", default="")).strip()
    creator_id = str(
        _first(record, "creator_hash", "user_id", "sec_uid", "author_id", "uid", "user_uri", default="")
    ).strip()
    keyword = str(_first(record, "source_keyword", default="未标记关键词")).strip() or "未标记关键词"

    likes = parse_metric(_first(record, "liked_count", "voteup_count", "total_liked", default=0))
    comments = parse_metric(
        _first(record, "comment_count", "comments_count", "video_comment", "total_comments", "total_replay_num", default=0)
    )
    shares = parse_metric(_first(record, "share_count", "shared_count", "video_share_count", "total_forwards", default=0))
    saves = parse_metric(_first(record, "collected_count", "video_favorite_count", default=0))
    views = parse_metric(_first(record, "viewd_count", "video_play_count", default=0))

    return {
        "platform": platform,
        "platform_label": PLATFORM_LABELS.get(platform, platform),
        "content_id": content_id,
        "content_type": str(_first(record, "type", "aweme_type", "video_type", "content_type", default="content")),
        "keyword": keyword,
        "title": title,
        "description": description,
        "creator_id": creator_id,
        "creator_name": creator_name,
        "cover_url": _cover_url(platform, record),
        "content_url": str(_first(record, "note_url", "aweme_url", "video_url", "content_url", default="")),
        "published_at": _timestamp(
            _first(record, "time", "create_time", "created_time", "publish_time", "pub_ts", default=0)
        ),
        "likes": likes,
        "saves": saves,
        "comments": comments,
        "shares": shares,
        "views": views,
        "engagement": likes + saves + comments + shares,
        "source_file": source_file,
    }


def _sqlite_tables(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }


def load_normalized_contents_from_sqlite(
    db_path: Path,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Normalize crawler content directly from the shared SQLite database."""
    path = Path(db_path)
    if not path.exists():
        return []
    platforms = [platform] if platform in SQLITE_CONTENT_TABLES else list(SQLITE_CONTENT_TABLES)
    normalized: list[dict[str, Any]] = []
    with sqlite3.connect(path, timeout=30) as connection:
        connection.row_factory = sqlite3.Row
        tables = _sqlite_tables(connection)
        for platform_name in platforms:
            table = SQLITE_CONTENT_TABLES[platform_name]
            if table not in tables:
                continue
            for row in connection.execute(f'SELECT * FROM "{table}"'):
                raw = dict(row)
                item = normalize_content(platform_name, raw, f"sqlite:{table}")
                if item is not None:
                    # Used only by the run-delta fingerprint; analytics persistence ignores extra fields.
                    item["_storage_updated_at"] = raw.get("last_modify_ts") or raw.get("add_ts") or 0
                    normalized.append(item)
    return normalized


def load_normalized_comments_from_sqlite(
    db_path: Path,
    platform: str | None = None,
) -> list[dict[str, Any]]:
    """Return first- and second-level comments from all crawler comment tables."""
    path = Path(db_path)
    if not path.exists():
        return []
    platforms = [platform] if platform in SQLITE_COMMENT_TABLES else list(SQLITE_COMMENT_TABLES)
    comments: list[dict[str, Any]] = []
    with sqlite3.connect(path, timeout=30) as connection:
        connection.row_factory = sqlite3.Row
        tables = _sqlite_tables(connection)
        for platform_name in platforms:
            table, content_key = SQLITE_COMMENT_TABLES[platform_name]
            if table not in tables:
                continue
            for raw_row in connection.execute(f'SELECT * FROM "{table}"'):
                row = dict(raw_row)
                parent_id = str(row.get("parent_comment_id") or "")
                comments.append({
                    "platform": platform_name,
                    "platform_label": PLATFORM_LABELS.get(platform_name, platform_name),
                    "content_id": str(row.get(content_key) or ""),
                    "comment_id": str(row.get("comment_id") or ""),
                    "parent_comment_id": parent_id,
                    "level": 2 if parent_id not in {"", "0", "None"} else 1,
                    "content": str(row.get("content") or ""),
                    "creator_id": str(row.get("creator_hash") or ""),
                    "creator_name": str(row.get("nickname") or row.get("user_nickname") or ""),
                    "published_at": _timestamp(row.get("create_time") or row.get("publish_time")),
                    "likes": parse_metric(row.get("like_count") or row.get("comment_like_count")),
                    "sub_comment_count": parse_metric(row.get("sub_comment_count")),
                })
    return comments


def filter_contents(
    contents: Iterable[dict[str, Any]],
    platform: str | None = None,
    keyword: str | None = None,
    query: str | None = None,
) -> list[dict[str, Any]]:
    query_text = (query or "").strip().lower()
    result = []
    for item in contents:
        if platform and platform != "all" and item["platform"] != platform:
            continue
        if keyword and keyword != "all" and item["keyword"] != keyword:
            continue
        if query_text:
            haystack = " ".join(
                str(item.get(field, "")) for field in ("title", "description", "creator_name", "creator_id", "content_id")
            ).lower()
            if query_text not in haystack:
                continue
        result.append(item)
    return result


def aggregate_contents(contents: list[dict[str, Any]]) -> dict[str, Any]:
    def aggregate_group(items: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "content_count": len(items),
            "creator_count": len({item["creator_id"] for item in items if item["creator_id"]}),
            "likes": sum(item["likes"] for item in items),
            "saves": sum(item["saves"] for item in items),
            "comments": sum(item["comments"] for item in items),
            "shares": sum(item["shares"] for item in items),
            "views": sum(item["views"] for item in items),
            "engagement": sum(item["engagement"] for item in items),
        }

    keyword_groups: dict[str, list[dict[str, Any]]] = {}
    platform_groups: dict[str, list[dict[str, Any]]] = {}
    for item in contents:
        keyword_groups.setdefault(item["keyword"], []).append(item)
        platform_groups.setdefault(item["platform"], []).append(item)

    by_keyword = [
        {"keyword": name, **aggregate_group(items)}
        for name, items in keyword_groups.items()
    ]
    by_keyword.sort(key=lambda item: (item["engagement"], item["content_count"]), reverse=True)

    by_platform = [
        {
            "platform": name,
            "platform_label": PLATFORM_LABELS.get(name, name),
            **aggregate_group(items),
        }
        for name, items in platform_groups.items()
    ]
    by_platform.sort(key=lambda item: item["content_count"], reverse=True)

    return {"totals": aggregate_group(contents), "by_keyword": by_keyword, "by_platform": by_platform}
