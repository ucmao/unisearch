import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TiebaCrawler } from '../src/crawler/platforms/tieba';
import { applyConfig, resetConfig } from '../src/tools/config';

interface Harness {
  requestedPn: number[];
  ingested: any[];
}

/**
 * Drives the real search loop with a stubbed page fetch. `serve` decides what a
 * given `pn` returns, so the loop's stopping rules can be exercised without a
 * browser.
 */
async function runSearch(
  serve: (pn: number) => string[],
  options: { keywords?: string; maxItems: number },
): Promise<Harness> {
  resetConfig();
  applyConfig({
    keywords: options.keywords ?? '自媒体运营',
    crawler_max_notes_count: options.maxItems,
    enable_comments: false,
  });
  const harness: Harness = { requestedPn: [], ingested: [] };
  const crawler = new TiebaCrawler() as any;
  crawler.page = {};
  crawler.humanDelay = async () => {};
  crawler.ingestSearchResults = async (posts: any[]) => { harness.ingested = posts; };
  crawler.collectSearchPage = async (_keyword: string, pn: number) => {
    harness.requestedPn.push(pn);
    const ids = serve(pn);
    return {
      posts: ids.map((id) => ({ note_id: id, title: id, note_url: `https://tieba.baidu.com/p/${id}`, comment_count: 0 })),
      hasMore: ids.length > 0,
    };
  };
  await crawler.search();
  resetConfig();
  return harness;
}

const PAGE_SIZE = 20;
/** `pn` is a 1-based page index on the multsearch endpoint. */
const byPage = (total: number) => (pn: number) => ids((pn - 1) * PAGE_SIZE, total);

function ids(from: number, total: number): string[] {
  const out: string[] = [];
  for (let index = from; index < Math.min(from + PAGE_SIZE, total); index++) out.push(`t${index}`);
  return out;
}

test('search paginates until the requested amount is reached', async () => {
  // The DOM-scraping implementation saw five threads per keyword and no more, so
  // any target above that was unreachable while the run still reported success.
  const harness = await runSearch(byPage(200), { maxItems: 50 });
  assert.equal(harness.ingested.length, 50);
  assert.deepEqual(harness.requestedPn, [1, 2, 3]);
});

test('search can walk fifteen pages to satisfy a 300-item request', async () => {
  const harness = await runSearch(byPage(400), { maxItems: 300 });
  assert.equal(harness.ingested.length, 300);
  assert.equal(harness.requestedPn.length, 15);
  assert.deepEqual(harness.requestedPn, Array.from({ length: 15 }, (_, index) => index + 1));
});

test('search stops at the end of the result set instead of looping', async () => {
  const harness = await runSearch(byPage(23), { maxItems: 100 });
  assert.equal(harness.ingested.length, 23);
  assert.ok(harness.requestedPn.length <= 4, `多请求了 ${harness.requestedPn.length} 页`);
});

test('a page that only repeats what is already collected ends the walk', async () => {
  // Baidu keeps answering past the last real page; "no growth" is the signal.
  const harness = await runSearch(() => ids(0, 20), { maxItems: 100 });
  assert.equal(harness.ingested.length, 20);
  assert.ok(harness.requestedPn.length <= 4, `重复页请求了 ${harness.requestedPn.length} 次`);
});

test('a single-page result set is still ingested', async () => {
  const harness = await runSearch(byPage(5), { maxItems: 50 });
  assert.equal(harness.ingested.length, 5);
});

test('an empty result set neither loops nor throws', async () => {
  const harness = await runSearch(() => [], { maxItems: 50 });
  assert.equal(harness.ingested.length, 0);
  assert.equal(harness.requestedPn.length, 1);
});

test('every keyword gets its own pagination run', async () => {
  const harness = await runSearch(byPage(200), { keywords: 'a,b', maxItems: 20 });
  // ingested holds the last keyword only; the request log covers both.
  assert.equal(harness.ingested.length, 20);
  assert.equal(harness.requestedPn.filter((pn) => pn === 1).length, 2, '第二个关键词没有从第一页重新开始');
});

test('a captured multsearch payload maps onto the stored fields', async () => {
  const payload = JSON.parse(
    readFileSync(path.join(__dirname, 'fixtures/tieba-search-multsearch.json'), 'utf-8'),
  );
  const crawler = new TiebaCrawler() as any;
  const { posts, hasMore } = crawler.normalizeSearchPayload(payload);

  assert.equal(hasMore, true);
  // The card list also carries a forum card, which is not a result.
  assert.deepEqual(posts.map((post: any) => post.note_id), ['10533844286', '10846980096', '10445136629']);
  assert.deepEqual(posts[0], {
    note_id: '10533844286',
    title: '制造业干到头了？他靠科莱特SAP培训找到了新出路',
    desc: '一次深思熟虑的转行 在制造业摸爬滚打十余年，兼任质量组&库房组的组长，'
      + '高学员对生产流程、前台业务早已驾轻就熟。但随着职业发展的瓶颈逐渐显现，他萌生了转行的想法。',
    note_url: 'https://tieba.baidu.com/p/10533844286',
    user_nickname: '滴答嘀嗒滴嗒嘀',
    creator_hash: '886597166',
    comment_count: 14,
    tieba_name: 'sap培训',
    tieba_link: 'https://tieba.baidu.com/f?kw=sap%E5%9F%B9%E8%AE%AD',
  });
});

test('the last page of a query reports no more pages', () => {
  const crawler = new TiebaCrawler() as any;
  assert.deepEqual(crawler.normalizeSearchPayload({ data: { has_more: 0, card_list: [] } }), {
    posts: [],
    hasMore: false,
  });
  assert.deepEqual(crawler.normalizeSearchPayload(null), { posts: [], hasMore: false });
});
