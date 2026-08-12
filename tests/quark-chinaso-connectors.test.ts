import test from 'node:test';
import assert from 'node:assert/strict';
import { getConnectorManifest } from '../src/connectors/registry';
import { createConnectorExecutor } from '../src/connectors/executors';
import { ChinaSoCrawler, QuarkCrawler, detectQuarkAntiBotChallenge } from '../src/crawler/platforms/search_engine';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { parseQuarkSearchHtml } from '../src/server/services/LiveSearchService';

test('quark and chinaso connector manifests are properly registered', () => {
  const quarkManifest = getConnectorManifest('quark');
  assert.ok(quarkManifest, 'Quark manifest should exist');
  assert.equal(quarkManifest.id, 'quark');
  assert.equal(quarkManifest.name, '神马搜索');
  assert.equal(quarkManifest.category, 'web_search');
  assert.equal(quarkManifest.capabilities.length, 1);
  assert.equal(quarkManifest.capabilities[0].id, 'keyword_search');

  const chinasoManifest = getConnectorManifest('chinaso');
  assert.ok(chinasoManifest, 'ChinaSo manifest should exist');
  assert.equal(chinasoManifest.id, 'chinaso');
  assert.equal(chinasoManifest.name, '中国搜索');
  assert.equal(chinasoManifest.category, 'web_search');
  assert.equal(chinasoManifest.capabilities.length, 1);
  assert.equal(chinasoManifest.capabilities[0].id, 'keyword_search');
});

test('quark and chinaso executors can be instantiated', () => {
  const quarkExecutor = createConnectorExecutor('quark');
  assert.ok(quarkExecutor instanceof QuarkCrawler);

  const chinasoExecutor = createConnectorExecutor('chinaso');
  assert.ok(chinasoExecutor instanceof ChinaSoCrawler);
});

test('quark search result raw item maps to standard canonical document', () => {
  const item = buildRawItem('emitSearchEngineResult', {
    search_engine: 'quark',
    title: 'AI技术最新进展与应用',
    url: 'https://quark.sm.cn/link?target=https%3A%2F%2Fnews.example.com%2Fai',
    real_url: 'https://news.example.com/ai',
    snippet: '人工智能前沿技术在各个行业中落地加速。',
    publisher: '科技周刊',
    publish_time: '2026-08-10',
    images: ['https://img.example.com/ai.jpg'],
    search_rank: 1,
    source_keyword: 'AI技术',
  });

  const doc = mapRawItemToCanonicalDocument(item, 'run-quark-test');
  assert.equal(doc.platform, 'quark');
  assert.equal(doc.title, 'AI技术最新进展与应用');
  assert.equal(doc.sourceUrl, 'https://news.example.com/ai');
  assert.equal(doc.markdown, '人工智能前沿技术在各个行业中落地加速。');
  assert.equal(doc.subject.name, '科技周刊');
});

test('chinaso search result raw item maps to standard canonical document', () => {
  const item = buildRawItem('emitSearchEngineResult', {
    search_engine: 'chinaso',
    title: '国家发改委发布最新数字经济政策细则',
    url: 'https://www.chinaso.com/newssearch/all/allResults?q=数字经济',
    real_url: 'http://www.gov.cn/zhengce/2026-08/12/content_123.htm',
    snippet: '发展数字经济，加快建设现代化产业体系。',
    publisher: '新华社',
    publish_time: '2026-08-12',
    images: [],
    search_rank: 1,
    source_keyword: '数字经济政策',
  });

  const doc = mapRawItemToCanonicalDocument(item, 'run-chinaso-test');
  assert.equal(doc.platform, 'chinaso');
  assert.equal(doc.title, '国家发改委发布最新数字经济政策细则');
  assert.equal(doc.sourceUrl, 'http://www.gov.cn/zhengce/2026-08/12/content_123.htm');
  assert.equal(doc.markdown, '发展数字经济，加快建设现代化产业体系。');
  assert.equal(doc.subject.name, '新华社');
});

test('quark html parser extracts results from JSON hydration feeds and DOM cards without false captcha trigger', () => {
  const sampleQuarkHtml = `
    <!DOCTYPE html><html><head><title>福州天气 - 夸克搜索</title></head>
    <body>
      <script type="application/json" id="s-data-news_uchq_1_2" data-used-by="hydrate">
        {
          "data": {
            "initialData": {
              "feed": [
                {
                  "title": "雨没停、热没退，福州天气又湿又闷",
                  "webname": "搜狐网",
                  "time": "13小时前",
                  "summary": "昨天福州在雨加热加闷三重奏里度过...",
                  "url": "https://m.sohu.com/a/1061781899"
                }
              ]
            }
          }
        }
      </script>
      <div class="qk-card" data-cmp="ca">
        <div class="qk-title"><a data-openpageurl="https://weather.cma.gov.cn/fz">福州未来三天天气公报</a></div>
        <div class="abs">受冷暖气流共同影响，福州全市有阵雨或雷阵雨。</div>
        <div class="c-footer">气象台官方</div>
      </div>
    </body></html>
  `;

  const parsed = parseQuarkSearchHtml(sampleQuarkHtml, 5);
  assert.ok(parsed.length >= 2, 'Should extract both JSON feed and DOM cards');
  assert.equal(parsed[0].title, '雨没停、热没退，福州天气又湿又闷');
  assert.equal(parsed[0].sourceUrl, 'https://m.sohu.com/a/1061781899');
  assert.equal(parsed[1].title, '福州未来三天天气公报');
  assert.equal(parsed[1].sourceUrl, 'https://weather.cma.gov.cn/fz');
});

test('quark anti-bot detector recognizes current bxpunish challenge responses', () => {
  const challengeHtml = `
    <script>
      var url = "https://quark.sm.cn//s/_____tmd_____/punish?x5secdata=test";
      window._config_ = {"action":"captcha","url":url};
    </script>
  `;

  assert.equal(detectQuarkAntiBotChallenge(challengeHtml), true);
  assert.equal(detectQuarkAntiBotChallenge('<html></html>', { bxpunish: '1' }), true);
  assert.equal(detectQuarkAntiBotChallenge('<html><title>正常搜索结果</title></html>'), false);
});
