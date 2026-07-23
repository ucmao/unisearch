import assert from 'node:assert/strict';
import test from 'node:test';
import { hasResearchSubject, inferResearchKeywords, inferResearchPlatforms, isSimpleConversation, localIntentDecision } from '../src/server/services/AgentIntent';

test('direct link parsing requests route to direct_parse', () => {
  for (const message of [
    '4.17 02/11 LWM:/ z@G.vf :2pm 不要轻易学SAP了，除非你看完这个视频# 学sap https://v.douyin.com/_8PHI7a2c-E/ 复制此链接，打开Douyin搜索，直接观看视频！',
    '帮我解析这个视频去水印 https://v.douyin.com/_8PHI7a2c-E/',
    'https://xhslink.com/a/123456 去水印',
  ]) {
    assert.equal(localIntentDecision(message).action, 'direct_parse', message);
  }
});

test('greetings stay conversational and never create a plan', () => {
  for (const message of ['你好', '你好啊', '您好！', 'hi', 'Hello!', 'ni hao']) {
    assert.equal(localIntentDecision(message).action, 'chat', message);
  }
});

test('identity and remembered-name questions stay in the memory-aware conversation path', () => {
  for (const message of ['你是？', '你是谁', '我是谁？', '你叫啥', '你叫什么名字？', '我叫什么', '还记得我叫什么吗？', '记得你的名字吗']) {
    assert.equal(localIntentDecision(message).action, 'chat', message);
    assert.equal(isSimpleConversation(message), true, message);
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
    '在小红书搜扫地机器人', '调研华为手机在全网的口碑', '收集微博上关于新能源汽车的评论',
    '我想了解各平台的折叠屏手机', '帮我看看扫地机器人在知乎的讨论', '科莱特教育最近全网口碑怎么样',
    '看看各平台大家怎么评价 MiniMax M3', '去小红书看看科莱特教育',
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
  assert.deepEqual(inferResearchKeywords('我要采集快手 两个关键词 sap sap学习'), ['sap', 'sap学习']);
  assert.deepEqual(inferResearchKeywords('采集小红书 2个关键词：华为手机 小米手机'), ['华为手机', '小米手机']);
  assert.deepEqual(inferResearchKeywords('采集关键词 MiniMax M3'), ['MiniMax M3']);
  assert.deepEqual(inferResearchPlatforms('采集小红书和知乎'), ['xhs', 'zhihu']);
  assert.deepEqual(inferResearchPlatforms('解析 https://www.bilibili.com/video/BV1xx411c7mD'), ['bili']);
  assert.deepEqual(inferResearchPlatforms('抓取 https://v.douyin.com/example/ 的评论'), ['dy']);
});

test('platform-only collection asks for a subject, then accepts a keyword', () => {
  assert.equal(localIntentDecision('采集小红书吧').action, 'clarify');
  assert.equal(localIntentDecision('采集小红书，关键词 科莱特教育').action, 'create_plan');
});

test('subject-only collection asks for platforms before creating a plan', () => {
  const first = localIntentDecision('帮我采集微秒数智相关内容');
  assert.equal(first.action, 'clarify');
  assert.deepEqual(first.missingFields, ['platforms']);
  assert.equal(localIntentDecision('小红书和微博', {
    awaitingClarification: true,
    previousUserText: '帮我采集微秒数智相关内容',
  }).action, 'create_plan');
  assert.deepEqual(inferResearchPlatforms('全部平台'), ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu', 'baidu', 'bing', 'so360', 'sogou']);
});

test('confirmation only executes a pending plan', () => {
  for (const message of ['开始吧', '就按这个执行吧', '按上面的计划来', '执行这个计划', '直接采集', '执行呀', '开始呀', '好的呀', '行呀', 'OK', 'okay']) {
    assert.equal(localIntentDecision(message, { planStatus: 'awaiting_confirmation' }).action, 'execute', message);
  }
  assert.equal(localIntentDecision('开始吧').action, 'chat');
  assert.equal(localIntentDecision('执行').action, 'execute');
  assert.equal(localIntentDecision('执行呀').action, 'execute');
  assert.equal(localIntentDecision('开跑').action, 'execute');
});

test('a direct answer continues a clarification turn', () => {
  assert.equal(localIntentDecision('华为手机', { awaitingClarification: true }).action, 'create_plan');
  assert.equal(localIntentDecision('还没想好', { awaitingClarification: true }).action, 'chat');
});

test('plan edits and controls respect current state', () => {
  for (const message of ['再加上知乎平台', '换一个关键词：科莱特集团', '关键词改成科莱特集团', '更换关键词为科莱特集团', '把分析目标改成价格对比和机构识别', '去掉情感分析']) {
    assert.equal(localIntentDecision(message, { planStatus: 'awaiting_confirmation' }).action, 'revise_plan', message);
  }
  assert.equal(localIntentDecision('停止采集', { planStatus: 'running' }).action, 'stop');
  assert.equal(localIntentDecision('总结负面评价原因', { planStatus: 'completed' }).action, 'analyze');
});

test('result count questions inspect the current task instead of creating a plan', () => {
  for (const message of ['你采集到了多少信息', '一共采集了多少条？', '任务完成了吗', '现在采集进度怎么样', '执行了吗', '开跑了吗']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'status', message);
  }
});

test('CSV requests use the real export action', () => {
  for (const message of ['导出本次数据为 CSV', '下载CSV', '把采集结果导出成表格']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'export', message);
  }
});

test('completed task analysis stays on the local analysis path', () => {
  for (const message of ['分析结果呀，gpt 5.6模型有哪些？', '根据刚才结果总结一下', '分析这个 CSV 的结论']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'analyze', message);
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

test('search engine alias and page range expressions are parsed correctly', () => {
  const { inferCollectionDepth } = require('../src/server/services/AgentIntent');
  assert.deepEqual(inferResearchPlatforms('采集所有搜索引擎'), ['baidu', 'bing', 'so360', 'sogou']);
  assert.deepEqual(inferResearchPlatforms('在搜索引擎上查找'), ['baidu', 'bing', 'so360', 'sogou']);
  assert.deepEqual(inferResearchPlatforms('在所有社交平台搜'), ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu']);
  assert.equal(inferCollectionDepth('范围改成 前三页'), 'quick');
  assert.equal(inferCollectionDepth('改为前3页'), 'quick');
  assert.equal(inferCollectionDepth('改成前5页'), 'standard');
  assert.equal(inferCollectionDepth('改为前10页'), 'deep');
});
