import assert from 'node:assert/strict';
import test from 'node:test';
import { skillRegistry } from '../src/skills/registry';
import { looksLikeSimulatedPlanReply, normalizePlan, shouldAutoStartPlan, shouldAutoStartSkill } from '../src/server/services/AgentService';
import { extractParserTargets } from '../src/crawler/platforms/media_parser';

test('a business Skill applies deterministic platform and analysis defaults', () => {
  const skill = skillRegistry.get('marketing-content-research');
  const plan = normalizePlan({
    goal: '新能源汽车内容调研',
    platforms: ['weibo'],
    keywords: ['新能源汽车'],
    capability: 'keyword_search',
    analysis: [],
  }, '@新媒体内容调研 新能源汽车', undefined, false, skill);

  assert.equal(plan.skillId, skill.id);
  assert.deepEqual(plan.platforms, ['xhs', 'douyin']);
  assert.ok(plan.analysis.includes('内容主题与表达方式'));
  assert.equal(plan.autoAnalyze, true);
  assert.deepEqual(plan.outputs, ['csv']);
});

test('generic collection auto-analyzes without inventing visible goals', () => {
  const plan = normalizePlan({
    goal: '搜索莆田学院',
    platforms: ['bing', 'so360'],
    keywords: ['莆田学院'],
    capability: 'keyword_search',
    analysis: [],
  }, '去必应和360搜索关键词“莆田学院”');

  assert.deepEqual(plan.analysis, []);
  assert.equal(plan.autoAnalyze, true);
});

test('creator profile Skill documents an executable target contract for all seven social platforms', () => {
  const skill = skillRegistry.get('creator-profile-collection');

  assert.equal(skill.name, '博主主页采集');
  assert.equal(skill.mentionable, true);
  assert.equal(skill.category, 'tool');
  assert.equal(skill.defaults?.capability, 'creator_profile');
  assert.deepEqual(skill.defaults?.platforms, []);
  assert.equal(skill.description, '按主页链接或 ID，采集小红书、抖音、B站等博主的公开作品');
  assert.ok(skill.limitations.some((item) => item.includes('严格限定为七个社交平台')));
  assert.deepEqual(
    skill.targetGuidance.map((item) => item.platform),
    ['xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu'],
  );
  assert.ok(skill.targetGuidance.every((item) => item.accepted.length && item.examples.length));
});

