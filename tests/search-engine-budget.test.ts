import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalSearchResultUrl,
  SEARCH_ENGINE_BATCH_SIZE,
  SEARCH_ENGINE_ITEM_LIMIT,
  searchEnginePageBudget,
} from '../src/crawler/platforms/search_engine';

test('large search targets are bounded and receive spare pages for duplicates', () => {
  assert.equal(SEARCH_ENGINE_ITEM_LIMIT, 500);
  assert.equal(SEARCH_ENGINE_BATCH_SIZE, 100);
  assert.equal(searchEnginePageBudget(30), 8);
  assert.equal(searchEnginePageBudget(100), 15);
  assert.equal(searchEnginePageBudget(500), 55);
  assert.equal(searchEnginePageBudget(10_000), 60);
});

test('search result deduplication ignores fragments and known tracking parameters', () => {
  assert.equal(
    canonicalSearchResultUrl('https://example.com/report?id=7&utm_source=bing#summary'),
    'https://example.com/report?id=7',
  );
  assert.equal(
    canonicalSearchResultUrl('https://example.com/report?id=8'),
    'https://example.com/report?id=8',
  );
  assert.equal(canonicalSearchResultUrl('not-a-url'), 'not-a-url');
});
