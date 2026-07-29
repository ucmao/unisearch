import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  RssNewsCrawler,
  filterRssNewsItems,
  normalizeRssFeedTarget,
  parseRssNewsFeed,
} from '../src/crawler/platforms/rss_news';
import { buildRawItem, connectorOutput } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { MemoryOutputSink } from '../src/core/sinks/memory';
import { applyConfig, resetConfig } from '../src/tools/config';

const rssFixture = readFileSync(path.resolve(import.meta.dirname, 'fixtures/rss-news-feed.xml'), 'utf8');
const atomFixture = readFileSync(path.resolve(import.meta.dirname, 'fixtures/atom-news-feed.xml'), 'utf8');
const feedUrl = 'https://feeds.example.com/world.xml';

test('RSS parser retains feed metadata and strips markup from summaries', () => {
  const items = parseRssNewsFeed(rssFixture, feedUrl, 'Example Publisher');
  assert.equal(items.length, 2);
  assert.equal(items[0].content_id, 'world-ai-001');
  assert.equal(items[0].title, 'Global AI agreement reaches final stage');
  assert.equal(items[0].summary, 'Negotiators agreed on a shared framework for safe AI deployment.');
  assert.equal(items[0].creator_name, 'Example Publisher');
  assert.equal(items[0].author, 'Alex Reporter');
  assert.deepEqual(items[0].categories, ['Technology', 'World']);
  assert.equal(items[0].published_at, '2026-07-29T03:30:00.000Z');
  assert.equal(items[0].citations.length, 1);
});

test('Atom parser supports alternate links, authors and categories', () => {
  const items = parseRssNewsFeed(atomFixture, 'https://tech.example.com/atom.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].content_id, 'tag:example.com,2026:agent-tools');
  assert.equal(items[0].feed_title, 'Example Technology Feed');
  assert.equal(items[0].author, 'Sam Writer');
  assert.deepEqual(items[0].categories, ['AI']);
  assert.equal(items[0].content_url, 'https://tech.example.com/agent-tools');
});

test('RSS filtering applies period, keywords, deduplication and ranking', () => {
  const rssItems = parseRssNewsFeed(rssFixture, feedUrl, 'Example Publisher');
  const atomItems = parseRssNewsFeed(atomFixture, 'https://tech.example.com/atom.xml');
  const duplicate = { ...rssItems[0], content_id: 'duplicate-guid' };
  const filtered = filterRssNewsItems([...rssItems, ...atomItems, duplicate], {
    keywords: ['agent', 'AI'], period: '7d', maxItems: 10, now: new Date('2026-07-29T05:00:00Z'),
  });
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].rank, 1);
  assert.equal(filtered[0].source_keyword, 'ai');
  assert.equal(filtered[1].source_keyword, 'agent');
});

test('custom Feed URL validation rejects local and unsupported targets', () => {
  assert.equal(normalizeRssFeedTarget('https://example.com/feed.xml#latest'), 'https://example.com/feed.xml');
  assert.throws(() => normalizeRssFeedTarget('file:///tmp/feed.xml'), /仅支持 HTTP 或 HTTPS/);
  assert.throws(() => normalizeRssFeedTarget('http://127.0.0.1/feed'), /不允许访问本机或私有网络/);
  assert.throws(() => normalizeRssFeedTarget('http://192.168.1.10/rss'), /不允许访问本机或私有网络/);
  assert.throws(() => normalizeRssFeedTarget('http://[::1]/atom'), /不允许访问本机或私有网络/);
});

test('RSS news output maps into canonical publisher fields', () => {
  const item = parseRssNewsFeed(rssFixture, feedUrl, 'Example Publisher')[0];
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitRssNewsItem', {
    ...item, source_keyword: 'ai', rank: 1,
  }), 'run-rss');
  assert.equal(document.platform, 'rss_news');
  assert.equal(document.kind, 'article');
  assert.equal(document.sourceItemId, 'world-ai-001');
  assert.equal(document.sourceUrl, 'https://news.example.com/world/ai-agreement');
  assert.equal(document.subject.type, 'publisher');
  assert.equal(document.subject.name, 'Example Publisher');
  assert.equal(document.keyword, 'ai');
  assert.equal(document.attributes.feedUrl, feedUrl);
  assert.deepEqual(document.attributes.categories, ['Technology', 'World']);
  assert.equal(document.citations.length, 1);
});

test('RSS crawler makes an anonymous XML request and emits normalized items', async () => {
  const requests: Array<{ url: string; options?: Record<string, unknown> }> = [];
  const client = {
    async get(url: string, options?: Record<string, unknown>) {
      requests.push({ url, options });
      return { data: rssFixture };
    },
  };
  const sink = new MemoryOutputSink();
  applyConfig({
    platform: 'rss_news', crawler_type: 'search', keywords: 'AI',
    crawler_max_notes_count: 1, rss_news_source: 'bbc_world', rss_news_period: 'all',
  });
  await connectorOutput.open(sink, {
    runId: 'run-rss-request', source: 'rss_news', startedAt: new Date().toISOString(),
  });
  try {
    await new RssNewsCrawler(client, async () => {}).search();
    await connectorOutput.close({ status: 'completed' });
  } catch (error) {
    await connectorOutput.abort(error as Error);
    throw error;
  } finally {
    resetConfig();
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://feeds.bbci.co.uk/news/world/rss.xml');
  assert.equal(requests[0].options?.autoCookie, false);
  assert.equal(requests[0].options?.maxContentLength, 5 * 1024 * 1024);
  assert.equal((requests[0].options?.headers as Record<string, string>).Authorization, undefined);
  assert.equal(sink.items.length, 1);
  assert.equal(sink.items[0].source, 'rss_news');
  assert.equal(sink.items[0].kind, 'article');
});

test('RSS parser rejects HTML or an unknown XML structure', () => {
  assert.throws(() => parseRssNewsFeed('<html><body>not a feed</body></html>', feedUrl), /不是可识别/);
});
