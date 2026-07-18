import assert from 'node:assert/strict';
import test from 'node:test';
import { hasResearchSubject, inferResearchKeywords, inferResearchPlatforms, isSimpleConversation, localIntentDecision } from '../src/server/services/AgentIntent';

test('greetings stay conversational and never create a plan', () => {
  for (const message of ['你好', '你好啊', '您好！', 'hi', 'Hello!', 'ni hao']) {
    assert.equal(localIntentDecision(message).action, 'chat', message);
  }
});

test('vague research requests ask one clarifying question', () => {
  for (const message of ['帮我调研一下', '帮我调查一下', '在小红书搜一下', '我想要调研了', '开始做调研吧']) {
    const decision = localIntentDecision(message);
    assert.equal(decision.action, 'clarify', message);
    assert.deepEqual(decision.missingFields, ['subject']);
  }
});

test('mentioning a platform or asking a normal question does not create a task', () => {
  for (const message of ['什么是小红书？', '你怎么评价这件事？', '我平时经常刷知乎', '采集小红书我要怎么做？']) {
    assert.equal(localIntentDecision(message).action, 'chat', message);
  }
});

test('concrete collection requests create a plan decision', () => {
  for (const message of [
    '在小红书搜扫地机器人', '调研华为手机的口碑', '收集关于新能源汽车的评论',
    '我想了解折叠屏手机', '帮我看看扫地机器人在知乎的讨论', '科莱特教育最近网上口碑怎么样',
    '看看大家怎么评价 MiniMax M3', '去小红书看看科莱特教育',
  ]) {
    assert.equal(hasResearchSubject(message), true, message);
    assert.equal(localIntentDecision(message).action, 'create_plan', message);
  }
});

test('fallback keywords contain the subject rather than the whole request', () => {
  assert.deepEqual(inferResearchKeywords('在小红书搜扫地机器人'), ['扫地机器人']);
  assert.deepEqual(inferResearchKeywords('收集关于新能源汽车的评论'), ['新能源汽车']);
  assert.deepEqual(inferResearchKeywords('关键词：华为手机、小米手机'), ['华为手机', '小米手机']);
  assert.deepEqual(inferResearchKeywords('帮我在小红书调研一下\n用户补充：华为手机'), ['华为手机']);
  assert.deepEqual(inferResearchKeywords('采集小红书，关键词 科莱特教育'), ['科莱特教育']);
  assert.deepEqual(inferResearchKeywords('关键词改成科莱特集团'), ['科莱特集团']);
  assert.deepEqual(inferResearchPlatforms('采集小红书和知乎'), ['xhs', 'zhihu']);
});

test('platform-only collection asks for a subject, then accepts a keyword', () => {
  assert.equal(localIntentDecision('采集小红书吧').action, 'clarify');
  assert.equal(localIntentDecision('采集小红书，关键词 科莱特教育').action, 'create_plan');
});

test('confirmation only executes a pending plan', () => {
  for (const message of ['开始吧', '就按这个执行吧', '按上面的计划来', '执行这个计划', '直接采集']) {
    assert.equal(localIntentDecision(message, { planStatus: 'awaiting_confirmation' }).action, 'execute', message);
  }
  assert.equal(localIntentDecision('开始吧').action, 'chat');
});

test('a direct answer continues a clarification turn', () => {
  assert.equal(localIntentDecision('华为手机', { awaitingClarification: true }).action, 'create_plan');
  assert.equal(localIntentDecision('还没想好', { awaitingClarification: true }).action, 'chat');
});

test('plan edits and controls respect current state', () => {
  for (const message of ['再加上知乎平台', '换一个关键词：科莱特集团', '关键词改成科莱特集团', '更换关键词为科莱特集团']) {
    assert.equal(localIntentDecision(message, { planStatus: 'awaiting_confirmation' }).action, 'revise_plan', message);
  }
  assert.equal(localIntentDecision('停止采集', { planStatus: 'running' }).action, 'stop');
  assert.equal(localIntentDecision('总结负面评价原因', { planStatus: 'completed' }).action, 'analyze');
});

test('result count questions inspect the current task instead of creating a plan', () => {
  for (const message of ['你采集到了多少信息', '一共采集了多少条？', '任务完成了吗', '现在采集进度怎么样']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'status', message);
  }
});

test('CSV requests use the real export action', () => {
  for (const message of ['导出本次数据为 CSV', '下载CSV', '把采集结果导出成表格']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'export', message);
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
