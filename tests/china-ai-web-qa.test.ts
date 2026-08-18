import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLikelyPromptTemplateOrPlaceholder,
  PLATFORMS,
  NON_ANSWER_EXCLUDE_SELECTORS,
} from '../src/crawler/platforms/china_ai_web_qa';

test('isLikelyPromptTemplateOrPlaceholder correctly flags drawing prompt samples', () => {
  const badPrompt = 'a cat wearing sunglasses, sitting on a beach, cyberpunk style, neon lights, 8k, highly detailed --ar 16:9';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(badPrompt), true);

  const emptyText = '';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(emptyText), true);

  const shortText = 'abc';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(shortText), true);

  const normalAnswer = 'AIGC 领域薪资水平整体较高。算法工程师平均月薪在 35k-60k 之间，产品经理与运营岗位在 20k-40k 之间。';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(normalAnswer), false);

  const tableAnswer = `| 岗位 | 薪资范围 |\n| --- | --- |\n| AI 算法工程师 | 30k-50k |\n| AIGC 产品经理 | 25k-40k |`;
  assert.equal(isLikelyPromptTemplateOrPlaceholder(tableAnswer), false);

  const userQuestionEcho = 'AI岗位的薪资怎么样';
  assert.equal(isLikelyPromptTemplateOrPlaceholder(userQuestionEcho, 'AI岗位的薪资怎么样'), true);
  assert.equal(isLikelyPromptTemplateOrPlaceholder('AI 岗位的薪资怎么样', 'AI岗位的薪资怎么样'), true);
});

test('Yuanbao platform defines robust message container and exclusion selectors', () => {
  const yb = PLATFORMS.yuanbao;
  assert.ok(yb);
  assert.ok(yb.messageContainerSelectors.some((s) => s.includes('agent-chat__conv--ai')));
  assert.ok(yb.newChatSelectors && yb.newChatSelectors.length > 0);
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('inspiration')));
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('prompt-card')));
  assert.ok(NON_ANSWER_EXCLUDE_SELECTORS.some((s) => s.includes('agent-chat__conv--user')));
});

test('Nami and Wenxin platforms define newChatSelectors and messageContainerSelectors', () => {
  assert.ok(PLATFORMS.nami.newChatSelectors && PLATFORMS.nami.newChatSelectors.length > 0);
  assert.ok(PLATFORMS.nami.messageContainerSelectors.length > 0);

  assert.ok(PLATFORMS.wenxin.newChatSelectors && PLATFORMS.wenxin.newChatSelectors.length > 0);
  assert.ok(PLATFORMS.wenxin.messageContainerSelectors.length > 0);
});
