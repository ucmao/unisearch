import json

from cache.local_cache import ExpiringLocalCache
from proxy.base_proxy import IpCache


def test_proxy_cache_uses_process_local_memory():
    cache = IpCache()

    assert isinstance(cache.cache_client, ExpiringLocalCache)


def test_proxy_cache_filters_expired_entries():
    cache = IpCache()
    cache.set_ip(
        "static_127.0.0.1_8080",
        json.dumps({"ip": "127.0.0.1", "port": 8080}),
        ex=-1,
    )

    assert cache.load_all_ip("static") == []
