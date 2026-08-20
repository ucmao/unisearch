import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanKeywordItem, extractWebUrls, hasResearchSubject, inferExplicitResearchKeywords, inferResearchKeywords, inferResearchPlatforms, isDirectWebReadRequest, isSimpleConversation, localIntentDecision } from '../src/server/services/AgentIntent';
import { normalizePlan } from '../src/server/services/AgentService';

test('explicit personal and team context routes directly to conversation', () => {
  assert.equal(isSimpleConversation('我是科莱特三组的组长，组员有 diana和vin'), true);
  assert.equal(isSimpleConversation('我在科莱特任职于产品团队'), true);
  assert.equal(isSimpleConversation('我是想调研科莱特的口碑'), false);
});

test('direct link parsing requests route to direct_parse', () => {
  for (const message of [
    '4.17 02/11 LWM:/ z@G.vf :2pm 不要轻易学SAP了，除非你看完这个视频# 学sap https://v.douyin.com/_8PHI7a2c-E/ 复制此链接，打开Douyin搜索，直接观看视频！',
    '帮我解析这个视频去水印 https://v.douyin.com/_8PHI7a2c-E/',
    'https://xhslink.com/a/123456 去水印',
  ]) {
    assert.equal(localIntentDecision(message).action, 'direct_parse', message);
  }
});

test('reading or summarizing explicit web URLs uses the transient web reader', () => {
  for (const message of [
    '请阅读这个 URL，总结告诉我：https://news.example.com/article/1',
    '读取网页正文 https://example.com/report',
    '帮我概括一下 https://example.com/a?from=test。',
    '看看这个网页讲了什么：https://example.com/page',
    'https://www.xhby.net/content/s6a5792dae4b0fc8825158242.html，告诉我科莱特的aigc课程亮点',
    'https://example.com/product 这个产品有哪些核心优势？',
  ]) {
    assert.equal(isDirectWebReadRequest(message), true, message);
    assert.equal(localIntentDecision(message).action, 'direct_web_read', message);
  }
  assert.deepEqual(
    extractWebUrls('总结 https://example.com/a。再阅读 https://example.org/b?x=1！'),
    ['https://example.com/a', 'https://example.org/b?x=1'],
  );
  assert.equal(localIntentDecision('总结一下今天的讨论').action, 'chat');
});

test('an explicitly mentioned web reader keeps the persistent connector workflow', () => {
  const decision = localIntentDecision('@通用网页阅读器 阅读并总结 https://example.com/article', {
    mentionedConnectors: ['web_reader'],
  });
  assert.equal(decision.action, 'create_plan');
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

test('one-shot web search requests answer immediately without creating a collection plan', () => {
  for (const message of [
    '土风舞有哪些代表性的舞蹈？你可以联网搜索一下。',
    '帮我上网查一下这个概念是什么',
    '网上检索一下 OpenAI 最新的 API 是哪个',
  ]) {
    assert.equal(localIntentDecision(message).action, 'live_answer', message);
  }

  assert.equal(localIntentDecision('在百度搜索土风舞代表性舞蹈').action, 'create_plan');
  assert.equal(localIntentDecision('联网搜索并批量收集土风舞资料').action, 'clarify');
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
  assert.deepEqual(inferResearchKeywords('请你去百度和知乎上面搜索一下数据标注。采集信息，并告诉我这个职位是什么意思。'), ['数据标注']);
  assert.deepEqual(inferResearchKeywords('在知乎搜索数据标注，并告诉我这个职位是什么意思'), ['数据标注']);
  assert.deepEqual(inferResearchKeywords('去百度搜索数据分析师，告诉我这个岗位是做什么的'), ['数据分析师']);
  assert.deepEqual(inferResearchPlatforms('采集小红书和知乎'), ['xhs', 'zhihu']);
  assert.deepEqual(inferResearchPlatforms('解析 https://www.bilibili.com/video/BV1xx411c7mD'), ['bili']);
  assert.deepEqual(inferResearchPlatforms('抓取 https://v.douyin.com/example/ 的评论'), ['douyin']);
});

test('plan normalization preserves explicit user questions as analysis goals', () => {
  const { normalizePlan } = require('../src/server/services/AgentService');
  const request = `你去豆包、元宝、DeepSeek、纳米 AI、千问、文心一言、Kimi 上面搜索一下福州镇海楼，然后告诉我：
1. 镇海楼是什么东西？
2. 它的作用是什么？
3. 当初为什么建这个楼？`;
  const normalized = normalizePlan({
    platforms: ['doubao', 'yuanbao', 'deepseek', 'nami', 'qwen', 'wenxin', 'kimi'],
    keywords: ['福州镇海楼'],
    analysis: [],
  }, request);
  assert.deepEqual(normalized.analysis, [
    '镇海楼是什么东西？',
    '它的作用是什么？',
    '当初为什么建这个楼？',
  ]);
  assert.equal(normalized.analysisSource, 'user');
});

test('plan normalization preserves one unnumbered user question as an analysis goal', () => {
  const { normalizePlan } = require('../src/server/services/AgentService');
  const request = '你去头条、百度、Bing、哔哩哔哩搜索一下郑成功，然后告诉我他的历史成功的标志是什么。';
  const normalized = normalizePlan({
    goal: '搜索郑成功相关信息，了解其历史成功的标志',
    platforms: ['bili', 'baidu', 'bing', 'toutiao'],
    keywords: ['郑成功'],
    analysis: [],
  }, request);
  assert.deepEqual(normalized.analysis, ['他的历史成功的标志是什么']);
  assert.equal(normalized.analysisSource, 'user');
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
    'xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu', 'baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso',
    'arxiv', 'github_repositories', 'aihot', 'deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin', 'heimao', 'boss', 'zhaopin', 'job51', 'liepin',
  ]);
});

