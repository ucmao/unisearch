from __future__ import annotations

import sys
from typing import TextIO

from pydantic import ValidationError

import crawler_runtime
from tools.app_runner import run

from .schemas import CrawlerStartRequest
from .services.crawler_config import apply_crawler_request


def read_request(stream: TextIO = sys.stdin) -> CrawlerStartRequest:
    payload = stream.read()
    if not payload.strip():
        raise RuntimeError("Crawler worker received an empty request")
    try:
        return CrawlerStartRequest.model_validate_json(payload)
    except ValidationError as exc:
        raise RuntimeError("Crawler worker received an invalid request") from exc


async def worker_main() -> None:
    request = read_request()
    apply_crawler_request(request)
    await crawler_runtime.run_crawler()


if __name__ == "__main__":
    run(
        worker_main,
        crawler_runtime.async_cleanup,
        cleanup_timeout_seconds=15.0,
        on_first_interrupt=crawler_runtime.force_stop,
    )
