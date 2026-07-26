import assert from 'node:assert/strict';
import test from 'node:test';
import { TiebaCrawler } from '../src/crawler/platforms/tieba';
import { applyConfig, resetConfig } from '../src/tools/config';

interface Harness {
  requestedPn: number[];
  ingested: any[];
}

/**
 * Drives the real search loop with a stubbed page fetch. `serve` decides what a
 * given `pn` value returns, which is how both pagination conventions are
 * simulated without touching the network.
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
    return serve(pn).map((id) => ({ note_id: id, title: id, note_url: `https://tieba.baidu.com/p/${id}`, comment_count: 0 }));
  };
  await crawler.search();
  resetConfig();
  return harness;
}

const PAGE_SIZE = 10;
/** Endpoint where `pn` is a 1-based page index. */
const byPage = (total: number) => (pn: number) => ids((pn - 1) * PAGE_SIZE, total);
/** Endpoint where `pn` is an item offset. */
const byOffset = (total: number) => (pn: number) => ids(pn, total);

function ids(from: number, total: number): string[] {
  const out: string[] = [];
  for (let index = from; index < Math.min(from + PAGE_SIZE, total); index++) out.push(`t${index}`);
  return out;
}

test('search paginates until the requested amount is reached', async () => {
  // The old implementation fetched exactly one page, so a 50-item target could
  // never be satisfied and the run still finished as "completed".
  const harness = await runSearch(byPage(200), { maxItems: 50 });
  assert.equal(harness.ingested.length, 50);
  assert.ok(harness.requestedPn.length >= 5, `只请求了 ${harness.requestedPn.length} 页`);
});

test('search stops at the end of the result set instead of looping', async () => {
  const harness = await runSearch(byPage(23), { maxItems: 50 });
  assert.equal(harness.ingested.length, 23);
  // Two consecutive barren pages end it; it must not walk to the page cap.
  assert.ok(harness.requestedPn.length <= 6, `多请求了 ${harness.requestedPn.length} 页`);
});

test('offset-style pn is detected and adapted to, without skipping the first result', async () => {
  const harness = await runSearch(byOffset(200), { maxItems: 50 });
  assert.equal(harness.ingested.length, 50);
  const collected = harness.ingested.map((post) => post.note_id);
  assert.ok(collected.includes('t0'), '重新按 offset 抓取时漏掉了第一条');
  assert.equal(new Set(collected).size, collected.length, '跨页出现重复');
  assert.ok(harness.requestedPn.includes(0), '未从 offset 0 重新开始');
});

test('a duplicate-heavy page 2 is not mistaken for offset pagination', async () => {
  // Baidu results repeat themselves often. Half of page 2 overlapping page 1 is
  // ordinary duplication, not evidence that pn shifted by one item — treating it
  // as offset mode would make the crawler skip pages 2 through 9.
  const harness = await runSearch((pn) => {
    if (pn === 1) return ids(0, 200);
    if (pn === 2) return [...ids(5, 200).slice(0, 5), ...ids(10, 200).slice(0, 5)];
    return ids((pn - 1) * PAGE_SIZE, 200);
  }, { maxItems: 40 });
  assert.ok(!harness.requestedPn.includes(0), '误判为 offset 分页');
  assert.equal(harness.ingested.length, 40);
});

test('a single-page result set is still ingested', async () => {
  const harness = await runSearch(byPage(5), { maxItems: 50 });
  assert.equal(harness.ingested.length, 5);
});

test('an empty result set neither loops nor throws', async () => {
  const harness = await runSearch(() => [], { maxItems: 50 });
  assert.equal(harness.ingested.length, 0);
  assert.ok(harness.requestedPn.length <= 3, `空结果请求了 ${harness.requestedPn.length} 次`);
});

test('every keyword gets its own pagination run', async () => {
  const harness = await runSearch(byPage(200), { keywords: 'a,b', maxItems: 20 });
  // ingested holds the last keyword only; the request log covers both.
  assert.equal(harness.ingested.length, 20);
  assert.ok(harness.requestedPn.filter((pn) => pn === 1).length === 2, '第二个关键词没有从第一页重新开始');
});