test('BOSS 直聘 aliases require explicit platform context and preserve ordinary English Boss', () => {
  assert.deepEqual(inferResearchPlatforms('在 BOSS直聘 搜索 Java 后端'), ['boss']);
  assert.deepEqual(inferResearchPlatforms('在 BOSS 直聘上找产品经理'), ['boss']);
  assert.deepEqual(inferResearchPlatforms('用 boss 搜索上海数据分析师'), ['boss']);
  assert.deepEqual(
    inferResearchPlatforms('你去智联、猎聘、BOSS、前程无忧上面搜索一下 FDE 工程师'),
    ['boss', 'zhaopin', 'job51', 'liepin'],
  );
  assert.deepEqual(inferResearchPlatforms('采集 https://www.zhipin.com/web/geek/job?query=Java'), ['boss']);
  assert.deepEqual(inferResearchPlatforms('所有招聘平台'), ['boss', 'zhaopin', 'job51', 'liepin']);
  assert.deepEqual(inferResearchKeywords('在 BOSS直聘 搜索 Java 后端'), ['Java 后端']);
  assert.doesNotMatch(
    inferResearchKeywords('你去智联、猎聘、BOSS、前程无忧上面搜索一下 FDE 工程师')[0],
    /boss/i,
  );
  assert.equal(localIntentDecision('在 BOSS直聘 搜索 Java 后端').action, 'create_plan');

  for (const message of ['How do I talk to my Boss?', 'Boss Baby 电影怎么样？', 'Boss 招聘员工要注意什么？']) {
    assert.deepEqual(inferResearchPlatforms(message), [], message);
    assert.equal(localIntentDecision(message).action, 'chat', message);
  }
});

test('BOSS 直聘 planner aliases normalize to the registered boss connector', () => {
  const { normalizePlan } = require('../src/server/services/AgentService');
  for (const alias of ['boss', 'BOSS', 'Boss', 'BOSS直聘', 'BOSS 直聘', 'zhipin.com']) {
    const plan = normalizePlan(
      { platforms: [alias], keywords: ['Java 后端'] },
      '在 BOSS直聘搜索 Java 后端',
    );
    assert.deepEqual(plan.platforms, ['boss'], alias);
  }

  const listPlan = normalizePlan(
    { platforms: ['zhaopin', 'job51', 'liepin'], keywords: ['FDE 工程师'] },
    '你去智联、猎聘、BOSS、前程无忧上面搜索一下 FDE 工程师',
  );
  assert.deepEqual(listPlan.platforms, ['boss', 'zhaopin', 'job51', 'liepin']);
});

