import assert from 'node:assert/strict';
import test from 'node:test';
import { skillRegistry } from '../src/skills/registry';
import { normalizePlan } from '../src/server/services/AgentService';

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
