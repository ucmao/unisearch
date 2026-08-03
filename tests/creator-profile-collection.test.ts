import assert from 'node:assert/strict';
import test from 'node:test';
import { getConnectorManifest, normalizeConnectorRequest } from '../src/connectors/registry';
import { creatorItemLimit, creatorLimitReached } from '../src/crawler/base/connectorHelpers';
import { applyConfig, resetConfig } from '../src/tools/config';

const CREATOR_PLATFORMS = ['douyin', 'kuaishou', 'xhs', 'bili', 'tieba', 'zhihu', 'weibo'];

test('all seven creator capabilities expose zero as collect-until-end', () => {
  for (const platform of CREATOR_PLATFORMS) {
    const capability = getConnectorManifest(platform)?.capabilities
      .find((item) => item.id === 'creator_profile');
    assert.ok(capability, `${platform} missing creator_profile`);
    const maxItems = capability.inputFields.find((field) => field.key === 'max_items');
    assert.ok(maxItems, `${platform} creator_profile missing max_items`);
    assert.equal(maxItems.default, 0);
    assert.equal(maxItems.min, 0);

    const normalized = normalizeConnectorRequest({
      platform,
      connector_id: platform,
      capability: 'creator_profile',
      crawler_type: 'creator',
      login_type: 'qrcode',
      creator_ids: 'creator-1',
      connector_options: { creator_ids: ['creator-1'], max_items: 0 },
      start_page: 1,
      enable_comments: false,
      cookies: '',
      headless: false,
      loop_execution: false,
    });
    assert.equal((normalized as any).crawler_max_notes_count, 0);
  }
});

test('creator limit helper distinguishes unlimited from a positive ceiling', () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 0 });
  assert.equal(creatorItemLimit(), null);
  assert.equal(creatorLimitReached(100_000), false);

  applyConfig({ crawler_max_notes_count: 25 });
  assert.equal(creatorItemLimit(), 25);
  assert.equal(creatorLimitReached(24), false);
  assert.equal(creatorLimitReached(25), true);
  resetConfig();
});

test('legacy creator requests without an explicit capability still select creator_profile', () => {
  const normalized = normalizeConnectorRequest({
    platform: 'douyin',
    connector_id: 'douyin',
    crawler_type: 'creator',
    login_type: 'qrcode',
    creator_ids: 'creator-1',
    connector_options: { creator_ids: ['creator-1'] },
    start_page: 1,
    enable_comments: false,
    cookies: '',
    headless: false,
    loop_execution: false,
  });
  assert.equal(normalized.capability, 'creator_profile');
  assert.equal((normalized as any).crawler_max_notes_count, 0);
});
