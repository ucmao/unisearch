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

test('identity and remembered-name questions remain ordinary conversation', () => {
  for (const message of ['你是？', '你是谁', '我是谁？', '你叫啥', '你叫什么名字？', '我叫什么', '还记得我叫什么吗？', '记得你的名字吗']) {
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
    '在小红书搜扫地机器人', '调研华为手机在全网的口碑', '收集微博上关于新能源汽车的评论',
    '我想了解各平台的折叠屏手机', '帮我看看扫地机器人在知乎的讨论', '科莱特教育最近全网口碑怎么样',
    '看看各平台大家怎么评价 MiniMax M3', '去小红书看看科莱特教育',
  ]) {
    assert.equal(hasResearchSubject(message), true, message);
    assert.equal(localIntentDecision(message).action, 'create_plan', message);
  }
});

test('an explicitly mentioned business Skill supplies the workflow context', () => {
  const selected = localIntentDecision('@新媒体内容调研 分析新能源车内容趋势', {
    mentionedSkills: ['marketing-content-research'],
  });
  assert.equal(selected.action, 'create_plan');

  const missingSubject = localIntentDecision('@新媒体内容调研', {
    mentionedSkills: ['marketing-content-research'],
  });
  assert.equal(missingSubject.action, 'clarify');
  assert.deepEqual(missingSubject.missingFields, ['subject']);

  const replacement = localIntentDecision('@招聘岗位薪酬调研 上海产品经理', {
    mentionedSkills: ['hr-salary-benchmark'],
    planStatus: 'awaiting_confirmation',
  });
  assert.equal(replacement.action, 'revise_plan');
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
  assert.deepEqual(inferResearchPlatforms('抓取 https://v.douyin.com/example/ 的评论'), ['douyin']);
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
  assert.deepEqual(inferResearchPlatforms('全部平台'), [
    'xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu', 'baidu', 'bing', 'so360', 'sogou', 'toutiao',
    'arxiv', 'github_repositories', 'rss_news', 'aihot', 'deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin', 'heimao', 'zhaopin',
  ]);
});

test('arXiv requests select the academic connector and remove the platform name from keywords', () => {
  assert.deepEqual(inferResearchPlatforms('在 arXiv 搜索 Agent 论文'), ['arxiv']);
  assert.deepEqual(inferResearchPlatforms('去论文库查 RAG'), ['arxiv']);
  assert.deepEqual(inferResearchKeywords('在 arXiv 搜索 Agent 论文'), ['Agent']);
  assert.equal(localIntentDecision('在 arXiv 搜索 Agent 论文').action, 'create_plan');
});

test('GitHub repository requests select the merged connector and remove the platform name from keywords', () => {
  assert.deepEqual(inferResearchPlatforms('在 GitHub 搜索 Agent 框架'), ['github_repositories']);
  assert.deepEqual(inferResearchPlatforms('看看 GitHub AI 热门项目'), ['github_repositories']);
  assert.deepEqual(inferResearchPlatforms('分析 https://github.com/openai/openai-node'), ['github_repositories']);
  assert.deepEqual(inferResearchKeywords('在 GitHub 搜索 Agent 框架'), ['Agent 框架']);
  assert.equal(localIntentDecision('看看 GitHub AI 热门项目').action, 'create_plan');
});

test('RSS requests select the news Feed connector and remove the source name from keywords', () => {
  assert.deepEqual(inferResearchPlatforms('用 RSS 新闻查 AI 监管'), ['rss_news']);
  assert.deepEqual(inferResearchPlatforms('读取 Atom Feed 最新文章'), ['rss_news']);
  assert.deepEqual(inferResearchPlatforms('监控订阅源更新'), ['rss_news']);
  assert.deepEqual(inferResearchKeywords('用 RSS 新闻查 AI 监管'), ['AI 监管']);
  assert.equal(localIntentDecision('看看 RSS 最新新闻').action, 'create_plan');
});

test('AI HOT requests select the connector and can omit keywords', () => {
  assert.deepEqual(inferResearchPlatforms('看看 AI HOT 当前热点'), ['aihot']);
  assert.equal(localIntentDecision('看看 AI HOT 当前热点').action, 'create_plan');
});

test('confirmation only executes a pending plan', () => {
  for (const message of ['开始吧', '就按这个执行吧', '按上面的计划来', '执行这个计划', '直接采集', '执行呀', '开始呀', '好的呀', '行呀', 'OK', 'okay']) {
    assert.equal(localIntentDecision(message, { planStatus: 'awaiting_confirmation' }).action, 'execute', message);
  }
  // “开始 + 采集类动词”也是确认，不能被当成一条缺平台的新调研请求
  for (const message of ['开始搜索。', '开始采集吧', '马上采集', '现在就搜', '直接搜索', '开搜', '立即执行']) {
    assert.equal(localIntentDecision(message, { planStatus: 'awaiting_confirmation' }).action, 'execute', message);
  }
  assert.equal(localIntentDecision('开始吧').action, 'chat');
  // 没有待确认计划时，这些词仍应走正常调研/澄清流程，不能凭空启动
  assert.notEqual(localIntentDecision('开始搜索。').action, 'execute');
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
  for (const message of ['导出本次数据为 CSV', '下载CSV', '把采集结果导出成表格', '导出到 Obsidian', '生成 IMA 数据包']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'export', message);
  }
});

