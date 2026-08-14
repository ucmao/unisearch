import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { AgentRepository, type ResearchPlan } from '../src/server/services/AgentRepository';
import { AnalyticsRepository } from '../src/database/repository';
import { DocumentEngine } from '../src/document/document-engine';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { normalizePlan } from '../src/server/services/AgentService';
import { LiveSearchService } from '../src/server/services/LiveSearchService';
import { normalizePublicWebUrl, WebReaderService } from '../src/services/web-reader-service';
import { extractTokens, validateExpandedQuery } from '../src/analyzers/search-relevance-service';

function enrichmentPlan(overrides: Partial<ResearchPlan> = {}): ResearchPlan {
  return {
    skillId: 'web-search-research',
    goal: '搜索 Agent 最新进展并读取正文',
    platforms: ['baidu', 'bing'],
    keywords: ['Agent 最新进展'],
    capability: 'keyword_search',
    targets: [],
    connectorOptions: {},
    contentEnrichment: {
      mode: 'auto', maxReadItems: 8, maxPerDomain: 2, concurrency: 3, timeoutMsPerUrl: 15_000,
    },
    collectionDepth: 'quick',
    loginType: 'none',
    headless: true,
    analysis: [],
    outputs: ['markdown'],
    ...overrides,
  };
}

function memoryRepository() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return { db, repository: new AgentRepository(() => db) };
}

test('web search plans compile into search, selection and dependent reader stages', () => {
  const { db, repository } = memoryRepository();
  try {
    const thread = repository.createThread('网页研究');
    const workflow = repository.createPlan(thread.thread_id, enrichmentPlan());
    const steps = db.prepare(`
      SELECT step_key, kind, depends_on_json, input_json FROM workflow_steps
      WHERE workflow_id=? ORDER BY rowid
    `).all(workflow.plan_id) as any[];
    assert.deepEqual(steps.slice(0, 2).map((step) => step.step_key), ['collect:baidu', 'collect:bing']);
    const initialEvaluation = steps.find((step) => step.step_key === 'evaluate-search-initial');
    assert.deepEqual(JSON.parse(initialEvaluation.depends_on_json), ['collect:baidu', 'collect:bing']);
    assert.ok(steps.some((step) => step.step_key === 'rewrite:baidu'));
    assert.ok(steps.some((step) => step.step_key === 'rewrite:bing'));
    const selector = steps.find((step) => step.step_key === 'select-search-urls');
    assert.equal(selector.kind, 'processor');
    assert.deepEqual(JSON.parse(selector.depends_on_json), ['evaluate-search-rewrite']);
    const reader = steps.find((step) => step.step_key === 'read:web_reader');
    assert.deepEqual(JSON.parse(reader.depends_on_json), ['select-search-urls']);
    assert.equal(JSON.parse(reader.input_json).capability, 'content_detail');
    assert.equal(JSON.parse(reader.input_json).targetsFromStep, 'select-search-urls');
  } finally {
    db.close();
  }
});

test('snippet mode does not create selection or reader stages', () => {
  const { db, repository } = memoryRepository();
  try {
    const thread = repository.createThread('摘要搜索');
    const workflow = repository.createPlan(thread.thread_id, enrichmentPlan({
      contentEnrichment: {
        mode: 'snippet', maxReadItems: 0, maxPerDomain: 2, concurrency: 3, timeoutMsPerUrl: 15_000,
      },
    }));
    const keys = (db.prepare('SELECT step_key FROM workflow_steps WHERE workflow_id=?').all(workflow.plan_id) as any[])
      .map((row) => row.step_key);
    assert.equal(keys.includes('select-search-urls'), false);
    assert.equal(keys.includes('read:web_reader'), false);
    assert.equal(keys.includes('evaluate-search-initial'), true);
    assert.equal(keys.includes('rewrite:baidu'), true);
  } finally {
    db.close();
  }
});

test('plan normalization defaults web search to auto reading and honors summary-only requests', () => {
  const automatic = normalizePlan(
    { platforms: ['baidu'], keywords: ['Agent'] },
    '在百度搜索 Agent',
  );
  assert.equal(automatic.contentEnrichment.mode, 'auto');
  assert.equal(automatic.contentEnrichment.maxReadItems, 8);
  assert.equal(automatic.queryExpansion?.mode, 'fallback');

  const snippets = normalizePlan(
    { platforms: ['baidu'], keywords: ['Agent'] },
    '在百度搜索 Agent，只看搜索摘要，不要正文',
  );
  assert.equal(snippets.contentEnrichment.mode, 'snippet');
  assert.equal(snippets.contentEnrichment.maxReadItems, 0);

  const strictPlan = normalizePlan(
    { platforms: ['baidu'], keywords: ['AI训练师'] },
    '在百度搜索 AI训练师，严格按照指定词精确搜索，不要扩展',
  );
  assert.equal(strictPlan.queryExpansion?.mode, 'strict');

  const broadPlan = normalizePlan(
    { platforms: ['baidu'], keywords: ['AI训练师'] },
    '在百度广泛探索 AI训练师 行业发展与相关概念',
  );
  assert.equal(broadPlan.queryExpansion?.mode, 'broad');
});

test('strict mode web search plans do not create evaluation or rewrite stages', () => {
  const { db, repository } = memoryRepository();
  try {
    const thread = repository.createThread('严格搜索');
    const workflow = repository.createPlan(thread.thread_id, enrichmentPlan({
      queryExpansion: { mode: 'strict', maxQueriesPerKeyword: 2, preserveOriginal: true },
    }));
    const keys = (db.prepare('SELECT step_key FROM workflow_steps WHERE workflow_id=?').all(workflow.plan_id) as any[])
      .map((row) => row.step_key);
    assert.equal(keys.includes('evaluate-search-initial'), false);
    assert.equal(keys.includes('rewrite:baidu'), false);
    assert.equal(keys.includes('rewrite:bing'), false);
    assert.equal(keys.includes('evaluate-search-rewrite'), false);
    assert.equal(keys.includes('select-search-urls'), true);
  } finally {
    db.close();
  }
});

