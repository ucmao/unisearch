import assert from 'node:assert/strict';
import {
  connectorCatalogForAI,
  listConnectorManifests,
  normalizeConnectorRequest,
} from '../src/connectors/registry';
import type { ConnectorStartRequest } from '../src/connectors/types';

const baseRequest: ConnectorStartRequest = {
  platform: 'xhs',
  connector_id: 'xhs',
  capability: 'keyword_search',
  connector_options: { max_items: 42, enable_comments: true },
  login_type: 'qrcode',
  crawler_type: 'search',
  keywords: '科莱特',
  start_page: 1,
  enable_comments: false,
  enable_sub_comments: false,
  cookies: '',
  headless: false,
  loop_execution: false,
};

assert.equal(listConnectorManifests().length, 14);

const normalized = normalizeConnectorRequest(baseRequest);
assert.equal(normalized.platform, 'xhs');
assert.equal(normalized.capability, 'keyword_search');
assert.equal((normalized as any).crawler_max_notes_count, 42);
assert.equal(normalized.enable_comments, true);

for (const manifest of listConnectorManifests()) {
  const expectedCapabilities = (manifest.category === 'web_search' || manifest.category === 'ai_web_qa')
    ? ['keyword_search']
    : manifest.category === 'utility'
    ? ['url_resolve']
    : ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'];
  assert.deepEqual(
    manifest.capabilities.map((capability) => capability.id),
    expectedCapabilities,
    `${manifest.id} should expose the complete connector capability set`,
  );
  for (const capability of manifest.capabilities) {
    assert.ok(capability.inputFields.length > 0, `${manifest.id}:${capability.id} should declare inputs`);
    assert.ok(capability.outputFields.length > 0, `${manifest.id}:${capability.id} should declare outputs`);
    assert.ok(capability.limitations.length > 0, `${manifest.id}:${capability.id} should declare boundaries`);
  }
}

const biliDetail = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'bili',
  connector_id: 'bili',
  capability: 'content_detail',
  crawler_type: 'detail',
  specified_ids: 'BV1xx411c7mD',
  connector_options: { specified_ids: ['BV1xx411c7mD'], enable_comments: true },
});
assert.equal(biliDetail.crawler_type, 'detail');
assert.equal(biliDetail.specified_ids, 'BV1xx411c7mD');
assert.equal(biliDetail.enable_comments, true);

const catalog = connectorCatalogForAI();
assert.match(catalog, /xhs=小红书/);
assert.match(catalog, /keyword_search/);
assert.match(catalog, /输出类型：xhs_content/);
assert.match(catalog, /url_resolve/);

console.log('connector registry tests passed');
