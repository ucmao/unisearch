import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyContextBudget,
  estimateTextTokens,
} from '../src/server/agent/ContextBudgetManager';

test('context budget leaves requests below the limit unchanged', () => {
  const messages = [
    { role: 'system', content: '系统规则' },
    { role: 'user', content: '当前问题' },
  ];
  const result = applyContextBudget(messages, { maxContextTokens: 8_192, reservedOutputTokens: 512 });
  assert.deepEqual(result.messages, messages);
  assert.equal(result.report.compacted, false);
});

test('context budget drops older turns before touching the latest user message', () => {
  const latest = '这是当前用户要求，必须完整保留。';
  const messages = [
    { role: 'system', content: '核心系统规则' },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `较早消息 ${index}：${'历史内容'.repeat(800)}`,
    })),
    { role: 'user', content: latest },
  ];
  const result = applyContextBudget(messages, { maxContextTokens: 8_192, reservedOutputTokens: 1_024 });
  assert.equal(result.messages.at(-1)?.content, latest);
  assert.equal(result.report.compacted, true);
  assert.ok(result.report.compactedMessages > 0);
  assert.ok(result.report.estimatedInputTokensAfter <= result.report.inputBudgetTokens);
});

test('context budget truncates oversized evidence while retaining its boundaries', () => {
  const evidence = `<evidence>${'网页证据'.repeat(12_000)}</evidence>`;
  const result = applyContextBudget([
    { role: 'system', content: '核心规则' },
    { role: 'system', content: evidence },
    { role: 'user', content: '请总结证据' },
  ], { maxContextTokens: 8_192, reservedOutputTokens: 1_024 });
  const compacted = String(result.messages[1].content);
  assert.match(compacted, /^<evidence>/);
  assert.match(compacted, /<\/evidence>$/);
  assert.match(compacted, /上下文预算限制已截断/);
  assert.ok(estimateTextTokens(compacted) < estimateTextTokens(evidence));
});

test('multimodal data URLs use a fixed image cost and remain structured', () => {
  const imageMessage = {
    role: 'user',
    content: [
      { type: 'text', text: '请参考这张图片' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${'a'.repeat(100_000)}` } },
    ],
  };
  const result = applyContextBudget([
    { role: 'system', content: '核心规则' },
    imageMessage,
  ], { maxContextTokens: 8_192, reservedOutputTokens: 1_024 });

  assert.deepEqual(result.messages[1].content, imageMessage.content);
  assert.equal(result.report.compacted, false);
  assert.ok(result.report.estimatedInputTokensAfter < 2_000);
});

test('default context budget is configured to 128,000 tokens', () => {
  const result = applyContextBudget([
    { role: 'system', content: '系统' },
    { role: 'user', content: '用户' },
  ]);
  assert.equal(result.report.maxContextTokens, 128_000);
  assert.equal(result.report.compacted, false);
});
