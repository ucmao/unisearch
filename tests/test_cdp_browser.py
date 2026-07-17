# -*- coding: utf-8 -*-
from unittest.mock import AsyncMock, MagicMock

import pytest

import config
from tools.cdp_browser import CDPBrowserManager


@pytest.mark.asyncio
async def test_existing_browser_connects_directly_to_devtools_browser(monkeypatch):
    monkeypatch.setattr(config, "CDP_CONNECT_EXISTING", True)
    monkeypatch.setattr(config, "BROWSER_LAUNCH_TIMEOUT", 60)

    manager = CDPBrowserManager()
    manager.debug_port = 9222
    manager._get_browser_websocket_url = AsyncMock(  # type: ignore[method-assign]
        side_effect=AssertionError("existing browser mode must not call /json/version")
    )

    browser = MagicMock()
    browser.is_connected.return_value = True
    browser.contexts = []

    playwright = MagicMock()
    playwright.chromium.connect_over_cdp = AsyncMock(return_value=browser)

    await manager._connect_via_cdp(playwright)

    playwright.chromium.connect_over_cdp.assert_awaited_once_with(
        "ws://localhost:9222/devtools/browser",
        timeout=60000,
    )


@pytest.mark.asyncio
async def test_existing_browser_falls_back_to_discovered_websocket_url(monkeypatch):
    monkeypatch.setattr(config, "CDP_CONNECT_EXISTING", True)
    monkeypatch.setattr(config, "BROWSER_LAUNCH_TIMEOUT", 60)

    manager = CDPBrowserManager()
    manager.debug_port = 9222
    manager._get_browser_websocket_url = AsyncMock(  # type: ignore[method-assign]
        return_value="ws://localhost:9222/devtools/browser/generated-id"
    )

    browser = MagicMock()
    browser.is_connected.return_value = True
    browser.contexts = []

    playwright = MagicMock()
    playwright.chromium.connect_over_cdp = AsyncMock(
        side_effect=[RuntimeError("direct websocket failed"), browser]
    )

    await manager._connect_via_cdp(playwright)

    manager._get_browser_websocket_url.assert_awaited_once_with(9222)
    assert playwright.chromium.connect_over_cdp.await_args_list[0].args == (
        "ws://localhost:9222/devtools/browser",
    )
    assert playwright.chromium.connect_over_cdp.await_args_list[0].kwargs == {
        "timeout": 60000,
    }
    assert playwright.chromium.connect_over_cdp.await_args_list[1].args == (
        "ws://localhost:9222/devtools/browser/generated-id",
    )
    assert playwright.chromium.connect_over_cdp.await_args_list[1].kwargs == {
        "timeout": 60000,
    }


@pytest.mark.asyncio
async def test_launched_browser_connects_through_http_endpoint(monkeypatch):
    monkeypatch.setattr(config, "CDP_CONNECT_EXISTING", False)
    monkeypatch.setattr(config, "BROWSER_LAUNCH_TIMEOUT", 60)

    manager = CDPBrowserManager()
    manager.debug_port = 9223
    manager._get_browser_websocket_url = AsyncMock(  # type: ignore[method-assign]
        side_effect=AssertionError("launched browser should use the HTTP CDP endpoint")
    )

    browser = MagicMock()
    browser.is_connected.return_value = True
    browser.contexts = []

    playwright = MagicMock()
    playwright.chromium.connect_over_cdp = AsyncMock(return_value=browser)

    await manager._connect_via_cdp(playwright)

    playwright.chromium.connect_over_cdp.assert_awaited_once_with(
        "http://127.0.0.1:9223",
        timeout=60000,
    )


def test_each_platform_uses_a_separate_port_range(monkeypatch):
    starts = {}
    for platform in ("xhs", "dy", "ks", "bili", "wb", "tieba", "zhihu"):
        monkeypatch.setattr(config, "PLATFORM", platform)
        starts[platform] = CDPBrowserManager._platform_port_range_start()

    assert starts["xhs"] == config.CDP_DEBUG_PORT
    assert len(set(starts.values())) == len(starts)
    assert all(
        right - left >= 100
        for left, right in zip(sorted(starts.values()), sorted(starts.values())[1:])
    )


@pytest.mark.asyncio
async def test_existing_browser_new_page_is_tracked_and_script_is_page_scoped(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(config, "CDP_CONNECT_EXISTING", True)
    script_path = tmp_path / "stealth.js"
    script_path.write_text("// stealth", encoding="utf-8")

    page = MagicMock()
    page.add_init_script = AsyncMock()
    context = MagicMock()
    context.new_page = AsyncMock(return_value=page)

    manager = CDPBrowserManager()
    manager.browser_context = context

    await manager.add_stealth_script(str(script_path))
    created_page = await manager.new_page()

    assert created_page is page
    assert manager._owned_pages == [page]
    page.add_init_script.assert_awaited_once_with(path=str(script_path))
    context.add_init_script.assert_not_called()


@pytest.mark.asyncio
async def test_existing_browser_cleanup_closes_only_owned_pages(monkeypatch):
    monkeypatch.setattr(config, "CDP_CONNECT_EXISTING", True)

    owned_page = MagicMock()
    owned_page.is_closed.return_value = False
    owned_page.close = AsyncMock()
    user_page = MagicMock()

    context = MagicMock()
    context.pages = [user_page, owned_page]
    context.close = AsyncMock()
    browser = MagicMock()
    browser.close = AsyncMock()

    manager = CDPBrowserManager()
    manager.browser_context = context
    manager.browser = browser
    manager._owned_pages = [owned_page]

    await manager.cleanup(force=True)

    owned_page.close.assert_awaited_once_with()
    context.close.assert_not_awaited()
    browser.close.assert_not_awaited()
    assert manager.browser_context is None
    assert manager.browser is None
    assert manager._owned_pages == []
