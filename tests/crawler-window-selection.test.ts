import assert from 'node:assert/strict';
import test from 'node:test';
import { getElectronCrawlerPage } from '../src/crawler/base/BaseCrawler';

function contextWithUrls(urls: string[]): any {
  const pages = urls.map((url) => ({ url: () => url }));
  return { pages: () => pages };
}

test('crawler page selection uses the platform marker instead of pages[0]', async () => {
  const context = contextWithUrls([
    'http://127.0.0.1:8080/',
    'about:blank#unisearch-crawler-dy',
    'about:blank#unisearch-crawler-xhs',
  ]);
  const page: any = await getElectronCrawlerPage(context, 'dy', 1);
  assert.equal(page.url(), 'about:blank#unisearch-crawler-dy');
});

test('crawler page selection refuses an unrelated Electron page', async () => {
  const context = contextWithUrls(['http://127.0.0.1:8080/', 'https://www.example.com/']);
  await assert.rejects(() => getElectronCrawlerPage(context, 'dy', 1), /未找到平台 dy 的专用采集页面/);
});

test('standalone browser fallback accepts its only blank page', async () => {
  const context = contextWithUrls(['about:blank']);
  const page: any = await getElectronCrawlerPage(context, 'dy', 1);
  assert.equal(page.url(), 'about:blank');
});