test('input catalog exposes three business skills and six deterministic tools', () => {
  const mentionable = skillRegistry.list().filter((skill) => skill.mentionable);
  assert.deepEqual(
    mentionable.filter((skill) => skill.category === 'business').map((skill) => skill.id),
    ['marketing-content-research', 'brand-geo-risk-monitor', 'hr-salary-benchmark'],
  );
  assert.deepEqual(
    mentionable.filter((skill) => skill.category === 'tool').map((skill) => skill.id),
    [
      'web-search-research',
      'social-search-research',
      'ai-qa-research',
      'job-search-research',
      'web-media-parser',
      'creator-profile-collection',
    ],
  );

  const search = skillRegistry.get('web-search-research');
  assert.equal(search.name, '网页搜索');
  assert.deepEqual(search.defaults?.platforms, ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso']);
  assert.deepEqual(search.defaults?.analysis, []);
  assert.equal(search.execution.autoAnalyzeOnCompletion, false);

  const social = skillRegistry.get('social-search-research');
  assert.equal(social.name, '社媒搜索');
  assert.deepEqual(social.defaults?.platforms, ['xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu']);

  const ai = skillRegistry.get('ai-qa-research');
  assert.equal(ai.name, 'AI搜索');

  const parser = skillRegistry.get('web-media-parser');
  assert.equal(parser.name, '无水印解析');
  assert.deepEqual(parser.defaults?.platforms, ['media_parser']);
  assert.equal(parser.defaults?.capability, 'url_resolve');
  assert.deepEqual(parser.defaults?.analysis, []);
  assert.equal(parser.execution.autoAnalyzeOnCompletion, false);

  const academic = skillRegistry.get('academic-search-research');
  assert.equal(academic.mentionable, false);
  assert.deepEqual(academic.defaults?.platforms, ['arxiv']);

  const code = skillRegistry.get('code-search-research');
  assert.equal(code.mentionable, false);
  assert.deepEqual(code.defaults?.platforms, ['github_repositories']);
});

test('tool defaults choose their deterministic connector capability', () => {
  const parser = skillRegistry.get('web-media-parser');
  const parserPlan = normalizePlan(
    { goal: '批量解析链接', targets: ['https://example.com/a', 'https://example.com/b'] },
    '@无水印解析 https://example.com/a https://example.com/b',
    undefined,
    false,
    parser,
  );
  assert.deepEqual(parserPlan.platforms, ['media_parser']);
  assert.equal(parserPlan.capability, 'url_resolve');
  assert.deepEqual(parserPlan.analysis, []);
  assert.equal(parserPlan.autoAnalyze, false);

  const douyinParserPlan = normalizePlan(
    {
      goal: '解析抖音链接',
      platforms: ['media_parser', 'douyin'],
      targets: ['https://www.douyin.com/video/7668613077083983144'],
      capability: 'url_resolve',
    },
    '@无水印解析 https://www.douyin.com/video/7668613077083983144',
    undefined,
    false,
    parser,
  );
  assert.deepEqual(douyinParserPlan.platforms, ['media_parser']);
  assert.deepEqual(douyinParserPlan.targets, ['https://www.douyin.com/video/7668613077083983144']);

  const search = skillRegistry.get('web-search-research');
  const searchPlan = normalizePlan(
    { goal: '搜索', keywords: ['Agent', 'RAG'] },
    '@网页搜索 Agent RAG',
    undefined,
    false,
    search,
  );
  assert.deepEqual(searchPlan.platforms, ['baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso']);
  assert.equal(searchPlan.capability, 'keyword_search');
  assert.deepEqual(searchPlan.keywords, ['Agent', 'RAG']);
  assert.deepEqual(searchPlan.analysis, []);
  assert.equal(searchPlan.autoAnalyze, false);

  const aiTool = skillRegistry.get('ai-qa-research');
  const aiPlan = normalizePlan(
    { goal: 'AI 搜索' },
    '@AI搜索\n1. FDE工程师是什么？\n2. FDE工程师要怎么学？\n3. FDE工程师岗位的薪资怎么样？',
    undefined,
    false,
    aiTool,
  );
  assert.deepEqual(aiPlan.keywords, [
    'FDE工程师是什么',
    'FDE工程师要怎么学',
    'FDE工程师岗位的薪资怎么样',
  ]);
  assert.deepEqual(aiPlan.analysis, []);
  assert.equal(aiPlan.autoAnalyze, false);
});

test('media parser extracts multiple links without splitting share copy into words', () => {
  assert.deepEqual(
    extractParserTargets('复制文案 https://example.com/a 然后解析 https://example.com/b。'),
    ['https://example.com/a', 'https://example.com/b'],
  );
  assert.deepEqual(extractParserTargets('第一条分享文案\n第二条分享文案'), ['第一条分享文案', '第二条分享文案']);
});

test('an explicitly mentioned Connector overrides a Skill default platform set', () => {
  const skill = skillRegistry.get('marketing-content-research');
  const plan = normalizePlan({
    goal: '新能源车调研',
    platforms: [],
    keywords: ['新能源车'],
    capability: 'keyword_search',
  }, '@新媒体内容调研 新能源车', undefined, false, skill, ['zhihu']);

  assert.deepEqual(plan.platforms, ['zhihu']);
  assert.equal(plan.skillId, 'marketing-content-research');
});

test('business Skills only auto-start when the user explicitly invokes them', () => {
  const skill = skillRegistry.get('marketing-content-research');
  assert.equal(shouldAutoStartSkill(skill, true), true);
  assert.equal(shouldAutoStartSkill(skill, false), false);
  assert.equal(shouldAutoStartSkill(skillRegistry.get('multi-source-research'), true), false);
});

test('collection starts automatically by default', () => {
  const githubPlan = normalizePlan({
    goal: 'GitHub 热点',
    platforms: ['github_repositories'],
    keywords: ['AI Agent'],
    capability: 'keyword_search',
    analysis: ['总结热门方向'],
  }, '采集并分析 GitHub AI Agent 热点');

  assert.equal(shouldAutoStartPlan(githubPlan, '采集并分析 GitHub AI Agent 热点'), true);
});

test('only explicitly deferred collection waits for confirmation', () => {
  const publicPlan = normalizePlan({
    goal: '公开搜索',
    platforms: ['github_repositories'],
    keywords: ['AI Agent'],
    capability: 'keyword_search',
    analysis: [],
  }, '在 GitHub 搜索 AI Agent');
  const authenticatedPlan = normalizePlan({
    goal: '社交平台搜索',
    platforms: ['xhs'],
    keywords: ['AI Agent'],
    capability: 'keyword_search',
    analysis: [],
  }, '在小红书搜索 AI Agent');

  assert.equal(shouldAutoStartPlan({ ...publicPlan, collectionDepth: 'deep' }, '深度采集 GitHub AI Agent'), true);
  assert.equal(shouldAutoStartPlan(publicPlan, '先给我看计划，确认后再采集'), false);
  assert.equal(shouldAutoStartPlan(publicPlan, '先给我看一下采集计划'), false);
  assert.equal(shouldAutoStartPlan(publicPlan, '不要自动运行'), false);
  assert.equal(shouldAutoStartPlan(authenticatedPlan, '在小红书搜索 AI Agent'), true);
  assert.equal(shouldAutoStartPlan(authenticatedPlan, '@新媒体内容调研 先看计划', skillRegistry.get('marketing-content-research'), true), false);
  assert.equal(shouldAutoStartPlan({
    ...publicPlan,
    connectorOptions: { github_repositories: { max_items: 100 } },
  }, '在 GitHub 搜索 100 条 AI Agent 仓库'), true);
  assert.equal(shouldAutoStartPlan({
    ...publicPlan,
    platforms: ['github_repositories', 'baidu', 'bing', 'so360'],
  }, '在多个平台搜索 AI Agent'), true);
});

test('plain chat cannot impersonate a persisted collection plan', () => {
  assert.equal(looksLikeSimulatedPlanReply('GitHub 热点采集计划\n平台：GitHub\n关键词：热点\n确认后开始执行？'), true);
  assert.equal(looksLikeSimulatedPlanReply('✅ 计划已生成，正在执行中…\n|平台|关键词|状态|\n|豆包|科莱特培训靠谱吗|进行中|'), true);
  assert.equal(looksLikeSimulatedPlanReply('任务已创建并开始执行。'), true);
  assert.equal(looksLikeSimulatedPlanReply('可以采集 GitHub 的公开仓库信息。'), false);
  assert.equal(looksLikeSimulatedPlanReply('记住了。如果你之后想制定调研计划，也可以告诉我。'), false);
});

test('multiple @ tool mentions merge default platforms and resolve clean keywords', () => {
  const aiTool = skillRegistry.get('ai-qa-research');
  const webTool = skillRegistry.get('web-search-research');
  const jobTool = skillRegistry.get('job-search-research');

  const plan = normalizePlan(
    { goal: 'FDE 工程师综合调研' },
    '@AI搜索 @网页搜索 @岗位搜索 FDE 工程师',
    undefined,
    false,
    null,
    [],
    [aiTool, webTool, jobTool],
  );

  // Platform union of 7 AI + 7 Web + 4 Job platforms = 18 platforms
  const expectedPlatforms = [
    'deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin',
    'baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso',
    'zhaopin', 'job51', 'liepin', 'boss',
  ];
  assert.deepEqual(plan.platforms.sort(), expectedPlatforms.sort());
  assert.deepEqual(plan.keywords, ['FDE 工程师']);
  assert.equal(plan.skillId, 'multi-source-research');
  assert.equal(plan.autoAnalyze, true);
  assert.equal(shouldAutoStartPlan(plan, '@AI搜索 @网页搜索 @岗位搜索 FDE 工程师', null, true, [aiTool, webTool, jobTool]), true);
});

test('mixing business skill and tool mentions retains business analysis while unioning platforms', () => {
  const bizSkill = skillRegistry.get('marketing-content-research');
  const webTool = skillRegistry.get('web-search-research');

  const plan = normalizePlan(
    { goal: '新能源汽车舆情调研' },
    '@新媒体内容调研 @网页搜索 新能源汽车',
    undefined,
    false,
    bizSkill,
    [],
    [bizSkill, webTool],
  );

  // xhs, douyin from bizSkill + baidu, bing, so360, sogou, toutiao, quark, chinaso from webTool
  const expectedPlatforms = ['xhs', 'douyin', 'baidu', 'bing', 'so360', 'sogou', 'toutiao', 'quark', 'chinaso'];
  assert.deepEqual(plan.platforms.sort(), expectedPlatforms.sort());
  assert.deepEqual(plan.keywords, ['新能源汽车']);
  assert.equal(plan.skillId, 'marketing-content-research');
  assert.ok(plan.analysis.includes('内容主题与表达方式'));
  assert.equal(plan.autoAnalyze, true);
});