test('completed task analysis stays on the local analysis path', () => {
  for (const message of ['分析结果呀，gpt 5.6模型有哪些？', '根据刚才结果总结一下', '分析这个 CSV 的结论']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'analyze', message);
  }
});

test('running tasks allow partial analysis of already collected results', () => {
  assert.equal(localIntentDecision('先分析目前采到的结果', { planStatus: 'running' }).action, 'analyze');
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

test('realtime weather questions use the one-shot live answer path', () => {
  const weather = localIntentDecision('福州今天天气怎么样');
  assert.equal(weather.action, 'live_answer');
  assert.equal(weather.query, '福州今天天气怎么样');

  const followUp = localIntentDecision('我在福州', { previousUserText: '今天天气怎么样' });
  assert.equal(followUp.action, 'live_answer');
  assert.equal(followUp.query, '今天天气怎么样 我在福州');

  const explicitResearchWithWeather = localIntentDecision('在百度/必应搜索“今天天气”');
  assert.equal(explicitResearchWithWeather.action, 'create_plan');

  const explicitBaiduWeather = localIntentDecision('在百度搜索广州天气');
  assert.equal(explicitBaiduWeather.action, 'create_plan');

  const mentionedBaiduWeather = localIntentDecision('@百度搜索 广州天气', { mentionedConnectors: ['baidu'] });
  assert.equal(mentionedBaiduWeather.action, 'create_plan');
});

test('search engine alias and page range expressions are parsed correctly', () => {
  const { inferCollectionDepth } = require('../src/server/services/AgentIntent');
  assert.deepEqual(inferResearchPlatforms('采集所有搜索引擎'), ['baidu', 'bing', 'so360', 'sogou', 'toutiao']);
  assert.deepEqual(inferResearchPlatforms('在搜索引擎上查找'), ['baidu', 'bing', 'so360', 'sogou', 'toutiao']);
  assert.deepEqual(inferResearchPlatforms('在所有社交平台搜'), ['xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu']);
  assert.deepEqual(inferResearchPlatforms('在腾讯元宝问一下'), ['yuanbao']);
  assert.deepEqual(inferResearchPlatforms('用纳米 AI 搜索'), ['nami']);
  assert.deepEqual(inferResearchPlatforms('在 https://www.qianwen.com/ 提问'), ['qwen']);
  assert.deepEqual(inferResearchPlatforms('去文心问一下'), ['wenxin']);
  assert.deepEqual(inferResearchPlatforms('去文心一言问'), ['wenxin']);
  assert.deepEqual(inferResearchPlatforms('在 arxiv.org 搜论文'), ['arxiv']);
  assert.deepEqual(inferResearchPlatforms('在 github.com 搜热门仓库'), ['github_repositories']);
  assert.deepEqual(inferResearchPlatforms('所有 AI 问答平台'), ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin']);
  assert.equal(inferCollectionDepth('范围改成 前三页'), 'quick');
  assert.equal(inferCollectionDepth('改为前3页'), 'quick');
  assert.equal(inferCollectionDepth('改成前5页'), 'standard');
  assert.equal(inferCollectionDepth('改为前10页'), 'deep');
});

test('unspecified collection depth defaults to quick first results', () => {
  const { hasExplicitCollectionDepth, inferCollectionDepth } = require('../src/server/services/AgentIntent');
  assert.equal(inferCollectionDepth('采集小红书上的新品反馈'), 'quick');
  assert.equal(hasExplicitCollectionDepth('采集小红书上的新品反馈'), false);
  assert.equal(hasExplicitCollectionDepth('调研新品舆情并做深入分析'), false);
  assert.equal(hasExplicitCollectionDepth('尽量全面采集小红书上的新品反馈'), true);
  assert.equal(inferCollectionDepth('按常规范围采集'), 'standard');
});

test('negative platform exclusion directives filter out specified platforms', () => {
  const { inferExcludedPlatforms, inferResearchPlatforms } = require('../src/server/services/AgentIntent');
  const { normalizePlan } = require('../src/server/services/AgentService');
  const { skillRegistry } = require('../src/skills/registry');

  assert.deepEqual(inferExcludedPlatforms('不要采集黑猫投诉，关键词：易拓'), ['heimao']);
  assert.deepEqual(inferExcludedPlatforms('排除小红书和抖音'), ['xhs', 'douyin']);
  assert.deepEqual(inferExcludedPlatforms('黑猫投诉除外'), ['heimao']);

  const skill = skillRegistry.get('brand-geo-risk-monitor');
  const plan = normalizePlan(
    { keywords: ['易拓'] },
    '不要采集黑猫投诉，关键词：易拓',
    undefined,
    false,
    skill,
  );

  assert.equal(plan.platforms.includes('heimao'), false);
  assert.deepEqual(plan.platforms, ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin']);
  assert.deepEqual(plan.keywords, ['易拓']);

  const additivePlan = normalizePlan(
    { keywords: ['皮卡丘'] },
    '@品牌GEO与投诉风险监测 不要采集黑猫，多采集一个百度搜索，关键词：皮卡丘',
    undefined,
    false,
    skill,
  );

  assert.equal(additivePlan.platforms.includes('heimao'), false);
  assert.equal(additivePlan.platforms.includes('baidu'), true);
  assert.deepEqual(additivePlan.platforms, ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin', 'baidu']);
  assert.deepEqual(additivePlan.keywords, ['皮卡丘']);
});
