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
    'about:blank#unisearch-crawler-douyin',
    'about:blank#unisearch-crawler-xhs',
  ]);
  const page: any = await getElectronCrawlerPage(context, 'douyin', 1);
  assert.equal(page.url(), 'about:blank#unisearch-crawler-douyin');
});

test('crawler page selection refuses an unrelated Electron page', async () => {
  const context = contextWithUrls(['http://127.0.0.1:8080/', 'https://www.example.com/']);
  await assert.rejects(() => getElectronCrawlerPage(context, 'douyin', 1), /未找到平台 douyin 的专用采集页面/);
});

test('standalone browser fallback accepts its only blank page', async () => {
  const context = contextWithUrls(['about:blank']);
  const page: any = await getElectronCrawlerPage(context, 'douyin', 1);
  assert.equal(page.url(), 'about:blank');
});

test('crawler page selection matches already-navigated platform URLs as fallback', async () => {
  const context = contextWithUrls([
    'http://127.0.0.1:8080/',
    'https://www.xiaohongshu.com/explore',
  ]);
  const page: any = await getElectronCrawlerPage(context, 'xhs', 1);
  assert.equal(page.url(), 'https://www.xiaohongshu.com/explore');
});

test('crawler runtime and electron sessions suppress unexpected file downloads', async () => {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const mainSource = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const baseCrawlerSource = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'crawler', 'base', 'BaseCrawler.ts'), 'utf8');

  // Electron 主进程中必须针对 crawler session 拦截 will-download
  assert.match(mainSource, /guardedCrawlerPartitions/);
  assert.match(mainSource, /view\.webContents\.session\.on\('will-download'/);
  assert.match(mainSource, /item\.cancel\(\)/);

  // BaseCrawler 中必须配置 Page.setDownloadBehavior 和 page.on('download')
  assert.match(baseCrawlerSource, /Page\.setDownloadBehavior/);
  assert.match(baseCrawlerSource, /page\.on\('download'/);
});
