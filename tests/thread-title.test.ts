import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackTitleFromText, isMeaningfulTitleInput, sanitizeThreadTitle, titleFromPlan } from '../src/server/services/ThreadTitle';

test('greetings do not become conversation titles', () => {
  for (const message of ['你好', '你好呀！👋', 'hello', '在吗？', '谢谢']) {
    assert.equal(isMeaningfulTitleInput(message), false, message);
  }
  assert.equal(isMeaningfulTitleInput('帮我调研扫地机器人口碑'), true);
});

test('fallback titles remove conversational lead-ins and sensitive values', () => {
  assert.equal(fallbackTitleFromText('请帮我调研小红书上的扫地机器人口碑'), '调研小红书上的扫地机器人口碑');
  assert.equal(sanitizeThreadTitle('联系 13812345678 test@example.com 后继续调研'), '联系 后继续调研');
  assert.equal(Array.from(sanitizeThreadTitle('这是一个非常非常非常非常非常非常非常长的任务名称')).length <= 24, true);
});

test('plan titles include a single platform when the goal does not name it', () => {
  assert.equal(titleFromPlan({
    goal: '扫地机器人口碑调研', platforms: ['xhs'], keywords: ['扫地机器人'],
    collectComments: true, collectSubComments: false, startPage: 1, loginType: 'qrcode', headless: false,
    analysis: ['用户观点'], outputs: ['csv'],
  }), '小红书·扫地机器人口碑调研');
});
