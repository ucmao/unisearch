import assert from 'node:assert/strict';
import test from 'node:test';
import { BiliWbiSigner } from '../src/crawler/base/biliWbiSigner';

/** Stand-in for a Playwright page whose `evaluate` just replays canned JSON. */
function fakePage(responses: Record<string, any>, calls: string[] = []) {
  return {
    calls,
    evaluate: async (_fn: unknown, url: string) => {
      calls.push(url);
      const match = Object.keys(responses).find((key) => url.includes(key));
      if (!match) throw new Error(`unexpected url ${url}`);
      return responses[match];
    },
  } as any;
}

const NAV_KEYS = {
  '/x/web-interface/nav': {
    code: -101,
    data: {
      wbi_img: {
        img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
        sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
      },
    },
  },
};

async function withFrozenClock<T>(seconds: number, fn: () => Promise<T>): Promise<T> {
  const realNow = Date.now;
  Date.now = () => seconds * 1000;
  try {
    return await fn();
  } finally {
    Date.now = realNow;
  }
}

test('derives the documented mixin key and signs deterministically', async () => {
  const signer = new BiliWbiSigner(fakePage(NAV_KEYS));
  // Warm the key cache before freezing the clock so TTL logic stays untouched.
  await signer.signQuery({ warmup: 1 });

  const query = await withFrozenClock(1702204169, () =>
    signer.signQuery({ foo: '114', bar: '514', baz: 1919810 }));

  // Params sorted alphabetically, wts folded in, w_rid appended last.
  assert.equal(
    query,
    'bar=514&baz=1919810&foo=114&wts=1702204169&w_rid=84228f6bffb7140983b951973f4042a5',
  );
});

test('reads wbi keys once and reuses them across calls', async () => {
  const calls: string[] = [];
  const signer = new BiliWbiSigner(fakePage(NAV_KEYS, calls));
  await signer.signQuery({ a: 1 });
  await signer.signQuery({ b: 2 });
  assert.equal(calls.filter((url) => url.includes('/nav')).length, 1);

  signer.invalidate();
  await signer.signQuery({ c: 3 });
  assert.equal(calls.filter((url) => url.includes('/nav')).length, 2);
});

test('drops empty params and strips characters Bilibili filters out', async () => {
  const signer = new BiliWbiSigner(fakePage(NAV_KEYS));
  const query = await signer.signQuery({ keyword: "it's (fine)!", blank: '', missing: undefined });
  const keyword = new URLSearchParams(query).get('keyword');
  assert.equal(keyword, 'its fine');
  assert.ok(!query.includes('blank='));
  assert.ok(!query.includes('missing='));
});

test('rejects the v_voucher risk-control shell so callers can fall back', async () => {
  const signer = new BiliWbiSigner(fakePage({
    ...NAV_KEYS,
    '/x/web-interface/wbi/search/type': { code: 0, message: 'OK', data: { v_voucher: 'voucher_abc' } },
  }));
  await assert.rejects(
    () => signer.get('https://api.bilibili.com/x/web-interface/wbi/search/type', { keyword: 'x' }),
    /v_voucher/,
  );
});

test('surfaces non-zero codes and re-reads keys after a 403', async () => {
  const calls: string[] = [];
  const signer = new BiliWbiSigner(fakePage({
    ...NAV_KEYS,
    '/x/space/wbi/arc/search': { code: -403, message: '访问权限不足' },
  }, calls));

  await assert.rejects(
    () => signer.get('https://api.bilibili.com/x/space/wbi/arc/search', { mid: '1' }),
    /-403/,
  );
  // The cache was invalidated, so the next call re-reads nav.
  await signer.signQuery({ a: 1 });
  assert.equal(calls.filter((url) => url.includes('/nav')).length, 2);
});

test('passes through a well-formed payload', async () => {
  const signer = new BiliWbiSigner(fakePage({
    ...NAV_KEYS,
    '/x/web-interface/wbi/search/type': {
      code: 0,
      data: { numResults: 1, result: [{ bvid: 'BV1xx411c7mD', title: 'hello' }] },
    },
  }));
  const data = await signer.get('https://api.bilibili.com/x/web-interface/wbi/search/type', { keyword: 'x' });
  assert.equal(data.result[0].bvid, 'BV1xx411c7mD');
});
