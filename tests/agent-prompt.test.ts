import assert from 'node:assert/strict';
import test from 'node:test';
import { UNISEARCH_PRODUCT_MANUAL, buildConversationSystemPrompt } from '../src/server/services/AgentPrompt';

test('product manual states the real platform boundary', () => {
  for (const platform of ['小红书', '抖音', '快手', '哔哩哔哩', '微博', '百度贴吧', '知乎']) {
    assert.match(UNISEARCH_PRODUCT_MANUAL, new RegExp(platform));
  }
  assert.match(UNISEARCH_PRODUCT_MANUAL, /未接入微信/);
  assert.match(buildConversationSystemPrompt(false), /完整对话理解省略表达/);
  assert.match(UNISEARCH_PRODUCT_MANUAL, /只有后端已经创建真实计划并返回 plan_id/);
  assert.match(UNISEARCH_PRODUCT_MANUAL, /销售课程竞争情报/);
  assert.match(UNISEARCH_PRODUCT_MANUAL, /选择了 Skill 就跳过确认/);
  assert.match(UNISEARCH_PRODUCT_MANUAL, /live_answer.*不创建计划/);
  assert.match(UNISEARCH_PRODUCT_MANUAL, /不进入知识索引和后续 RAG/);
});
