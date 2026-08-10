import assert from 'node:assert/strict';
import test from 'node:test';
import type { ResearchPlan } from '../src/server/services/AgentRepository';
import { inferAnalysisRevision, inferExplicitAnalysisGoals, normalizeAnalysisGoals } from '../src/server/services/ResearchAnalysis';

function plan(analysis: string[]): ResearchPlan {
  return {
    goal: '调研做 AIGC 培训的机构', platforms: ['douyin'], keywords: ['AIGC培训'],
    collectionDepth: 'standard',
    loginType: 'qrcode', headless: false, analysis, outputs: ['csv'],
  };
}

test('empty analysis goals stay empty regardless of industry keywords', () => {
  assert.deepEqual(normalizeAnalysisGoals([], '调研做 AIGC 培训的机构'), []);
  assert.deepEqual(normalizeAnalysisGoals(undefined, '搜索莆田学院'), []);
});

test('model supplied goals are normalized and retained', () => {
  assert.deepEqual(normalizeAnalysisGoals([' 课程对比 ', '课程对比', '收费模式'], '培训机构'), ['课程对比', '收费模式']);
});

test('numbered questions attached to a collection request become analysis goals', () => {
  const request = `你去豆包、元宝、DeepSeek、纳米 AI、千问、文心一言、Kimi 上面搜索一下福州镇海楼，然后告诉我：
1. 镇海楼是什么东西？
2. 它的作用是什么？
3. 当初为什么建这个楼？`;
  assert.deepEqual(inferExplicitAnalysisGoals(request), [
    '镇海楼是什么东西？',
    '它的作用是什么？',
    '当初为什么建这个楼？',
  ]);
});

test('a single question attached to a collection request becomes an analysis goal', () => {
  assert.deepEqual(
    inferExplicitAnalysisGoals('你去头条、百度、Bing、哔哩哔哩搜索一下郑成功，然后告诉我他的历史成功的标志是什么。'),
    ['他的历史成功的标志是什么'],
  );
  assert.deepEqual(
    inferExplicitAnalysisGoals('搜索乔布斯，并分析一下他的性格特点和创业成功秘诀。'),
    ['他的性格特点和创业成功秘诀'],
  );
  assert.deepEqual(inferExplicitAnalysisGoals('采集分析报告中的公开案例'), []);
});

test('combined follow-up analysis keeps a meaningful goal instead of filler words', () => {
  assert.deepEqual(
    inferExplicitAnalysisGoals('你再去小红书上搜索一下关键词“宝可梦”，并结合所有信息再分析一遍给我。'),
    ['结合所有采集结果综合分析'],
  );
});

test('numbered platform or scope lists are not mistaken for analysis goals', () => {
  assert.deepEqual(inferExplicitAnalysisGoals('采集范围：\n1. 小红书\n2. 微博\n3. 知乎'), []);
  assert.deepEqual(inferExplicitAnalysisGoals('平台：\n1. 小红书\n2. 微博\n然后告诉我：\n1. 主要观点\n2. 用户反馈'), ['主要观点', '用户反馈']);
});

test('analysis goals can be replaced, added, and removed in natural language', () => {
  const base = plan(['机构与品牌识别', '课程定位与内容', '用户情感及原因']);
  assert.deepEqual(inferAnalysisRevision('把分析目标改成价格与服务对比、师资案例', base), ['价格与服务对比', '师资案例']);
  assert.deepEqual(inferAnalysisRevision('增加分析目标：价格对比', base), [...base.analysis, '价格对比']);
  assert.deepEqual(inferAnalysisRevision('去掉情感分析', base), ['机构与品牌识别', '课程定位与内容']);
  assert.deepEqual(inferAnalysisRevision('去掉情感分析', plan(['用户情感及原因'])), []);
});
