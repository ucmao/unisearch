import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LiveSearchService,
  parseBaiduSearchHtml,
  parseSo360SearchHtml,
  parseSogouSearchHtml,
  toLiveSourceCitations,
} from '../src/server/services/LiveSearchService';

const baiduHtml = `
  <div class="c-container">
    <h3><a href="https://www.baidu.com/link?url=weather">福州天气预报</a></h3>
    <div class="c-abstract">今天多云，最高温度 31℃。</div>
    <span class="c-showurl">天气服务</span>
  </div>`;

const sogouHtml = `
  <div class="results"><div class="vrwrap">
    <h3 class="vr-title"><a href="/link?url=forecast">福州今日天气</a></h3>
    <p>今日有阵雨，数据更新于 10 分钟前。</p>
    <span class="cite">气象网站</span>
  </div></div>`;

const so360Html = `
  <ul><li class="res-list">
    <h3 class="res-title"><a href="https://www.so.com/link?m=forecast">福州天气实况</a></h3>
    <p class="res-desc">当前温度 28℃，请留意短时降雨。</p>
    <span class="res-site">天气数据</span>
  </li></ul>`;

test('search result parsers return transient evidence drafts', () => {
  assert.deepEqual(parseBaiduSearchHtml(baiduHtml).map((item) => item.source), ['baidu']);
  assert.deepEqual(parseSogouSearchHtml(sogouHtml).map((item) => item.source), ['sogou']);
  assert.deepEqual(parseSo360SearchHtml(so360Html).map((item) => item.source), ['so360']);
  assert.equal(parseSogouSearchHtml(sogouHtml)[0].sourceUrl, 'https://www.sogou.com/link?url=forecast');
});

test('live search fans out without creating persistent document records', async () => {
  const requests: Array<{ url: string; options?: Record<string, unknown> }> = [];
  const client = {
    async get(url: string, options?: Record<string, unknown>) {
      requests.push({ url, options });
      if (url.includes('baidu.com')) return { data: baiduHtml };
      if (url.includes('sogou.com')) return { data: sogouHtml };
      return { data: so360Html };
    },
  };
  const service = new LiveSearchService(client);
  const evidence = await service.search('福州 今天天气', { limit: 3 });

  assert.deepEqual(evidence.map((item) => item.id), ['S1', 'S2', 'S3']);
  assert.deepEqual(evidence.map((item) => item.source), ['baidu', 'sogou', 'so360']);
  assert.equal(requests.length, 3);
  assert.equal(requests.every((request) => request.options?.maxRetries === 1), true);
  assert.equal(requests.every((request) => request.options?.timeout === 4_000), true);

  const citations = toLiveSourceCitations(evidence);
  assert.equal('excerpt' in citations[0], false);
  assert.deepEqual(Object.keys(citations[0]).sort(), ['fetchedAt', 'id', 'source', 'sourceUrl', 'title']);
});
