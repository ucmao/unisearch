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

assert.equal(listConnectorManifests().length, 7);

const normalized = normalizeConnectorRequest(baseRequest);
assert.equal(normalized.platform, 'xhs');
assert.equal(normalized.capability, 'keyword_search');
assert.equal((normalized as any).crawler_max_notes_count, 42);
assert.equal(normalized.enable_comments, true);

assert.throws(
  () => normalizeConnectorRequest({ ...baseRequest, platform: 'bili', connector_id: 'bili', capability: 'content_detail', crawler_type: 'detail' }),
  /does not support capability/,
);

const catalog = connectorCatalogForAI();
assert.match(catalog, /xhs=小红书/);
assert.match(catalog, /keyword_search/);
assert.match(catalog, /输出类型：social_content/);

console.log('connector registry tests passed');
