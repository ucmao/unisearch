# -*- coding: utf-8 -*-
"""SQLite repository for crawler runs and normalized analytics content."""

from __future__ import annotations

import csv
import io
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .data_analytics import (
    PLATFORM_LABELS,
    aggregate_contents,
    load_normalized_comments_from_sqlite,
)


DEFAULT_DB_PATH = Path(__file__).parent.parent.parent / "data" / "analytics.sqlite3"
SORTABLE_FIELDS = {"engagement", "likes", "saves", "comments", "shares", "views", "published_at", "title"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class AnalyticsRepository:
    def __init__(self, db_path: Path = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS crawl_runs (
                    run_id TEXT PRIMARY KEY,
                    task_name TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    crawler_type TEXT NOT NULL,
                    keywords TEXT NOT NULL DEFAULT '',
                    save_option TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    exit_code INTEGER,
                    item_count INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    config_json TEXT NOT NULL DEFAULT '{}'
                );

                CREATE TABLE IF NOT EXISTS content_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL,
                    platform TEXT NOT NULL,
                    platform_label TEXT NOT NULL,
                    content_id TEXT NOT NULL,
                    content_type TEXT NOT NULL DEFAULT 'content',
                    keyword TEXT NOT NULL DEFAULT '未标记关键词',
                    title TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    creator_id TEXT NOT NULL DEFAULT '',
                    creator_name TEXT NOT NULL DEFAULT '',
                    cover_url TEXT NOT NULL DEFAULT '',
                    content_url TEXT NOT NULL DEFAULT '',
                    published_at INTEGER NOT NULL DEFAULT 0,
                    likes INTEGER NOT NULL DEFAULT 0,
                    saves INTEGER NOT NULL DEFAULT 0,
                    comments INTEGER NOT NULL DEFAULT 0,
                    shares INTEGER NOT NULL DEFAULT 0,
                    views INTEGER NOT NULL DEFAULT 0,
                    engagement INTEGER NOT NULL DEFAULT 0,
                    source_file TEXT NOT NULL DEFAULT '',
                    ingested_at TEXT NOT NULL,
                    FOREIGN KEY(run_id) REFERENCES crawl_runs(run_id) ON DELETE CASCADE,
                    UNIQUE(run_id, platform, content_id, keyword)
                );

                CREATE INDEX IF NOT EXISTS idx_content_run_id ON content_records(run_id);
                CREATE INDEX IF NOT EXISTS idx_content_platform_keyword ON content_records(platform, keyword);
                CREATE INDEX IF NOT EXISTS idx_content_engagement ON content_records(engagement DESC);
                CREATE INDEX IF NOT EXISTS idx_runs_started_at ON crawl_runs(started_at DESC);
                """
            )

    def create_run(self, config: dict[str, Any], task_name: str = "") -> str:
        run_id = uuid.uuid4().hex
        platform = str(config.get("platform", ""))
        keywords = str(config.get("keywords", ""))
        display_name = task_name.strip() or f"{PLATFORM_LABELS.get(platform, platform)} · {keywords or config.get('crawler_type', '任务')}"
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO crawl_runs
                (run_id, task_name, platform, crawler_type, keywords, save_option, status, started_at, config_json)
                VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)""",
                (
                    run_id,
                    display_name,
                    platform,
                    str(config.get("crawler_type", "")),
                    keywords,
                    "sqlite",
                    utc_now(),
                    json.dumps(config, ensure_ascii=False),
                ),
            )
        return run_id

    def finish_run(
        self,
        run_id: str,
        status: str,
        exit_code: int | None,
        contents: list[dict[str, Any]],
        error_message: str = "",
    ) -> None:
        self.ingest_contents(run_id, contents)
        with self.connect() as connection:
            connection.execute(
                """UPDATE crawl_runs
                SET status=?, finished_at=?, exit_code=?, item_count=?, error_message=?
                WHERE run_id=?""",
                (status, utc_now(), exit_code, len(contents), error_message or None, run_id),
            )

    def ingest_contents(self, run_id: str, contents: list[dict[str, Any]]) -> int:
        if not contents:
            return 0
        fields = (
            "platform", "platform_label", "content_id", "content_type", "keyword", "title", "description",
            "creator_id", "creator_name", "cover_url", "content_url", "published_at", "likes", "saves",
            "comments", "shares", "views", "engagement", "source_file",
        )
        values = [
            (run_id, *(item.get(field, "") for field in fields), utc_now())
            for item in contents
        ]
        placeholders = ",".join("?" for _ in range(len(fields) + 2))
        with self.connect() as connection:
            connection.executemany(
                f"""INSERT INTO content_records (run_id,{','.join(fields)},ingested_at)
                VALUES ({placeholders})
                ON CONFLICT(run_id,platform,content_id,keyword) DO UPDATE SET
                platform_label=excluded.platform_label, content_type=excluded.content_type,
                title=excluded.title, description=excluded.description, creator_id=excluded.creator_id,
                creator_name=excluded.creator_name, cover_url=excluded.cover_url, content_url=excluded.content_url,
                published_at=excluded.published_at, likes=excluded.likes, saves=excluded.saves,
                comments=excluded.comments, shares=excluded.shares, views=excluded.views,
                engagement=excluded.engagement, source_file=excluded.source_file, ingested_at=excluded.ingested_at""",
                values,
            )
        return len(contents)

    @staticmethod
    def content_fingerprints(contents: list[dict[str, Any]]) -> dict[tuple[str, str, str], str]:
        return {
            (item["platform"], item["content_id"], item["keyword"]): json.dumps(item, sort_keys=True, ensure_ascii=False)
            for item in contents
        }

    def _scope_sql(self, run_id: str | None) -> tuple[str, list[Any]]:
        if run_id and run_id != "all":
            return "SELECT * FROM content_records WHERE run_id=?", [run_id]
        return (
            """SELECT c.* FROM content_records c
            INNER JOIN (
                SELECT MAX(id) AS id FROM content_records GROUP BY platform, content_id, keyword
            ) latest ON latest.id=c.id""",
            [],
        )

    @staticmethod
    def _filters(platform: str | None, keyword: str | None, query: str | None) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if platform and platform != "all":
            clauses.append("platform=?")
            params.append(platform)
        if keyword and keyword != "all":
            clauses.append("keyword=?")
            params.append(keyword)
        if query:
            clauses.append("(title LIKE ? OR description LIKE ? OR creator_name LIKE ? OR creator_id LIKE ? OR content_id LIKE ?)")
            pattern = f"%{query.strip()}%"
            params.extend([pattern] * 5)
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def query_contents(
        self,
        run_id: str | None = None,
        platform: str | None = None,
        keyword: str | None = None,
        query: str | None = None,
        sort_by: str = "engagement",
        sort_order: str = "desc",
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        if sort_by not in SORTABLE_FIELDS:
            raise ValueError(f"Unsupported sort field: {sort_by}")
        scope_sql, scope_params = self._scope_sql(run_id)
        filter_sql, filter_params = self._filters(platform, keyword, query)
        direction = "ASC" if sort_order == "asc" else "DESC"
        title_collation = " COLLATE NOCASE" if sort_by == "title" else ""
        offset = (page - 1) * page_size
        with self.connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM ({scope_sql}) scoped{filter_sql}",
                (*scope_params, *filter_params),
            ).fetchone()[0]
            rows = connection.execute(
                f"""SELECT * FROM ({scope_sql}) scoped{filter_sql}
                ORDER BY {sort_by}{title_collation} {direction}, id DESC LIMIT ? OFFSET ?""",
                (*scope_params, *filter_params, page_size, offset),
            ).fetchall()
        return {
            "items": [dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        }

    def summary(self, run_id: str | None = None, platform: str | None = None, keyword: str | None = None) -> dict[str, Any]:
        scope_sql, scope_params = self._scope_sql(run_id)
        platform_filter_sql, platform_params = self._filters(platform, None, None)
        selected_filter_sql, selected_params = self._filters(platform, keyword, None)
        with self.connect() as connection:
            selected_rows = connection.execute(
                f"SELECT * FROM ({scope_sql}) scoped{selected_filter_sql}",
                (*scope_params, *selected_params),
            ).fetchall()
            comparison_rows = connection.execute(
                f"SELECT * FROM ({scope_sql}) scoped{platform_filter_sql}",
                (*scope_params, *platform_params),
            ).fetchall()
            all_rows = connection.execute(f"SELECT * FROM ({scope_sql}) scoped", scope_params).fetchall()
        selected = [dict(row) for row in selected_rows]
        comparison = [dict(row) for row in comparison_rows]
        all_items = [dict(row) for row in all_rows]
        summary = aggregate_contents(selected)
        summary["by_keyword"] = aggregate_contents(comparison)["by_keyword"]
        summary["filters"] = {
            "platforms": sorted({(item["platform"], item["platform_label"]) for item in all_items}),
            "keywords": sorted({item["keyword"] for item in comparison}),
        }
        return summary

    def query_comments(
        self,
        run_id: str | None = None,
        platform: str | None = None,
        content_id: str | None = None,
        level: int | None = None,
        query: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """Query collected first- and second-level comments in the shared SQLite database."""
        allowed_contents: set[tuple[str, str]] | None = None
        if run_id and run_id != "all":
            with self.connect() as connection:
                allowed_contents = {
                    (row["platform"], row["content_id"])
                    for row in connection.execute(
                        "SELECT DISTINCT platform, content_id FROM content_records WHERE run_id=?",
                        (run_id,),
                    ).fetchall()
                }

        query_text = (query or "").strip().lower()
        comments = []
        for item in load_normalized_comments_from_sqlite(self.db_path, platform):
            if allowed_contents is not None and (item["platform"], item["content_id"]) not in allowed_contents:
                continue
            if content_id and item["content_id"] != content_id:
                continue
            if level and item["level"] != level:
                continue
            if query_text:
                haystack = " ".join(
                    str(item.get(field, ""))
                    for field in ("content", "creator_name", "creator_id", "comment_id", "content_id")
                ).lower()
                if query_text not in haystack:
                    continue
            comments.append(item)

        comments.sort(key=lambda item: (item["published_at"], item["comment_id"]), reverse=True)
        total = len(comments)
        offset = (page - 1) * page_size
        return {
            "items": comments[offset:offset + page_size],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        }

    def query_comment_threads(
        self,
        platform: str,
        content_id: str,
        run_id: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> dict[str, Any]:
        """Return a content item's comments grouped into first-level threads."""
        result = self.query_comments(
            run_id=run_id,
            platform=platform,
            content_id=content_id,
            page=1,
            page_size=1_000_000,
        )
        comments = result["items"]
        roots = [item for item in comments if item["level"] == 1]
        roots.sort(key=lambda item: (item["published_at"], item["comment_id"]), reverse=True)

        replies_by_parent: dict[str, list[dict[str, Any]]] = {}
        for item in comments:
            if item["level"] == 2:
                replies_by_parent.setdefault(item["parent_comment_id"], []).append(item)
        for replies in replies_by_parent.values():
            replies.sort(key=lambda item: (item["published_at"], item["comment_id"]))

        root_total = len(roots)
        offset = (page - 1) * page_size
        threads = [
            {**root, "replies": replies_by_parent.get(root["comment_id"], [])}
            for root in roots[offset:offset + page_size]
        ]
        known_root_ids = {root["comment_id"] for root in roots}
        orphan_replies = [
            item for item in comments
            if item["level"] == 2 and item["parent_comment_id"] not in known_root_ids
        ]
        return {
            "items": threads,
            "total": len(comments),
            "root_total": root_total,
            "orphan_reply_count": len(orphan_replies),
            "orphan_replies": orphan_replies if page == 1 else [],
            "page": page,
            "page_size": page_size,
            "pages": (root_total + page_size - 1) // page_size,
        }

    def list_runs(self, page: int = 1, page_size: int = 20) -> dict[str, Any]:
        offset = (page - 1) * page_size
        with self.connect() as connection:
            total = connection.execute("SELECT COUNT(*) FROM crawl_runs").fetchone()[0]
            rows = connection.execute(
                "SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (page_size, offset),
            ).fetchall()
        return {
            "items": [dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        }

    def delete_run(self, run_id: str) -> bool:
        """Delete one or all finished crawl runs and their content records."""
        with self.connect() as connection:
            if run_id == "all":
                connection.execute("DELETE FROM crawl_runs WHERE status != 'running'")
                return True

            row = connection.execute(
                "SELECT status FROM crawl_runs WHERE run_id=?", (run_id,)
            ).fetchone()
            if row is None:
                return False
            if row["status"] == "running":
                raise ValueError("A running task cannot be deleted")
            connection.execute("DELETE FROM crawl_runs WHERE run_id=?", (run_id,))
        return True

    def export_csv(
        self,
        run_id: str | None = None,
        platform: str | None = None,
        keyword: str | None = None,
        query: str | None = None,
        sort_by: str = "engagement",
    ) -> bytes:
        result = self.query_contents(run_id, platform, keyword, query, sort_by, "desc", 1, 1_000_000)
        output = io.StringIO()
        columns = [
            "run_id", "platform_label", "keyword", "content_id", "title", "creator_id", "creator_name",
            "likes", "saves", "comments", "shares", "views", "engagement", "published_at", "content_url",
        ]
        writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(result["items"])
        return ("\ufeff" + output.getvalue()).encode("utf-8")


analytics_repository = AnalyticsRepository()
