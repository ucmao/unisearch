import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserContext, Page } from 'playwright';
import { recoverElectronCrawlerPage } from '../src/crawler/base/BaseCrawler';
import { resolveCrawlerRunStatus } from '../src/server/services/CrawlerManager';

function page(url: string, closed = false): Page {
  return {
    url: () => url,
    isClosed: () => closed,
  } as unknown as Page;
}

test('crawler page recovery rebinds to a replacement platform target', async () => {
  const closedMarker = page('about:blank#unisearch-crawler-boss', true);
  const replacement = page('https://www.zhipin.com/web/geek/job?query=会计');
  const unrelated = page('http://localhost:8080');
  const context = {
    pages: () => [closedMarker, unrelated, replacement],
  } as unknown as BrowserContext;

  const recovered = await recoverElectronCrawlerPage(
    context,
    'boss',
    (candidate) => candidate.url().includes('zhipin.com'),
    1,
    0,
  );

  assert.equal(recovered, replacement);
});

test('crawler page recovery returns null instead of selecting an unrelated page', async () => {
  const context = {
    pages: () => [page('about:blank#unisearch-crawler-boss', true), page('http://localhost:8080')],
  } as unknown as BrowserContext;

  assert.equal(
    await recoverElectronCrawlerPage(context, 'boss', (candidate) => candidate.url().includes('zhipin.com'), 1, 0),
    null,
  );
});

test('clean exits with a partial-result warning are not marked completed', () => {
  assert.equal(resolveCrawlerRunStatus(0, false, '仅采集到 15/100 条'), 'partial');
  assert.equal(resolveCrawlerRunStatus(0, false, null), 'completed');
  assert.equal(resolveCrawlerRunStatus(1, false, '仅采集到 15/100 条'), 'failed');
  assert.equal(resolveCrawlerRunStatus(0, true, '仅采集到 15/100 条'), 'stopped');
});
