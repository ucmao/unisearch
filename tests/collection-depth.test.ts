import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeDepthForCapabilities,
  depthIsMeaningful,
  depthPromptGuide,
  resolveDepthPreset,
} from '../src/connectors/depth';
import { getConnectorManifest } from '../src/connectors/registry';
import { normalizeConnectorRequest } from '../src/connectors/registry';
import type { ConnectorCapability } from '../src/connectors/types';

function capability(platform: string, capabilityId = 'keyword_search'): ConnectorCapability {
  const found = getConnectorManifest(platform)?.capabilities.find((item) => item.id === capabilityId);
  assert.ok(found, `${platform} 缺少能力 ${capabilityId}`);
  return found;
}

test('depth budgets never exceed the capability ceiling that would reject the run', () => {
  for (const manifest of ['xhs', 'douyin', 'bili', 'weibo', 'zhihu', 'tieba', 'kuaishou', 'baidu', 'bing', 'zhaopin', 'heimao']) {
    for (const depth of ['quick', 'standard', 'deep'] as const) {
      const target = capability(manifest);
      const preset = resolveDepthPreset(target, depth);
      const field = target.inputFields.find((item) => item.key === 'max_items');
      if (preset.maxItems === undefined || !field) continue;
      assert.ok(preset.maxItems >= (field.min ?? 1), `${manifest}/${depth} 低于下限`);
      assert.ok(preset.maxItems <= (field.max ?? Infinity), `${manifest}/${depth} 超出 manifest 上限`);
      // The real guard: normalizeConnectorRequest throws on out-of-range values,
      // which would fail the whole step instead of collecting fewer items.
      assert.doesNotThrow(() => normalizeConnectorRequest({
        platform: manifest,
        connector_id: manifest,
        capability: 'keyword_search',
        login_type: 'qrcode',
        crawler_type: 'search',
        keywords: '测试',
        connector_options: { max_items: preset.maxItems },
      } as any));
    }
  }
});

test('budgets differ per connector family instead of one flat number', () => {
  const social = resolveDepthPreset(capability('xhs'), 'deep').maxItems;
  const searchEngine = resolveDepthPreset(capability('baidu'), 'deep').maxItems;
  assert.ok(social && searchEngine);
  assert.ok(social > searchEngine, '搜索引擎的深度预算应低于社交平台');
});

test('depth is reported as not applicable where it changes nothing', () => {
  // AI Q&A: one keyword always yields exactly one answer.
  assert.equal(depthIsMeaningful(capability('deepseek')), false);
  // URL resolve has neither an item budget nor comments.
  assert.equal(depthIsMeaningful(capability('xhs', 'url_resolve')), false);
  // Detail capabilities still toggle comments, so the selector stays useful.
  assert.equal(depthIsMeaningful(capability('xhs', 'content_detail')), true);
  assert.equal(depthIsMeaningful(capability('xhs')), true);
});

test('comments switch on at 标准 and stay on, replies included either way', () => {
  const target = capability('xhs');
  assert.deepEqual(
    (['quick', 'standard', 'deep'] as const)
      .map((depth) => resolveDepthPreset(target, depth).collectComments),
    [false, true, true],
  );
});

test('custom depth defers entirely to explicit connector options', () => {
  assert.deepEqual(resolveDepthPreset(capability('xhs'), 'custom'), {});
});

test('plan scope summary shows a range for mixed platforms', () => {
  const mixed = describeDepthForCapabilities([capability('xhs'), capability('baidu')], 'standard');
  assert.match(mixed, /每关键词约 \d+~\d+ 条/);
  const single = describeDepthForCapabilities([capability('xhs')], 'standard');
  assert.match(single, /每关键词约 \d+ 条/);
  assert.match(single, /含评论及可见回复/);
  // AI-only plans must not claim an item budget they do not honour.
  assert.equal(describeDepthForCapabilities([capability('deepseek')], 'deep'), '');
});

test('planner prompt describes depth the way the backend implements it', () => {
  const guide = depthPromptGuide();
  // The old prompt promised "前三页/前5页/前10页" while the backend budgeted by
  // item count, so the assistant kept telling users the wrong thing.
  assert.doesNotMatch(guide, /前三页|前5页|前10页/);
  for (const level of ['quick', 'standard', 'deep']) assert.match(guide, new RegExp(level));
  assert.match(guide, /max_items/);
});
