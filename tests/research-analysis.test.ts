import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchPlan } from '../src/server/services/AgentRepository';
import { inferAnalysisGoals, inferAnalysisRevision, normalizeAnalysisGoals } from '../src/server/services/ResearchAnalysis';

function plan(analysis: string[]): ResearchPlan {
  return {
    goal: '调研做 AIGC 培训的机构', platforms: ['dy'], keywords: ['AIGC培训'],
    collectComments: true, collectSubComments: false, startPage: 1,
    loginType: 'qrcode', headless: false, analysis, outputs: ['csv'],
  };
}

test('analysis fallback follows the research goal', () => {
  const goals = inferAnalysisGoals('调研做 AIGC 培训的机构');
  assert.deepEqual(goals, ['机构与品牌识别', '课程定位与内容', '价格与服务对比', '师资、案例与承诺', '用户评价与需求']);
  assert.deepEqual(normalizeAnalysisGoals([], '调研做 AIGC 培训的机构'), goals);
});

test('model supplied goals are normalized and retained', () => {
  assert.deepEqual(normalizeAnalysisGoals([' 课程对比 ', '课程对比', '收费模式'], '培训机构'), ['课程对比', '收费模式']);
});

test('analysis goals can be replaced, added, and removed in natural language', () => {
  const base = plan(['机构与品牌识别', '课程定位与内容', '用户情感及原因']);
  assert.deepEqual(inferAnalysisRevision('把分析目标改成价格与服务对比、师资案例', base), ['价格与服务对比', '师资案例']);
  assert.deepEqual(inferAnalysisRevision('增加分析目标：价格对比', base), [...base.analysis, '价格对比']);
  assert.deepEqual(inferAnalysisRevision('去掉情感分析', base), ['机构与品牌识别', '课程定位与内容']);
});
