import assert from 'node:assert/strict';
import test from 'node:test';
import { searchPageBudget } from '../src/crawler/base/connectorHelpers';
import { BilibiliCrawler } from '../src/crawler/platforms/bili';
import { KuaishouCrawler } from '../src/crawler/platforms/kuaishou';
import { WeiboCrawler } from '../src/crawler/platforms/weibo';
import { ZhihuCrawler } from '../src/crawler/platforms/zhihu';
import { connectorOutput } from '../src/connectors/output/connector-output';
import { applyConfig, resetConfig } from '../src/tools/config';

test('large social-search targets receive duplicate-tolerant page budgets', () => {
  assert.equal(searchPageBudget(300, 10, 8, 80), 38);
  assert.equal(searchPageBudget(300, 20, 6, 40), 21);
  assert.equal(searchPageBudget(500, 10, 5, 60), 55);
});

test('Weibo mobile search is no longer capped at ten pages', async () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 300 });
  const crawler = new WeiboCrawler() as any;
  crawler.page = { goto: async () => {} };
  crawler.humanDelay = async () => {};
  const requestedPages: number[] = [];
  crawler.fetchMobileSearchPage = async (_containerId: string, page: number) => {
    requestedPages.push(page);
    return Array.from({ length: 10 }, (_, index) => ({ id: `${page}-${index}` }));
  };
  crawler.normalizeMobileStatus = async (item: any) => item;

  const results = await crawler.searchByMobileApi('人工智能');
  assert.equal(results.length, 300);
  assert.equal(requestedPages.length, 30);
  resetConfig();
});

test('Bilibili API search reaches 300 unique videos in ten pages', async () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 300 });
  const crawler = new BilibiliCrawler() as any;
  let requestedPages = 0;
  crawler.signer = {
    get: async (_url: string, params: any) => {
      requestedPages++;
      return {
        result: Array.from({ length: 30 }, (_, index) => ({
          bvid: `BV${String(params.page).padStart(2, '0')}${String(index).padStart(2, '0')}`,
        })),
      };
    },
  };
  crawler.page = {};
  crawler.humanDelay = async () => {};

  const results = await crawler.searchViaApi('人工智能');
  assert.equal(results.length, 300);
  assert.equal(requestedPages, 10);
  resetConfig();
});

test('Zhihu response harvesting can continue to a 300-item target', async () => {
  const crawler = new ZhihuCrawler() as any;
  let responseHandler: ((response: any) => Promise<void>) | undefined;
  let pageNumber = 0;
  const servePage = async () => {
    pageNumber++;
    await responseHandler?.({
      url: () => `https://www.zhihu.com/api/v4/search_v3?offset=${(pageNumber - 1) * 10}`,
      json: async () => ({
        data: Array.from({ length: 10 }, (_, index) => ({
          object: { id: `answer-${pageNumber}-${index}`, type: 'answer', question: { id: 'q1', name: '问题' } },
        })),
        paging: { is_end: pageNumber >= 30 },
      }),
    });
  };
  crawler.page = {
    on: (_event: string, handler: any) => { responseHandler = handler; },
    off: () => {},
    goto: async () => { await servePage(); },
    waitForTimeout: async () => {},
    evaluate: async () => { await servePage(); },
  };

  const results = await crawler.collectSearchApiResults('人工智能', 300);
  assert.equal(results.length, 300);
  assert.equal(pageNumber, 30);
});

test('Kuaishou continues GraphQL pagination after native cards are found', async () => {
  resetConfig();
  applyConfig({ keywords: '人工智能', crawler_max_notes_count: 60, start_page: 1, enable_comments: false });
  const crawler = new KuaishouCrawler() as any;
  crawler.page = { url: () => 'https://www.kuaishou.com/search/%E4%BA%BA%E5%B7%A5%E6%99%BA%E8%83%BD?source=SEARCH' };
  crawler.humanDelay = async () => {};
  crawler.scrapeVisibleSearchResults = async () => Array.from({ length: 20 }, (_, index) => ({ video_id: `native-${index}` }));
  let graphqlCalls = 0;
  crawler.graphql = async () => {
    graphqlCalls++;
    return {
      result: 1,
      pcursor: graphqlCalls >= 2 ? 'no_more' : `cursor-${graphqlCalls}`,
      searchSessionId: 'session',
      feeds: Array.from({ length: 20 }, (_, index) => ({
        photo: { id: `api-${graphqlCalls}-${index}`, caption: `item-${index}` },
        author: { id: `author-${index}`, name: `author-${index}` },
      })),
    };
  };
  const emitted: string[] = [];
  const originalEmit = connectorOutput.emitKuaishouVideo;
  connectorOutput.emitKuaishouVideo = async (item: any) => { emitted.push(String(item.video_id)); };
  try {
    await crawler.search();
  } finally {
    connectorOutput.emitKuaishouVideo = originalEmit;
    resetConfig();
  }

  assert.equal(graphqlCalls, 2);
  assert.equal(emitted.length, 60);
  assert.equal(new Set(emitted).size, 60);
});
