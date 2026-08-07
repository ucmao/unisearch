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

  assert.equal(skill.mentionable, true);
  assert.equal(skill.category, 'tool');
  assert.equal(skill.defaults?.capability, 'creator_profile');
  assert.deepEqual(skill.defaults?.platforms, []);
  assert.deepEqual(
    skill.targetGuidance.map((item) => item.platform),
    ['xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu'],
  );
  assert.ok(skill.targetGuidance.every((item) => item.accepted.length && item.examples.length));
});

test('input catalog exposes four business skills and three deterministic tools', () => {
  const mentionable = skillRegistry.list().filter((skill) => skill.mentionable);
  assert.deepEqual(
    mentionable.filter((skill) => skill.category === 'business').map((skill) => skill.id),
    ['sales-course-intelligence', 'marketing-content-research', 'brand-geo-risk-monitor', 'hr-salary-benchmark'],
  );
  assert.deepEqual(
    mentionable.filter((skill) => skill.category === 'tool').map((skill) => skill.id),
    ['web-search-research', 'creator-profile-collection', 'web-media-parser'],
  );

  const search = skillRegistry.get('web-search-research');
  assert.deepEqual(search.defaults?.platforms, ['baidu', 'bing', 'so360', 'sogou', 'toutiao']);
  assert.deepEqual(search.defaults?.analysis, []);
  assert.equal(search.execution.autoAnalyzeOnCompletion, false);

  const parser = skillRegistry.get('web-media-parser');
  assert.deepEqual(parser.defaults?.platforms, ['media_parser']);
  assert.equal(parser.defaults?.capability, 'url_resolve');
  assert.deepEqual(parser.defaults?.analysis, []);
  assert.equal(parser.execution.autoAnalyzeOnCompletion, false);
});

test('tool defaults choose their deterministic connector capability', () => {
  const parser = skillRegistry.get('web-media-parser');
  const parserPlan = normalizePlan(
    { goal: '批量解析链接', targets: ['https://example.com/a', 'https://example.com/b'] },
    '@全网综合解析 https://example.com/a https://example.com/b',
    undefined,
    false,
    parser,
  );
  assert.deepEqual(parserPlan.platforms, ['media_parser']);
  assert.equal(parserPlan.capability, 'url_resolve');
  assert.deepEqual(parserPlan.analysis, []);
  assert.equal(parserPlan.autoAnalyze, false);

  const search = skillRegistry.get('web-search-research');
  const searchPlan = normalizePlan(
    { goal: '搜索', keywords: ['Agent', 'RAG'] },
    '@全网搜索 Agent RAG',
    undefined,
    false,
    search,
  );
  assert.deepEqual(searchPlan.platforms, ['baidu', 'bing', 'so360', 'sogou', 'toutiao']);
  assert.equal(searchPlan.capability, 'keyword_search');
  assert.deepEqual(searchPlan.keywords, ['Agent', 'RAG']);
  assert.deepEqual(searchPlan.analysis, []);
  assert.equal(searchPlan.autoAnalyze, false);
});

test('media parser extracts multiple links without splitting share copy into words', () => {
  assert.deepEqual(
    extractParserTargets('复制文案 https://example.com/a 然后解析 https://example.com/b。'),
    ['https://example.com/a', 'https://example.com/b'],
  );
  assert.deepEqual(extractParserTargets('第一条分享文案\n第二条分享文案'), ['第一条分享文案', '第二条分享文案']);
});

test('an explicitly mentioned Connector overrides a Skill default platform set', () => {
  const skill = skillRegistry.get('sales-course-intelligence');
  const plan = normalizePlan({
    goal: 'SAP FICO 竞品调研',
    platforms: [],
    keywords: ['SAP FICO'],
    capability: 'keyword_search',
  }, '@销售课程竞争情报 SAP FICO', undefined, false, skill, ['zhihu']);

  assert.deepEqual(plan.platforms, ['zhihu']);
  assert.equal(plan.skillId, 'sales-course-intelligence');
});

test('business Skills only auto-start when the user explicitly invokes them', () => {
  const skill = skillRegistry.get('sales-course-intelligence');
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
  assert.equal(shouldAutoStartPlan(authenticatedPlan, '@销售课程竞争情报 先看计划', skillRegistry.get('sales-course-intelligence'), true), false);
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
  assert.equal(looksLikeSimulatedPlanReply('可以采集 GitHub 的公开仓库信息。'), false);
});