test('arXiv requests select the academic connector and remove the platform name from keywords', () => {
  assert.deepEqual(inferResearchPlatforms('在 arXiv 搜索 Agent 论文'), ['arxiv']);
  assert.deepEqual(inferResearchPlatforms('去论文库查 RAG'), ['arxiv']);
  assert.deepEqual(inferResearchKeywords('在 arXiv 搜索 Agent 论文'), ['Agent']);
  assert.equal(localIntentDecision('在 arXiv 搜索 Agent 论文').action, 'create_plan');

  const academicRequests = [
    ['如果我要查询学术的话，有什么要求吗？我想要查询关于 LED 电磁的学术论文，你帮我查询。', 'LED 电磁'],
    ['我想要查询关于 LED 点阵的学术论文，请你帮我查询。有什么要求？', 'LED 点阵'],
  ] as const;
  for (const [message, keyword] of academicRequests) {
    assert.deepEqual(inferResearchPlatforms(message), ['arxiv'], message);
    assert.deepEqual(inferResearchKeywords(message), [keyword], message);
    assert.equal(localIntentDecision(message).action, 'create_plan', message);
  }
});

test('GitHub repository requests select the merged connector and remove the platform name from keywords', () => {
  assert.deepEqual(inferResearchPlatforms('在 GitHub 搜索 Agent 框架'), ['github_repositories']);
  assert.deepEqual(inferResearchPlatforms('看看 GitHub AI 热门项目'), ['github_repositories']);
  assert.deepEqual(inferResearchPlatforms('分析 https://github.com/openai/openai-node'), ['github_repositories']);
  assert.deepEqual(inferResearchKeywords('在 GitHub 搜索 Agent 框架'), ['Agent 框架']);
  assert.equal(localIntentDecision('看看 GitHub AI 热门项目').action, 'create_plan');
});