test('search discoveries survive full-text enrichment and drive URL selection', async () => {
  const { db, repository } = memoryRepository();
  try {
    const analytics = new AnalyticsRepository(() => db);
    const documents = new DocumentEngine(() => db);
    const thread = repository.createThread('发现来源');
    const workflow = repository.createPlan(thread.thread_id, enrichmentPlan());
    const runId = analytics.createRun({
      platform: 'baidu', keywords: 'Agent', crawler_type: 'search',
      thread_id: thread.thread_id, workflow_id: workflow.plan_id,
    });
    await documents.ingest(buildRawItem('emitSearchEngineResult', {
      search_engine: 'baidu',
      title: 'Agent 报告',
      real_url: 'https://example.com/report?utm_source=baidu',
      snippet: '搜索摘要',
      publisher: '示例站',
      search_rank: 2,
      source_keyword: 'Agent',
    }), runId);

    const selected = repository.selectSearchUrls(workflow.plan_id, { maxReadItems: 8, maxPerDomain: 2 });
    assert.deepEqual(selected.map((item) => item.url), ['https://example.com/report']);

    const readerRunId = analytics.createRun({
      platform: 'web_reader', keywords: '', crawler_type: 'detail',
      thread_id: thread.thread_id, workflow_id: workflow.plan_id,
    });
    const enriched = await documents.ingest(buildRawItem('emitWebReaderResult', {
      content_id: 'https://example.com/report',
      content_url: 'https://example.com/report',
      title: 'Agent 完整报告',
      summary: '正文摘要',
      description: '这是读取后的完整正文内容。',
      creator_name: '示例作者',
      site_name: '示例站',
      images: [],
    }), readerRunId);
    assert.equal(enriched.platform, 'web_reader');
    assert.equal(enriched.markdown, '这是读取后的完整正文内容。');
    assert.deepEqual((enriched.attributes.discoveredBy as any[]).map((item) => item.provider), ['baidu']);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM search_discoveries').get() as any).count, 1);
  } finally {
    db.close();
  }
});

test('web reader blocks private targets and parses bounded HTML responses', async () => {
  await assert.rejects(() => normalizePublicWebUrl('http://127.0.0.1/admin'), /不允许访问本机或私有网络/);
  const service = new WebReaderService({
    async get() {
      return {
        data: '<html><head><title>测试文章</title><meta name="author" content="作者甲"></head><body><article><p>这是一段足够长的正文内容，用来验证通用网页阅读服务可以正常提取主要段落。</p></article></body></html>',
        headers: { 'content-type': 'text/html; charset=utf-8' },
        request: { res: { responseUrl: 'https://93.184.216.34/article' } },
      };
    },
  });
  const article = await service.read('https://93.184.216.34/article');
  assert.equal(article.title, '测试文章');
  assert.match(article.description, /通用网页阅读服务/);
});

test('live search can enrich top evidence transiently without persistence', async () => {
  const bingHtml = '<ol id="b_results"><li class="b_algo"><h2><a href="https://example.com/a">结果 A</a></h2><div class="b_caption"><p>摘要 A</p></div></li></ol>';
  const client = { async get() { return { data: bingHtml }; } };
  let reads = 0;
  const reader = {
    async read(url: string) {
      reads++;
      return {
        content_id: url, content_url: url, title: '正文标题', summary: '正文摘要',
        description: '临时读取到的完整正文', creator_name: '正文作者', site_name: '示例站', images: [],
      };
    },
  };
  const evidence = await new LiveSearchService(client, reader).search('测试', {
    limit: 1, readMode: 'auto', maxReadItems: 1,
  });
  assert.equal(reads, 1);
  assert.equal(evidence[0].title, '正文标题');
  assert.equal(evidence[0].excerpt, '临时读取到的完整正文');
});

test('query expansion guardrails reject invalid queries and system keywords', () => {
  // Prohibited system keywords / platform terms
  assert.equal(validateExpandedQuery('AI训练师 多引 引擎', 'AI训练师'), false);
  assert.equal(validateExpandedQuery('百度搜索 数据标注', '数据标注'), false);
  assert.equal(validateExpandedQuery('360采集 爬虫分析', '数据标注'), false);
  assert.equal(validateExpandedQuery('平台 数据标注 抓取', '数据标注'), false);

  // Duplicates or empty
  assert.equal(validateExpandedQuery('AI训练师', 'AI训练师'), false);
  assert.equal(validateExpandedQuery('', 'AI训练师'), false);
  assert.equal(validateExpandedQuery('   ', 'AI训练师'), false);
  assert.equal(validateExpandedQuery('？！？', 'AI训练师'), false);

  // Valid natural semantic expansion
  assert.equal(validateExpandedQuery('人工智能训练师 岗位职责 数据标注', 'AI训练师'), true);
  assert.equal(validateExpandedQuery('数据标注行业前景与职业发展', '数据标注'), true);
});

test('tokenization extracts clean words without 2-gram slicing fragments', () => {
  const goalTokens = extractTokens('多引擎搜索AIGC数据标注AI训练师关联分析');
  assert.equal(goalTokens.includes('多引'), false);
  assert.equal(goalTokens.includes('品分'), false);
  assert.ok(goalTokens.includes('aigc'));
  assert.ok(goalTokens.includes('数据') || goalTokens.includes('数据标注'));
  assert.ok(goalTokens.includes('训练') || goalTokens.includes('训练师'));
});

