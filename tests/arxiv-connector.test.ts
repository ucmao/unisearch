import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ArxivCrawler,
  buildArxivSearchQuery,
  normalizeArxivTarget,
  parseArxivAtom,
} from '../src/crawler/platforms/arxiv';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { connectorOutput } from '../src/connectors/output/connector-output';
import { MemoryOutputSink } from '../src/core/sinks/memory';
import { applyConfig, resetConfig } from '../src/tools/config';

const fixture = readFileSync(path.resolve(import.meta.dirname, 'fixtures/arxiv-feed.xml'), 'utf8');

test('arXiv Atom parser retains paper metadata and stable base identity', () => {
  const papers = parseArxivAtom(fixture, 'agent evaluation', 5);
  assert.equal(papers.length, 1);
  assert.equal(papers[0].content_id, '2607.12345');
  assert.equal(papers[0].arxiv_id, '2607.12345v2');
  assert.equal(papers[0].version, 2);
  assert.equal(papers[0].title, 'Reliable Agent Evaluation with Reproducible Benchmarks');
  assert.deepEqual(papers[0].authors, ['Alice Example', 'Bob Example']);
  assert.deepEqual(papers[0].categories, ['cs.AI', 'cs.LG']);
  assert.equal(papers[0].primary_category, 'cs.AI');
  assert.equal(papers[0].content_url, 'https://arxiv.org/abs/2607.12345');
  assert.equal(papers[0].rank, 6);
  assert.equal(papers[0].citations.length, 3);
});

test('arXiv query builder scopes and escapes user input', () => {
  assert.equal(buildArxivSearchQuery('agent evaluation', 'all'), 'all:"agent evaluation"');
  assert.equal(buildArxivSearchQuery('Vaswani, Ashish', 'author'), 'au:"Vaswani, Ashish"');
  assert.equal(buildArxivSearchQuery('cs.AI', 'category'), 'cat:cs.AI');
  assert.equal(buildArxivSearchQuery('"reasoning" agents', 'title'), 'ti:"\\"reasoning\\" agents"');
});

test('arXiv targets accept IDs, abstract URLs and PDF URLs', () => {
  assert.equal(normalizeArxivTarget('2607.12345v2'), '2607.12345v2');
  assert.equal(normalizeArxivTarget('arXiv:2607.12345'), '2607.12345');
  assert.equal(normalizeArxivTarget('https://arxiv.org/abs/2607.12345v2'), '2607.12345v2');
  assert.equal(normalizeArxivTarget('https://arxiv.org/pdf/2607.12345v2.pdf'), '2607.12345v2');
  assert.equal(normalizeArxivTarget('hep-th/9901001'), 'hep-th/9901001');
  assert.throws(() => normalizeArxivTarget('https://example.com/2607.12345'), /不是 arXiv 链接/);
});

test('arXiv output maps into canonical article fields', () => {
  const paper = parseArxivAtom(fixture, 'agent evaluation')[0];
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitArxivPaper', paper), 'run-arxiv');
  assert.equal(document.platform, 'arxiv');
  assert.equal(document.kind, 'article');
  assert.equal(document.sourceItemId, '2607.12345');
  assert.equal(document.sourceUrl, 'https://arxiv.org/abs/2607.12345');
  assert.equal(document.subject.type, 'creator');
  assert.equal(document.subject.name, 'Alice Example, Bob Example');
  assert.equal(document.keyword, 'agent evaluation');
  assert.equal(document.attributes.arxivId, '2607.12345v2');
  assert.deepEqual(document.attributes.categories, ['cs.AI', 'cs.LG']);
  assert.equal(document.sourceUpdatedAt, '2026-07-28T12:00:00Z');
  assert.equal(document.citations.length, 3);
});

test('arXiv crawler builds an anonymous API request and emits normalized items', async () => {
  const requests: Array<{ url: string; options?: Record<string, unknown> }> = [];
  const client = {
    async get(url: string, options?: Record<string, unknown>) {
      requests.push({ url, options });
      return { data: fixture };
    },
  };
  const sink = new MemoryOutputSink();
  applyConfig({
    platform: 'arxiv', crawler_type: 'search', keywords: 'agent evaluation',
    crawler_max_notes_count: 1, start_page: 2,
    arxiv_search_scope: 'title', arxiv_sort_by: 'lastUpdatedDate', arxiv_sort_order: 'ascending',
  });
  await connectorOutput.open(sink, {
    runId: 'run-arxiv-request', source: 'arxiv', startedAt: new Date().toISOString(),
  });
  try {
    await new ArxivCrawler(client, async () => {}).search();
    await connectorOutput.close({ status: 'completed' });
  } catch (error) {
    await connectorOutput.abort(error as Error);
    throw error;
  } finally {
    resetConfig();
  }

  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, 'https://export.arxiv.org/api/query');
  assert.equal(requestUrl.searchParams.get('search_query'), 'ti:"agent evaluation"');
  assert.equal(requestUrl.searchParams.get('start'), '25');
  assert.equal(requestUrl.searchParams.get('max_results'), '1');
  assert.equal(requestUrl.searchParams.get('sortBy'), 'lastUpdatedDate');
  assert.equal(requestUrl.searchParams.get('sortOrder'), 'ascending');
  assert.equal(requests[0].options?.autoCookie, false);
  assert.equal(sink.items.length, 1);
  assert.equal(sink.items[0].source, 'arxiv');
  assert.equal(sink.items[0].kind, 'article');
});
