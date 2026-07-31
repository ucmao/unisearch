import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectorRuntimeError } from '../src/core/contracts/errors';
import { DirectWebReadService, directWebSourceCitations } from '../src/server/services/DirectWebReadService';

function article(url: string, description: string) {
  return {
    content_id: url,
    content_url: url,
    title: '测试文章',
    summary: '测试摘要',
    description,
    creator_name: '测试作者',
    site_name: '测试站点',
    images: [],
  };
}

test('direct web reading returns transient articles and source citations', async () => {
  const service = new DirectWebReadService({
    async read(url) {
      return article(url, '这是一段足够长的网页正文。'.repeat(10));
    },
  });
  const result = await service.read(['https://example.com/article']);
  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(directWebSourceCitations(result.articles).map((source) => ({
    id: source.id,
    source: source.source,
    sourceUrl: source.sourceUrl,
  })), [{
    id: 'S1',
    source: 'web_reader',
    sourceUrl: 'https://example.com/article',
  }]);
});

test('direct web reading uses the browser fallback for short HTTP content', async () => {
  let browserReads = 0;
  const service = new DirectWebReadService({
    async read(url) {
      return article(url, '正文过短');
    },
    async readWithBrowser(url) {
      browserReads++;
      return article(url, '浏览器渲染后获得的完整正文。'.repeat(10));
    },
  });
  const result = await service.read(['https://example.com/dynamic']);
  assert.equal(browserReads, 1);
  assert.match(result.articles[0].description, /浏览器渲染后/);
});

test('invalid direct web targets never fall through to the browser', async () => {
  let browserReads = 0;
  const service = new DirectWebReadService({
    async read() {
      throw new ConnectorRuntimeError('INVALID_INPUT', '网页阅读器不允许访问本机或私有网络');
    },
    async readWithBrowser(url) {
      browserReads++;
      return article(url, '不应读取到的内容');
    },
  });
  await assert.rejects(() => service.read(['http://127.0.0.1/admin']), /不允许访问本机或私有网络/);
  assert.equal(browserReads, 0);
});