test('AI HOT requests select the connector and can omit keywords', () => {
  const { normalizePlan } = require('../src/server/services/AgentService');
  const forcedAiHotPrompt = '只使用 AI HOT 搜索最近 7 天的 OpenAI 资讯，创建采集任务，不要使用普通搜索引擎。';
  assert.deepEqual(inferResearchPlatforms(forcedAiHotPrompt), ['aihot']);
  const forcedAiHotPlan = normalizePlan({
    platforms: ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso'],
    keywords: ['OpenAI'],
    capability: 'keyword_search',
  }, forcedAiHotPrompt);
  assert.deepEqual(forcedAiHotPlan.platforms, ['aihot']);
  assert.deepEqual(forcedAiHotPlan.keywords, ['OpenAI']);
  assert.equal(forcedAiHotPlan.connectorOptions.aihot?.window, '7d');
  assert.deepEqual(inferResearchPlatforms('看看 AI HOT 当前热点'), ['aihot']);
  assert.deepEqual(inferResearchPlatforms('搜索 AI 资讯搜索里的 OpenAI 动态'), ['aihot']);
  assert.deepEqual(inferResearchPlatforms('看看最近的 AI 行业资讯'), ['aihot']);
  assert.deepEqual(inferResearchPlatforms('给我今天的 AI 日报'), ['aihot']);
  assert.deepEqual(normalizePlan({ platforms: ['AI 资讯搜索（AI HOT）'], keywords: ['OpenAI'] }, '搜索 OpenAI 近期动态').platforms, ['aihot']);
  assert.equal(inferResearchPlatforms('用 AI 搜索回答这个问题').includes('aihot'), false);
  for (const genericKeyword of ['AI', 'AI新闻', 'AI 资讯', 'AI行业资讯', 'AI HOT']) {
    const plan = normalizePlan(
      { platforms: ['aihot'], keywords: [genericKeyword], capability: 'keyword_search' },
      '你去采集一下最近的 AI 新闻。',
    );
    assert.deepEqual(plan.keywords, [], genericKeyword);
  }
  for (const subjectKeyword of ['OpenAI', 'Sora', 'AI Agent']) {
    const plan = normalizePlan(
      { platforms: ['aihot'], keywords: [subjectKeyword], capability: 'keyword_search' },
      `采集最近的 ${subjectKeyword} 新闻`,
    );
    assert.deepEqual(plan.keywords, [subjectKeyword], subjectKeyword);
  }
  assert.deepEqual(
    normalizePlan(
      { platforms: ['aihot'], keywords: ['AI新闻'], capability: 'keyword_search' },
      '使用 AI HOT 搜索，关键词：AI新闻',
    ).keywords,
    ['AI新闻'],
  );
  const previousOpenAiPlan = normalizePlan(
    { platforms: ['aihot'], keywords: ['OpenAI'], capability: 'keyword_search' },
    '只使用 AI HOT 搜索最近 7 天的 OpenAI 资讯',
  );
  for (const plannerKeywords of [[], ['OpenAI']]) {
    const noKeywordPlan = normalizePlan(
      { platforms: ['aihot'], keywords: plannerKeywords, capability: 'keyword_search' },
      '只采集 AI HOT 最近 24 小时的精选资讯，不限定关键词。',
      previousOpenAiPlan,
    );
    assert.deepEqual(noKeywordPlan.platforms, ['aihot']);
    assert.deepEqual(noKeywordPlan.keywords, []);
    assert.equal(noKeywordPlan.connectorOptions.aihot?.content_mode, 'items');
  }
  assert.equal(localIntentDecision('看看 AI HOT 当前热点').action, 'create_plan');
  for (const message of [
    '你去看一下AI hot有什么新闻吗？',
    '看看 AI HOT 有什么最新资讯',
    'AI热榜最近有什么动态',
    'AI热点有什么新消息',
  ]) {
    assert.deepEqual(inferResearchPlatforms(message), ['aihot'], message);
    assert.equal(localIntentDecision(message).action, 'create_plan', message);
  }
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

test('collection deliverables containing 多少 remain new research requests', () => {
  const salaryRequest = '采集 Boss 直聘、智联猎聘、前程无忧，岗位是 FDE 工程师，告诉我这个岗位在福州的平均薪资是多少？';
  assert.equal(localIntentDecision(salaryRequest).action, 'create_plan');
  assert.deepEqual(inferResearchPlatforms(salaryRequest), ['boss', 'zhaopin', 'job51', 'liepin']);
  assert.deepEqual(inferResearchKeywords(salaryRequest), ['FDE 工程师']);

  assert.equal(localIntentDecision('在小红书采集投诉帖子，看看有多少人投诉').action, 'create_plan');
  assert.equal(localIntentDecision('采集新能源汽车销量，告诉我增长了多少').action, 'clarify');
});

test('job plan normalization validates explicit locations and analysis goals', () => {
  const { normalizePlan } = require('../src/server/services/AgentService');
  const request = '采集 Boss 直聘、智联猎聘、前程无忧，岗位是 FDE 工程师，告诉我这个岗位在福州的平均薪资是多少？';
  const plan = normalizePlan({
    platforms: ['boss', 'zhaopin', 'job51', 'liepin'],
    keywords: ['FDE', '现场应用工程师', '现场工程师', 'FAE', '福州', '福建'],
    connectorOptions: {},
    analysis: [],
  }, request);

  assert.deepEqual(plan.keywords, ['FDE 工程师']);
  for (const platform of ['boss', 'zhaopin', 'job51', 'liepin']) {
    assert.equal(plan.connectorOptions[platform].location, '福州', platform);
  }
  assert.deepEqual(plan.analysis, ['这个岗位在福州的平均薪资是多少？']);
});

test('CSV requests use the real export action', () => {
  for (const message of ['导出本次数据为 CSV', '下载CSV', '下载 Excel', '导出为 XLSX', '把采集结果导出成表格', '导出到 Obsidian', '生成 IMA 数据包']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'export', message);
  }
});

test('completed task analysis stays on the local analysis path', () => {
  for (const message of ['分析结果呀，gpt 5.6模型有哪些？', '根据刚才结果总结一下', '分析这个 CSV 的结论', '基于当前所有采集数据，输出一份结构化、含核心发现的调研简报']) {
    assert.equal(localIntentDecision(message, { planStatus: 'completed' }).action, 'analyze', message);
  }
});

test('explicit follow-up collection runs before combined analysis', () => {
  const message = '你再去小红书上搜索一下关键词“宝可梦”，并结合所有信息再分析一遍给我。';

  assert.deepEqual(inferResearchPlatforms(message), ['xhs']);
  assert.deepEqual(inferResearchKeywords(message), ['宝可梦']);
  assert.equal(localIntentDecision(message, {
    planStatus: 'completed',
    hasCollectedData: true,
  }).action, 'create_plan');
});

test('references to all collected data do not expand to every platform', () => {
  assert.deepEqual(inferResearchPlatforms('基于当前所有采集数据，输出一份结构化、含核心发现的调研简报'), []);
  assert.deepEqual(inferResearchPlatforms('分析全部数据并给出结论'), []);
  assert.deepEqual(inferResearchPlatforms('采集全部平台'), [
    'xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu',
    'baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso', 'arxiv', 'github_repositories', 'aihot',
    'deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin', 'heimao',
    'boss', 'zhaopin', 'job51', 'liepin',
  ]);
  assert.deepEqual(inferResearchPlatforms('全部'), [
    'xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu',
    'baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso', 'arxiv', 'github_repositories', 'aihot',
    'deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin', 'heimao',
    'boss', 'zhaopin', 'job51', 'liepin',
  ]);
});

test('sidebar analysis suggestions always analyze existing data without expanding collection scope', () => {
  const prompts = [
    '对比分析各平台在内容侧重、受众态度与讨论热度上的分布差异',
    '提炼全部采集内容中的核心论点、高赞观点与关键事实要点',
    '深入挖掘评论区与正文中用户集中吐槽的痛点、诉求与负面反馈',
    '梳理数据中多方争论的核心矛盾、分歧立场与代表性辩论观点',
    '对不同信源与平台提供的信息进行交叉验证，指出存疑或矛盾点',
    '基于当前所有采集数据，输出一份结构化、含核心发现的调研简报',
  ];

  for (const prompt of prompts) {
    assert.deepEqual(inferResearchPlatforms(prompt), [], prompt);
    for (const planStatus of ['completed', 'partially_completed', 'failed', 'stopped']) {
      assert.equal(localIntentDecision(prompt, { planStatus, hasCollectedData: true }).action, 'analyze', `${planStatus}: ${prompt}`);
    }
  }
});

test('running tasks allow partial analysis of already collected results', () => {
  assert.equal(localIntentDecision('先分析目前采到的结果', { planStatus: 'running' }).action, 'analyze');
});

test('capability and model questions never become collection plans', () => {
  for (const message of ['请问你有什么功能？', '你有哪些功能', '你会什么？', '你能提供什么功能？']) {
    const decision = localIntentDecision(message);
    assert.equal(decision.action, 'chat', message);
    assert.equal(isSimpleConversation(message), true, message);
    assert.match(decision.reply, /普通咨询.*不会创建采集任务/);
  }
  for (const message of ['你支持什么平台', '你支持采集什么平台', '支持哪些平台？']) {
    const decision = localIntentDecision(message);
    assert.equal(decision.action, 'chat', message);
    assert.equal(isSimpleConversation(message), true, message);
    assert.match(decision.reply, /小红书.*抖音.*知乎/);
  }
  assert.equal(localIntentDecision('你用的是什么模型？').action, 'model_info');
});

test('query wording with explicit AI platforms creates a real collection plan', () => {
  const message = '在Deepseek、豆包、文心、千问、元宝这五个AI平台，查询“科莱特培训靠谱吗”这个关键词';
  assert.equal(localIntentDecision(message).action, 'create_plan');
  assert.deepEqual(inferResearchPlatforms(message), ['deepseek', 'doubao', 'qwen', 'yuanbao', 'wenxin']);
  assert.deepEqual(inferResearchKeywords(message), ['科莱特培训靠谱吗']);
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
  assert.deepEqual(inferResearchPlatforms('你去百度、Bing、360 搜索以下关键词：“antigravity”、“反重力”。'), ['baidu', 'bing', 'so360']);
  assert.deepEqual(inferResearchPlatforms('在百度和头条搜索'), ['baidu', 'toutiao']);
  assert.deepEqual(inferResearchPlatforms('在神马搜索和中国搜索查找'), ['quark', 'chinaso']);
  assert.deepEqual(inferResearchPlatforms('在百度贴吧搜索'), ['tieba']);
  assert.deepEqual(inferResearchPlatforms('采集所有搜索引擎'), ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso']);
  assert.deepEqual(inferResearchPlatforms('在搜索引擎上查找'), ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso']);
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
  assert.equal(hasExplicitCollectionDepth('深度调研并采集抖音上的课程评价'), true);
  assert.equal(inferCollectionDepth('深度调研并采集抖音上的课程评价'), 'deep');
  assert.equal(hasExplicitCollectionDepth('尽量全面采集小红书上的新品反馈'), true);
  assert.equal(inferCollectionDepth('按常规范围采集'), 'standard');
});

test('negative platform exclusion directives filter out specified platforms', () => {
  const { inferExcludedPlatforms } = require('../src/server/services/AgentIntent');
  const { normalizePlan } = require('../src/server/services/AgentService');
  const { skillRegistry } = require('../src/skills/registry');

  assert.deepEqual(inferExcludedPlatforms('不要采集黑猫投诉，关键词：易拓'), ['heimao']);
  assert.deepEqual(inferExcludedPlatforms('排除小红书和抖音'), ['xhs', 'douyin']);
  assert.deepEqual(inferExcludedPlatforms('黑猫投诉除外'), ['heimao']);
  assert.deepEqual(inferExcludedPlatforms('不要采集 BOSS直聘'), ['boss']);
  assert.deepEqual(inferExcludedPlatforms('排除 boss 和智联招聘'), ['boss', 'zhaopin']);
  assert.deepEqual(inferExcludedPlatforms('zhipin.com 除外'), ['boss']);
  assert.deepEqual(
    inferExcludedPlatforms('不要使用普通搜索引擎'),
    ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso'],
  );

  const skill = skillRegistry.get('brand-geo-risk-monitor');
  const plan = normalizePlan(
    { keywords: ['易拓'] },
    '不要采集黑猫投诉，关键词：易拓',
    undefined,
    false,
    skill,
  );

  assert.equal(plan.platforms.includes('heimao'), false);
  assert.deepEqual(plan.platforms, ['deepseek', 'kimi', 'doubao', 'qwen']);
  assert.deepEqual(plan.keywords, ['易拓']);

  const additivePlan = normalizePlan(
    { keywords: ['皮卡丘'] },
    '@品牌GEO与风险监测 不要采集黑猫，多采集一个百度搜索，关键词：皮卡丘',
    undefined,
    false,
    skill,
  );

  assert.equal(additivePlan.platforms.includes('heimao'), false);
  assert.equal(additivePlan.platforms.includes('baidu'), true);
  assert.deepEqual(additivePlan.platforms, ['deepseek', 'kimi', 'doubao', 'qwen', 'baidu']);
  assert.deepEqual(additivePlan.keywords, ['皮卡丘']);
});

test('explicit slash commands route deterministically to system actions', () => {
  // 1. /help
  const helpDecision = localIntentDecision('/help');
  assert.equal(helpDecision.action, 'chat');
  assert.ok(helpDecision.reply.includes('UniSearch 快捷指令与技能指南'));
  assert.ok(helpDecision.reply.includes('/crawl'));

  // 2. /status
  assert.equal(localIntentDecision('/status').action, 'status');
  assert.equal(localIntentDecision('/进度').action, 'status');

  // 3. /stop
  assert.equal(localIntentDecision('/stop', { planStatus: 'running' }).action, 'stop');
  assert.equal(localIntentDecision('/stop', { planStatus: null }).action, 'stop');

  // 4. /export
  assert.equal(localIntentDecision('/export').action, 'export');
  assert.equal(localIntentDecision('/导出').action, 'export');

  // 5. /report
  assert.equal(localIntentDecision('/report').action, 'analyze');
  assert.equal(localIntentDecision('/简报').action, 'analyze');

  // 6. /crawl - empty
  const emptyCrawl = localIntentDecision('/crawl');
  assert.equal(emptyCrawl.action, 'clarify');
  assert.deepEqual(emptyCrawl.missingFields, ['subject']);

  // 7. /crawl - only subject, no platform
  const subjectOnlyCrawl = localIntentDecision('/crawl 扫地机器人');
  assert.equal(subjectOnlyCrawl.action, 'clarify');
  assert.deepEqual(subjectOnlyCrawl.missingFields, ['platforms']);

  // 8. /crawl - subject + platforms
  const fullCrawl = localIntentDecision('/crawl 扫地机器人 小红书 微博');
  assert.equal(fullCrawl.action, 'create_plan');
  assert.deepEqual(inferResearchKeywords('/crawl 扫地机器人 小红书 微博'), ['扫地机器人']);
  assert.deepEqual(inferResearchPlatforms('/crawl 扫地机器人 小红书 微博'), ['xhs', 'weibo']);

  // 9. /crawl combined with @Skill
  const skillCrawl = localIntentDecision('/crawl @新媒体内容调研 扫地机器人', {
    mentionedSkills: ['marketing-content-research'],
  });
  assert.equal(skillCrawl.action, 'create_plan');
  assert.deepEqual(inferResearchKeywords('/crawl @新媒体内容调研 扫地机器人'), ['扫地机器人']);
});

test('multi-line and numbered keyword lists are extracted and sanitized correctly', () => {
  const userInput = `请你在 DeepSeek、豆包、文心一言、千问、元宝上搜索以下全部关键词：
1. sap培训
2. sap培训哪家好
3. 科莱特sap培训
4. Sap培训机构
5. SAP培训推荐
6. 科莱特招聘`;

  const keywords = inferExplicitResearchKeywords(userInput);
  assert.deepEqual(keywords, [
    'sap培训',
    'sap培训哪家好',
    '科莱特sap培训',
    'Sap培训机构',
    'SAP培训推荐',
    '科莱特招聘',
  ]);

  const plan = normalizePlan({
    platforms: ['deepseek', 'doubao', 'wenxin', 'qwen', 'yuanbao'],
  }, userInput);
  assert.deepEqual(plan.keywords, [
    'sap培训',
    'sap培训哪家好',
    '科莱特sap培训',
    'Sap培训机构',
    'SAP培训推荐',
    '科莱特招聘',
  ]);
  assert.deepEqual(plan.platforms, ['deepseek', 'doubao', 'qwen', 'yuanbao', 'wenxin']);
});

test('chinese numbered lists, markdown bullets, and single-line numbered keywords are extracted correctly', () => {
  // Chinese numbering
  const chineseList = `搜索关键词：
1、实施顾问
2、ABAP开发
3、SAP项目经理`;
  assert.deepEqual(inferExplicitResearchKeywords(chineseList), [
    '实施顾问',
    'ABAP开发',
    'SAP项目经理',
  ]);

  // Markdown bullets
  const bulletList = `以下关键词：
- 前端工程化
* React服务端渲染
• Node微服务架构`;
  assert.deepEqual(inferExplicitResearchKeywords(bulletList), [
    '前端工程化',
    'React服务端渲染',
    'Node微服务架构',
  ]);

  // Single line with numbers
  const singleLineNumbered = `在小红书搜索关键词：1. 人工智能 2. 大语言模型 3. Agent开发`;
  assert.deepEqual(inferExplicitResearchKeywords(singleLineNumbered), [
    '人工智能',
    '大语言模型',
    'Agent开发',
  ]);

  // Keyword item cleaning preserves digits in subject
  assert.equal(cleanKeywordItem('1. 3D打印机推荐'), '3D打印机推荐');
  assert.equal(cleanKeywordItem('2、Web3.0开发者'), 'Web3.0开发者');
  assert.equal(cleanKeywordItem('(3) 2026校招'), '2026校招');
  assert.equal(cleanKeywordItem('- SAP培训，'), 'SAP培训');
});


