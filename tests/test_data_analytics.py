# -*- coding: utf-8 -*-
import sqlite3

from fastapi.testclient import TestClient

from api.main import app
from api.services.analytics_repository import AnalyticsRepository
from api.services.data_analytics import (
    load_normalized_comments_from_sqlite,
    load_normalized_contents_from_sqlite,
    normalize_content,
    parse_metric,
)


def test_parse_metric_handles_platform_formats():
    assert parse_metric("2.4万") == 24_000
    assert parse_metric("1.2w") == 12_000
    assert parse_metric("3千") == 3_000
    assert parse_metric("1,234") == 1_234
    assert parse_metric(None) == 0


def test_legacy_file_management_routes_are_removed():
    client = TestClient(app)
    assert client.get("/api/data/files").status_code == 404
    assert client.request("DELETE", "/api/data/files", json={"paths": []}).status_code == 404
    assert client.get("/api/data/download/example.json").status_code == 404
    assert client.get("/api/data/stats").status_code == 404
    assert client.post("/api/data/analytics/sync").status_code == 404


def test_loads_contents_and_comment_levels_from_shared_sqlite(tmp_path, monkeypatch):
    import api.routers.data as data_router

    db_path = tmp_path / "analytics.sqlite3"
    repository = AnalyticsRepository(db_path)
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE xhs_note (
                id INTEGER PRIMARY KEY, note_id TEXT, title TEXT, creator_hash TEXT, nickname TEXT,
                liked_count TEXT, collected_count TEXT, comment_count TEXT, share_count TEXT,
                note_url TEXT, source_keyword TEXT, time INTEGER
            );
            CREATE TABLE xhs_note_comment (
                id INTEGER PRIMARY KEY, comment_id TEXT, note_id TEXT, parent_comment_id TEXT,
                content TEXT, creator_hash TEXT, nickname TEXT, create_time INTEGER,
                like_count TEXT, sub_comment_count INTEGER
            );
            INSERT INTO xhs_note VALUES
                (1, 'note-1', 'SQLite 内容', 'author-1', '作者', '10', '2', '8', '1', '', '测试', 1700000000);
            INSERT INTO xhs_note_comment VALUES
                (1, 'comment-1', 'note-1', '', '一级评论', 'user-1', '用户一', 1700000001, '3', 1),
                (2, 'comment-2', 'note-1', 'comment-1', '二级回复', 'user-2', '用户二', 1700000002, '1', 0);
            """
        )

    contents = load_normalized_contents_from_sqlite(db_path, "xhs")
    comments = load_normalized_comments_from_sqlite(db_path, "xhs")
    assert [item["content_id"] for item in contents] == ["note-1"]
    assert [item["level"] for item in comments] == [1, 2]

    run_id = repository.create_run({"platform": "xhs", "crawler_type": "search"})
    repository.finish_run(run_id, "completed", 0, contents)
    monkeypatch.setattr(data_router, "analytics_repository", repository)
    response = TestClient(app).get("/api/data/analytics/comments", params={"run_id": run_id, "level": 2})
    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["parent_comment_id"] == "comment-1"

    threads_response = TestClient(app).get(
        "/api/data/analytics/comments/threads",
        params={"run_id": run_id, "platform": "xhs", "content_id": "note-1"},
    )
    assert threads_response.status_code == 200
    threads = threads_response.json()
    assert threads["total"] == 2
    assert threads["root_total"] == 1
    assert threads["orphan_replies"] == []
    assert threads["items"][0]["comment_id"] == "comment-1"
    assert threads["items"][0]["replies"][0]["comment_id"] == "comment-2"


def test_analytics_api_filters_sorts_and_paginates(tmp_path, monkeypatch):
    import api.routers.data as data_router

    rows = [
        {
            "aweme_id": "1", "title": "低互动内容", "creator_hash": "u1", "nickname": "账号一",
            "liked_count": "10", "comment_count": "1", "share_count": "0", "collected_count": "0",
            "aweme_url": "https://example.com/1", "source_keyword": "关键词A",
        },
        {
            "aweme_id": "2", "title": "高互动内容", "creator_hash": "u2", "nickname": "账号二",
            "liked_count": "100", "comment_count": "20", "share_count": "10", "collected_count": "30",
            "aweme_url": "https://example.com/2", "source_keyword": "关键词B",
        },
    ]
    repository = AnalyticsRepository(tmp_path / "analytics.sqlite3")
    contents = [
        content
        for row in rows
        if (content := normalize_content("dy", row, "sqlite:douyin_aweme")) is not None
    ]
    assert len(contents) == 2
    run_id = repository.create_run({"platform": "dy", "crawler_type": "search"})
    repository.finish_run(run_id, "completed", 0, contents)
    monkeypatch.setattr(data_router, "analytics_repository", repository)
    client = TestClient(app)

    summary = client.get("/api/data/analytics/summary", params={"platform": "dy"})
    assert summary.status_code == 200
    assert summary.json()["totals"]["content_count"] == 2
    assert summary.json()["filters"]["keywords"] == ["关键词A", "关键词B"]

    result = client.get(
        "/api/data/analytics/contents",
        params={"platform": "dy", "query": "内容", "sort_by": "engagement", "page": 1, "page_size": 1},
    )
    assert result.status_code == 200
    assert result.json()["total"] == 2
    assert result.json()["pages"] == 2
    assert result.json()["items"][0]["content_id"] == "2"
    assert result.json()["items"][0]["platform"] == "dy"

    runs = client.get("/api/data/analytics/runs")
    assert runs.status_code == 200
    assert runs.json()["items"][0]["run_id"] == run_id
    run_result = client.get(
        "/api/data/analytics/contents",
        params={"run_id": run_id, "keyword": "关键词B"},
    )
    assert run_result.json()["total"] == 1

    exported = client.get("/api/data/analytics/export", params={"platform": "dy", "keyword": "关键词B"})
    assert exported.status_code == 200
    assert exported.content.startswith(b"\xef\xbb\xbf")
    assert "attachment" in exported.headers["content-disposition"]


def test_repository_persists_runs_queries_and_exports(tmp_path):
    repository = AnalyticsRepository(tmp_path / "analytics.sqlite3")
    run_id = repository.create_run({
        "platform": "xhs", "crawler_type": "search", "keywords": "护肤", "save_option": "jsonl",
    })
    contents = [{
        "platform": "xhs", "platform_label": "小红书", "content_id": "note-1", "content_type": "normal",
        "keyword": "护肤", "title": "真实账号内容", "description": "说明", "creator_id": "user-123",
        "creator_name": "真实昵称", "cover_url": "", "content_url": "https://example.com/note-1",
        "published_at": 1_700_000_000, "likes": 100, "saves": 20, "comments": 5, "shares": 2,
        "views": 1000, "engagement": 127, "source_file": "xhs/jsonl/search_contents.jsonl",
    }]
    repository.finish_run(run_id, "completed", 0, contents)

    runs = repository.list_runs()
    assert runs["total"] == 1
    assert runs["items"][0]["run_id"] == run_id
    assert runs["items"][0]["item_count"] == 1

    result = repository.query_contents(run_id=run_id, query="真实账号", page=1, page_size=20)
    assert result["total"] == 1
    assert result["items"][0]["creator_id"] == "user-123"

    summary = repository.summary(run_id=run_id)
    assert summary["totals"]["engagement"] == 127
    exported = repository.export_csv(run_id=run_id)
    assert exported.startswith(b"\xef\xbb\xbf")
    assert "真实昵称" in exported.decode("utf-8-sig")


def test_delete_finished_run_but_not_running_run(tmp_path, monkeypatch):
    import api.routers.data as data_router

    repository = AnalyticsRepository(tmp_path / "analytics.sqlite3")
    finished_run = repository.create_run({"platform": "xhs", "crawler_type": "search"})
    repository.finish_run(finished_run, "completed", 0, [])
    running_run = repository.create_run({"platform": "dy", "crawler_type": "search"})
    monkeypatch.setattr(data_router, "analytics_repository", repository)
    client = TestClient(app)

    deleted = client.delete(f"/api/data/analytics/runs/{finished_run}")
    blocked = client.delete(f"/api/data/analytics/runs/{running_run}")

    assert deleted.status_code == 200
    assert blocked.status_code == 409
    assert {run["run_id"] for run in repository.list_runs()["items"]} == {running_run}


def test_delete_all_finished_runs(tmp_path, monkeypatch):
    import api.routers.data as data_router

    repository = AnalyticsRepository(tmp_path / "analytics.sqlite3")
    finished_run_1 = repository.create_run({"platform": "xhs", "crawler_type": "search"})
    repository.finish_run(finished_run_1, "completed", 0, [])
    finished_run_2 = repository.create_run({"platform": "xhs", "crawler_type": "search"})
    repository.finish_run(finished_run_2, "completed", 0, [])
    running_run = repository.create_run({"platform": "dy", "crawler_type": "search"})

    monkeypatch.setattr(data_router, "analytics_repository", repository)
    client = TestClient(app)

    deleted_all = client.delete("/api/data/analytics/runs/all")
    assert deleted_all.status_code == 200
    
    remaining_runs = repository.list_runs()["items"]
    assert len(remaining_runs) == 1
    assert remaining_runs[0]["run_id"] == running_run
