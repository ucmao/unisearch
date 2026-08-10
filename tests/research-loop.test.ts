import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolExecutor } from '../src/server/agent/AgentToolRegistry';
import { AgentRunTrace } from '../src/server/agent/AgentToolRegistry';
import {
  ResearchLoop,
  shouldUseExperimentalResearchLoop,
  type ResearchLoopModel,
} from '../src/server/agent/ResearchLoop';
import type { ResearchEvidence, ResearchLoopState, ResearchStepDecision } from '../src/server/agent/ResearchTypes';

class ScriptedModel implements ResearchLoopModel {
  answerCalls = 0;
  constructor(private readonly decisions: ResearchStepDecision[]) {}
  async decideResearchStep(
    _question: string,
    _evidence: ResearchEvidence[],
    state: ResearchLoopState,
  ): Promise<ResearchStepDecision> {
    return this.decisions[state.step - 1] || { action: 'finish', reason: '脚本结束' };
  }
  async answerResearch(): Promise<string> {
    this.answerCalls++;
    return '综合结论 [S1]';
  }
}

function fakeExecutor(handler: (name: string, input: any) => unknown): AgentToolExecutor {
  return {
    async execute(name: string, input: unknown) {
      return handler(name, input);
    },
  } as unknown as AgentToolExecutor;
}

test('research loop is explicit opt-in and never captures collection requests', () => {
  assert.equal(shouldUseExperimentalResearchLoop('请深入核验这条新闻'), true);
  assert.equal(shouldUseExperimentalResearchLoop('今天有什么新闻'), false);
  assert.equal(shouldUseExperimentalResearchLoop('深度调研并采集小红书内容'), false);
  assert.equal(shouldUseExperimentalResearchLoop('多来源核验', { mentionedConnectors: ['zhihu'] }), false);
});

test('bounded loop searches, reads discovered URLs, then synthesizes evidence', async () => {
  const model = new ScriptedModel([
    { action: 'live_search', query: '测试新闻 核验', reason: '先寻找公开来源' },
    { action: 'direct_web_read', urls: ['https://example.com/report'], reason: '读取原文核实' },
    { action: 'finish', reason: '证据已经足够' },
  ]);
  const calls: string[] = [];
  const executor = fakeExecutor((name) => {
    calls.push(name);
    if (name === 'live_search') return [{
      id: 'S1', title: '搜索摘要', source: 'bing', sourceUrl: 'https://example.com/report',
      excerpt: '摘要', fetchedAt: new Date().toISOString(),
    }];
    if (name === 'direct_web_read') return {
      articles: [{
        content_id: '1', content_url: 'https://example.com/report', title: '原始报告', summary: '',
        description: '这是读取后的完整证据正文。'.repeat(20), creator_name: '', site_name: '示例站', images: [],
      }],
      failures: [],
    };
    throw new Error(`unexpected tool ${name}`);
  });
  const trace = new AgentRunTrace('thread-1');
  const result = await new ResearchLoop(model, executor).run('请深入核验测试新闻', {
    threadId: 'thread-1', messages: [{ role: 'user', content: '请深入核验测试新闻' }], trace,
  });

  assert.deepEqual(calls, ['live_search', 'direct_web_read']);
  assert.equal(model.answerCalls, 1);
  assert.equal(result.answer, '综合结论 [S1]');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].evidenceType, 'web_page');
  assert.equal(result.stopReason, '证据已经足够');
  assert.equal(result.steps, 3);
});

test('research loop stops after two steps without new evidence', async () => {
  const model = new ScriptedModel([
    { action: 'knowledge_query', query: '不存在', reason: '查询本地资料' },
    { action: 'knowledge_query', query: '仍不存在', reason: '换词重试' },
  ]);
  let calls = 0;
  const executor = fakeExecutor(() => { calls++; return []; });
  const result = await new ResearchLoop(model, executor).run('请深入研究一个不存在的主题', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.equal(calls, 2);
  assert.equal(model.answerCalls, 0);
  assert.equal(result.stopReason, '连续两步没有新增证据');
  assert.equal(result.steps, 2);
  assert.deepEqual(result.sources, []);
});

test('research loop refuses web reads for URLs it did not discover', async () => {
  const model = new ScriptedModel([
    { action: 'direct_web_read', urls: ['http://127.0.0.1/admin'], reason: '尝试读取未知地址' },
    { action: 'direct_web_read', urls: ['https://unknown.example/data'], reason: '再次尝试未知地址' },
  ]);
  let toolCalls = 0;
  const executor = fakeExecutor(() => { toolCalls++; return {}; });
  const result = await new ResearchLoop(model, executor).run('请深入核验某件事', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.equal(toolCalls, 0);
  assert.equal(result.stopReason, '连续两步没有新增证据');
});
