import assert from 'node:assert/strict';
import test from 'node:test';
import { UNISEARCH_PRODUCT_MANUAL, buildConversationSystemPrompt } from '../src/server/services/AgentPrompt';

test('product manual states the real platform boundary', () => {
  for (const platform of ['小红书', '抖音', '快手', '哔哩哔哩', '微博', '百度贴吧', '知乎']) {
    assert.match(UNISEARCH_PRODUCT_MANUAL, new RegExp(platform));
  }
  assert.match(UNISEARCH_PRODUCT_MANUAL, /未接入微信/);
  assert.match(buildConversationSystemPrompt(false), /完整对话理解省略表达/);
});
