import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolExecutor } from '../src/server/agent/AgentToolRegistry';
import { AgentRunTrace } from '../src/server/agent/AgentToolRegistry';
import {
  ResearchLoop,
  isSearchRedirectUrl,
  invalidResearchAnswerReason,
  normalizeRelativeResearchQuery,
  requiresKnowledgeRetrieval,
  requiresWebRetrieval,
  requiredSourceQuery,
  shouldUseGlobalKnowledgeScope,
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
        content_quality: 'full',
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

test('research loop reads a discovered page before accepting a verification conclusion', async () => {
  const model = new ScriptedModel([
    { action: 'live_search', query: '产品 是否发布', reason: '搜索公开来源' },
    { action: 'finish', reason: '摘要似乎足够' },
    { action: 'finish', reason: '已读取正文' },
  ]);
  const calls: string[] = [];
  const executor = fakeExecutor((name) => {
    calls.push(name);
    if (name === 'live_search') return [{
      id: 'S1', title: '官方发布页', source: 'search', sourceUrl: 'https://www.apple.com/newsroom/example',
      excerpt: '搜索摘要', fetchedAt: new Date().toISOString(),
    }];
    return {
      articles: [{
        ...articleForResearch('https://www.apple.com/newsroom/example', '这是已经读取到的官方发布正文。'.repeat(20)),
        content_quality: 'full',
      }],
      failures: [],
    };
  });
  const result = await new ResearchLoop(model, executor).run('请深入核验这个产品是否已经公开发布', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.deepEqual(calls, ['live_search', 'direct_web_read']);
  assert.equal(result.evidence[0].contentQuality, 'full');
});

test('research loop keeps evidence when one webpage read fails', async () => {
  const model = new ScriptedModel([
    { action: 'live_search', query: '来源对比', reason: '先搜索' },
    { action: 'direct_web_read', urls: ['https://example.com/blocked'], reason: '读取原文' },
    { action: 'finish', reason: '使用已有证据回答' },
  ]);
  const executor = fakeExecutor((name) => {
    if (name === 'live_search') return [{
      id: 'S1', title: '可用摘要', source: 'search', sourceUrl: 'https://example.com/blocked',
      excerpt: '仍然可以保留的搜索证据', fetchedAt: new Date().toISOString(),
    }];
    throw new Error('Request failed with status code 403');
  });
  const result = await new ResearchLoop(model, executor).run('请深入研究并对比多个来源', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.equal(result.answer, '综合结论 [S1]');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.degraded, true);
});

test('research loop falls back to a cited evidence summary when final synthesis fails', async () => {
  const model: ResearchLoopModel = {
    async decideResearchStep() { return { action: 'finish', reason: '已有证据' }; },
    async answerResearch() { throw new Error('canceled'); },
  };
  const executor = fakeExecutor((name) => {
    if (name === 'live_search') return [{
      id: 'S1', title: '现有来源', source: 'search', sourceUrl: 'https://example.com/source',
      excerpt: '已有证据内容', fetchedAt: new Date().toISOString(),
    }];
    return [];
  });
  const seededModel: ResearchLoopModel = {
    async decideResearchStep(_q, _e, state) {
      return state.step === 1
        ? { action: 'live_search', query: '现有来源', reason: '获取证据' }
        : model.decideResearchStep(_q, _e, state);
    },
    answerResearch: model.answerResearch.bind(model),
  };
  const result = await new ResearchLoop(seededModel, executor).run('请深入研究这个主题', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.equal(result.degraded, true);
  assert.match(result.answer, /\[S1\]/);
  assert.match(result.stopReason, /最终回答生成失败/);
  assert.doesNotMatch(result.answer, /骗局|诈骗|培训效果|机构合法合规/);
  assert.match(result.answer, /最新网页搜索摘要/);
});

test('research loop rejects simulated tool protocol and never streams it to the user', async () => {
  const model: ResearchLoopModel = {
    async decideResearchStep() { return { action: 'live_search', query: '黄金价格2024年预测', reason: '搜索行情观点' }; },
    async answerResearch() {
      return '我来调用多个工具。\n<tool_result><tool name="deepseek"><parameter name="input">黄金预测</parameter></tool></tool_result>';
    },
  };
  const executor = fakeExecutor(() => [{
    id: 'S1', title: '黄金市场观点', source: 'search', sourceUrl: 'https://example.com/gold',
    excerpt: '带日期的市场观点摘要', fetchedAt: new Date().toISOString(),
  }]);
  const deltas: string[] = [];
  const result = await new ResearchLoop(model, executor, () => new Date(2026, 7, 10).getTime()).run(
    '请深入核验下个月黄金是否上涨',
    {
      threadId: 'thread-1', messages: [{ role: 'user', content: '请深入核验下个月黄金是否上涨' }],
      trace: new AgentRunTrace('thread-1'), maxSteps: 1, onDelta: (delta) => deltas.push(delta),
    },
  );

  assert.equal(result.degraded, true);
  assert.match(result.stopReason, /伪工具调用协议/);
  assert.doesNotMatch(result.answer, /<tool|deepseek/i);
  assert.deepEqual(deltas, [result.answer]);
  assert.equal(invalidResearchAnswerReason('有效结论 [S1]', result.evidence), null);
});

test('relative-time research queries use the actual target month', () => {
  const now = new Date(2026, 7, 10).getTime();
  assert.equal(
    normalizeRelativeResearchQuery('请核验下个月黄金走势', '黄金价格2024年预测', now),
    '黄金价格2026年9月预测',
  );
});

test('verification reads a discovered source page before issuing another search', async () => {
  const model = new ScriptedModel([
    { action: 'live_search', query: '黄金走势', reason: '先搜索' },
    { action: 'live_search', query: '黄金走势 补充', reason: '继续搜索摘要' },
    { action: 'finish', reason: '已读取原文' },
  ]);
  const calls: string[] = [];
  const executor = fakeExecutor((name) => {
    calls.push(name);
    if (name === 'live_search') return [{
      id: 'S1', title: '市场报告', source: 'search', sourceUrl: 'https://example.com/gold-report',
      excerpt: '搜索摘要', fetchedAt: new Date().toISOString(),
    }];
    return {
      articles: [{
        ...articleForResearch('https://example.com/gold-report', '这是带日期的市场报告正文。'.repeat(30)),
        content_quality: 'full',
      }],
      failures: [],
    };
  });
  await new ResearchLoop(model, executor).run('请深入核验黄金走势并给出正反证据', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.deepEqual(calls, ['live_search', 'direct_web_read']);
});

test('final research evidence removes duplicate content from different knowledge chunks', async () => {
  const model: ResearchLoopModel = {
    async decideResearchStep() { return { action: 'finish', reason: '已有资料' }; },
    async answerResearch() { return '去重后的回答 [S1][S2]'; },
  };
  const executor = fakeExecutor(() => [
    { chunkId: 'chunk-1', documentId: 'doc-1', title: 'FDE工程师', content: '15-25k，北京，1-3年经验', source: 'job', kind: 'job', score: 1 },
    { chunkId: 'chunk-2', documentId: 'doc-2', title: 'FDE工程师', content: '15-25k，北京，1-3年经验', source: 'job', kind: 'job', score: 0.9 },
    { chunkId: 'chunk-3', documentId: 'doc-3', title: 'FDE前沿部署工程师', content: '20-30k，深圳，3-5年经验', source: 'job', kind: 'job', score: 0.8 },
  ]);
  const result = await new ResearchLoop(model, executor).run('请深入研究全部知识库中关于 FDE工程师 的资料', {
    threadId: 'thread-1', messages: [{ role: 'user', content: '请深入研究全部知识库中关于 FDE工程师 的资料' }],
    trace: new AgentRunTrace('thread-1'),
  });

  assert.equal(result.evidence.length, 2);
  assert.deepEqual(result.evidence.map((item) => item.title), ['FDE工程师', 'FDE前沿部署工程师']);
});

test('search redirect URLs are never treated as readable source pages', () => {
  assert.equal(isSearchRedirectUrl('http://www.baidu.com/link?url=abc'), true);
  assert.equal(isSearchRedirectUrl('https://www.sogou.com/link?url=abc'), true);
  assert.equal(isSearchRedirectUrl('https://example.com/article'), false);
});

test('knowledge retrieval defaults to the current task and only expands on explicit global wording', async () => {
  assert.equal(shouldUseGlobalKnowledgeScope('请深入研究当前任务资料'), false);
  assert.equal(shouldUseGlobalKnowledgeScope('请深入研究全系统所有任务的知识库'), true);
  assert.equal(shouldUseGlobalKnowledgeScope('请深入研究全部知识库中的资料'), true);
  assert.equal(shouldUseGlobalKnowledgeScope('请深入研究所有知识库中的资料'), true);

  const scopes: string[] = [];
  const executor = fakeExecutor((name, input) => {
    if (name !== 'knowledge_query') throw new Error(`unexpected tool ${name}`);
    scopes.push(input.scope);
    return [{
      chunkId: 'chunk-1', documentId: 'doc-1', title: '本地资料', content: '相关内容',
      source: 'local', kind: 'article', score: 1,
    }];
  });
  const decisions = [
    { action: 'knowledge_query', query: '相关资料', reason: '查询本地资料' },
    { action: 'finish', reason: '已有本地证据' },
  ] satisfies ResearchStepDecision[];
  const localResult = await new ResearchLoop(new ScriptedModel(decisions), executor).run('请深入研究当前任务资料', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });
  const globalResult = await new ResearchLoop(new ScriptedModel(decisions), executor).run('请深入研究全系统所有任务的知识库', {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.deepEqual(scopes, ['thread', 'global']);
  assert.equal(localResult.knowledgeScope, 'thread');
  assert.equal(globalResult.knowledgeScope, 'global');
});

test('knowledge and latest web cross-validation always attempts both retrieval paths', async () => {
  const question = '请深入研究全部知识库中关于 FDE工程师 的资料，并和最新网页信息交叉验证';
  assert.equal(requiresKnowledgeRetrieval(question), true);
  assert.equal(requiresWebRetrieval(question), true);
  assert.equal(requiredSourceQuery(question), 'FDE工程师');
  const calls: Array<{ name: string; scope?: string }> = [];
  const executor = fakeExecutor((name, input) => {
    calls.push({ name, scope: input.scope });
    return [];
  });
  const model = new ScriptedModel([
    { action: 'knowledge_query', query: '不应重复', reason: '模型仍想重复查询知识库' },
    { action: 'knowledge_query', query: '不应重复', reason: '模型仍想重复查询知识库' },
  ]);
  const result = await new ResearchLoop(model, executor).run(question, {
    threadId: 'thread-1', messages: [], trace: new AgentRunTrace('thread-1'),
  });

  assert.deepEqual(calls, [
    { name: 'knowledge_query', scope: 'global' },
    { name: 'live_search', scope: undefined },
  ]);
  assert.equal(result.stopReason, '连续两步没有新增证据');
});

function articleForResearch(url: string, description: string) {
  return {
    content_id: url,
    content_url: url,
    title: '测试页面',
    summary: '',
    description,
    creator_name: '',
    site_name: '示例站',
    images: [],
  };
}

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
