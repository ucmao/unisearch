import assert from 'node:assert/strict';
import test from 'node:test';
import { hasResearchSubject, inferResearchKeywords, isSimpleConversation, localIntentDecision } from '../src/server/services/AgentIntent';

test('greetings stay conversational and never create a plan', () => {
  for (const message of ['你好', '你好啊', '您好！', 'hi', 'Hello!', 'ni hao']) {
    assert.equal(localIntentDecision(message).action, 'chat', message);
  }
});

test('vague research requests ask one clarifying question', () => {
  for (const message of ['帮我调研一下', '帮我调查一下', '在小红书搜一下']) {
    const decision = localIntentDecision(message);
    assert.equal(decision.action, 'clarify', message);
    assert.deepEqual(decision.missingFields, ['subject']);
  }
});

test('concrete collection requests create a plan decision', () => {
  for (const message of ['在小红书搜扫地机器人', '调研华为手机的口碑', '收集关于新能源汽车的评论', '我想了解折叠屏手机', '帮我看看扫地机器人在知乎的讨论']) {
    assert.equal(hasResearchSubject(message), true, message);
    assert.equal(localIntentDecision(message).action, 'create_plan', message);
  }
});

test('fallback keywords contain the subject rather than the whole request', () => {
  assert.deepEqual(inferResearchKeywords('在小红书搜扫地机器人'), ['扫地机器人']);
  assert.deepEqual(inferResearchKeywords('收集关于新能源汽车的评论'), ['新能源汽车']);
  assert.deepEqual(inferResearchKeywords('关键词：华为手机、小米手机'), ['华为手机', '小米手机']);
  assert.deepEqual(inferResearchKeywords('帮我在小红书调研一下\n用户补充：华为手机'), ['华为手机']);
});

test('confirmation only executes a pending plan', () => {
  assert.equal(localIntentDecision('开始吧', { planStatus: 'awaiting_confirmation' }).action, 'execute');
  assert.equal(localIntentDecision('开始吧').action, 'chat');
});

test('a direct answer continues a clarification turn', () => {
  assert.equal(localIntentDecision('华为手机', { awaitingClarification: true }).action, 'create_plan');
  assert.equal(localIntentDecision('还没想好', { awaitingClarification: true }).action, 'chat');
});

test('plan edits and controls respect current state', () => {
  assert.equal(localIntentDecision('再加上知乎平台', { planStatus: 'awaiting_confirmation' }).action, 'revise_plan');
  assert.equal(localIntentDecision('停止采集', { planStatus: 'running' }).action, 'stop');
  assert.equal(localIntentDecision('总结负面评价原因', { planStatus: 'completed' }).action, 'analyze');
});

test('result count questions inspect the current task instead of creating a plan', () => {
  for (const message of ['你采集到了多少信息', '一共采集了多少条？', '任务完成了吗', '现在采集进度怎么样']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'status', message);
  }
});

test('capability and model questions never become collection plans', () => {
  for (const message of ['你支持什么平台', '你支持采集什么平台', '支持哪些平台？']) {
    const decision = localIntentDecision(message);
    assert.equal(decision.action, 'chat', message);
    assert.equal(isSimpleConversation(message), true, message);
    assert.match(decision.reply, /小红书.*抖音.*知乎/);
  }
  assert.equal(localIntentDecision('你用的是什么模型？').action, 'model_info');
});

test('unsupported realtime weather questions get an honest contextual answer', () => {
  const weather = localIntentDecision('福州今天天气怎么样');
  assert.equal(weather.action, 'chat');
  assert.match(weather.reply, /没有接入实时天气/);

  const followUp = localIntentDecision('我在福州', { previousUserText: '今天天气怎么样' });
  assert.equal(followUp.action, 'chat');
  assert.match(followUp.reply, /福州.*没有天气接口/);
});
