import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LiveSearchService,
  parseBaiduSearchHtml,
  parseBingSearchHtml,
  parseSo360SearchHtml,
  parseSogouSearchHtml,
  parseToutiaoSearchHtml,
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

const bingHtml = `
  <ol id="b_results"><li class="b_algo">
    <h2><a href="https://weather.example/fuzhou">福州逐小时天气</a></h2>
    <div class="b_caption"><p>未来两小时可能有短时阵雨。</p></div>
    <cite>天气示例站</cite>
  </li></ol>`;

const toutiaoHtml = `
  <script data-druid-card-data-id="weather" type="application/json">${JSON.stringify({
    data: {
      title: '福州发布暴雨提示',
      article_url: 'https://www.toutiao.com/article/weather',
      abstract: '气象部门提醒市民留意短时强降雨。',
      media_name: '福州气象',
      publish_time: 1_750_000_000,
    },
  })}</script>`;

test('search result parsers return transient evidence drafts', () => {
  assert.deepEqual(parseBaiduSearchHtml(baiduHtml).map((item) => item.source), ['baidu']);
  assert.deepEqual(parseBingSearchHtml(bingHtml).map((item) => item.source), ['bing']);
  assert.deepEqual(parseSogouSearchHtml(sogouHtml).map((item) => item.source), ['sogou']);
  assert.deepEqual(parseSo360SearchHtml(so360Html).map((item) => item.source), ['so360']);
  assert.deepEqual(parseToutiaoSearchHtml(toutiaoHtml).map((item) => item.source), ['toutiao']);
  assert.equal(parseSogouSearchHtml(sogouHtml)[0].sourceUrl, 'https://www.sogou.com/link?url=forecast');
});

test('live search fans out without creating persistent document records', async () => {
  const requests: Array<{ url: string; options?: Record<string, unknown> }> = [];
  const client = {
    async get(url: string, options?: Record<string, unknown>) {
      requests.push({ url, options });
      if (url.includes('baidu.com')) return { data: baiduHtml };
      if (url.includes('bing.com')) return { data: bingHtml };
      if (url.includes('sogou.com')) return { data: sogouHtml };
      if (url.includes('toutiao.com')) return { data: toutiaoHtml };
      return { data: so360Html };
    },
  };
  const service = new LiveSearchService(client);
  const evidence = await service.search('福州 今天天气', { limit: 5 });

  assert.deepEqual(evidence.map((item) => item.id), ['S1', 'S2', 'S3', 'S4', 'S5']);
  assert.deepEqual(evidence.map((item) => item.source), ['baidu', 'bing', 'sogou', 'so360', 'toutiao']);
  assert.equal(requests.length, 5);
  assert.equal(requests.every((request) => request.options?.maxRetries === 1), true);
  assert.equal(requests.every((request) => request.options?.timeout === 4_000), true);

  const citations = toLiveSourceCitations(evidence);
  assert.equal('excerpt' in citations[0], false);
  assert.deepEqual(Object.keys(citations[0]).sort(), ['fetchedAt', 'id', 'source', 'sourceUrl', 'title']);
});
