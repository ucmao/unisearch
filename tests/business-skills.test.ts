import assert from 'node:assert/strict';
import test from 'node:test';
import { skillRegistry } from '../src/skills/registry';
import { looksLikeSimulatedPlanReply, normalizePlan, shouldAutoStartPlan, shouldAutoStartSkill } from '../src/server/services/AgentService';

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
  assert.deepEqual(plan.outputs, ['csv']);
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

test('clear low-risk public collection starts automatically', () => {
  const githubPlan = normalizePlan({
    goal: 'GitHub 热点',
    platforms: ['github_repositories'],
    keywords: ['AI Agent'],
    capability: 'keyword_search',
    analysis: ['总结热门方向'],
  }, '采集并分析 GitHub AI Agent 热点');

  assert.equal(shouldAutoStartPlan(githubPlan, '采集并分析 GitHub AI Agent 热点'), true);
});

test('high-risk or explicitly deferred collection still waits for confirmation', () => {
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

  assert.equal(shouldAutoStartPlan({ ...publicPlan, collectionDepth: 'deep' }, '深度采集 GitHub AI Agent'), false);
  assert.equal(shouldAutoStartPlan(publicPlan, '先给我看计划，确认后再采集'), false);
  assert.equal(shouldAutoStartPlan(authenticatedPlan, '在小红书搜索 AI Agent'), false);
  assert.equal(shouldAutoStartPlan({
    ...publicPlan,
    connectorOptions: { github_repositories: { max_items: 100 } },
  }, '在 GitHub 搜索 100 条 AI Agent 仓库'), false);
});

test('plain chat cannot impersonate a persisted collection plan', () => {
  assert.equal(looksLikeSimulatedPlanReply('GitHub 热点采集计划\n平台：GitHub\n关键词：热点\n确认后开始执行？'), true);
  assert.equal(looksLikeSimulatedPlanReply('可以采集 GitHub 的公开仓库信息。'), false);
});
