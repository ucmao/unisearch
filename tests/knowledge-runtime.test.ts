import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { DocumentEngine } from '../src/document/document-engine';
import { KnowledgeIndex } from '../src/knowledge/knowledge-index';
import { KNOWLEDGE_PROJECTOR_VERSION, knowledgeProjector } from '../src/knowledge/knowledge-projector';
import { AnalysisService } from '../src/analyzers/registry';
import { exporterRegistry } from '../src/exporters/registry';
import { listProcessorCapabilities } from '../src/processor/capabilities';
import { RagService } from '../src/knowledge/rag-service';
import { profileDataset } from '../src/analyzers/dataset-profiler';
import { EvidenceSelector, decomposeEvidenceQueries, dynamicEvidenceDocumentLimit } from '../src/knowledge/evidence-selector';
import { buildQuickAnalysisCoverage, buildQuickReportBoundary, QuickReportGenerator } from '../src/analyzers/quick-report-generator';
import { ReportArtifactService } from '../src/analyzers/report-artifact-service';
import { RetrievalService } from '../src/knowledge/retrieval-service';

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

async function seed(db: Database.Database) {
  const engine = new DocumentEngine(() => db);
  return engine.ingest(buildRawItem('emitSearchEngineResult', {
    engine: 'bing',
    content_id: 'rag-1',
    title: 'UniSearch 架构说明',
    snippet: 'UniSearch 使用 Workflow 调度 Connector 和 Processor，并通过 Document Engine 统一保存资料。',
    real_url: 'https://example.com/unisearch',
    images: ['https://example.com/unisearch-thumbnail.jpg'],
  }));
}

test('knowledge index chunks Documents and supports hybrid retrieval', async () => {
  const db = database();
  try {
    const document = await seed(db);
    const index = new KnowledgeIndex(() => db);
    assert.deepEqual(index.rebuild(), { documents: 1, chunks: 1 });
    const results = await index.search('Workflow Connector', { limit: 5 });
    assert.equal(results[0].documentId, document.documentId);
    assert.match(results[0].content, /Document Engine/);
    assert.equal(results[0].metadata.projectorVersion, KNOWLEDGE_PROJECTOR_VERSION);
    assert.equal(results[0].metadata.platform, 'bing');
    assert.equal(results[0].metadata.assets[0].role, 'thumbnail');
    assert.equal(results[0].metadata.totalChunks, 1);
    assert.equal(typeof results[0].metadata.characterStart, 'number');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM document_chunk_embeddings').get() as any).count, 0);
  } finally {
    db.close();
  }
});

test('remote embeddings are cached as binary vectors and optional reranking is applied', async () => {
  const db = database();
  try {
    const relevant = await seed(db);
    await new DocumentEngine(() => db).ingest(buildRawItem('emitSearchEngineResult', {
      engine: 'bing',
      content_id: 'rag-2',
      title: '汽车保养记录',
      snippet: '定期更换机油并检查轮胎气压。',
      real_url: 'https://example.com/car',
    }));
    let reranked = false;
    const retrieval = {
      getProfile: () => ({
        provider: 'custom',
        baseUrl: 'https://embedding.example/v1',
        apiKeyConfigured: true,
        embeddingModel: 'semantic-test',
        rerankerModel: 'reranker-test',
        timeoutMs: 10000,
      }),
      embed: async (texts: string[]) => texts.map((text) => /Workflow|Connector|安排任务/.test(text) ? [1, 0] : [0, 1]),
      rerank: async (_query: string, documents: string[], topN: number) => {
        reranked = true;
        return documents
          .map((document, index) => ({ index, score: /Workflow/.test(document) ? 0.99 : 0.1 }))
          .sort((left, right) => right.score - left.score)
          .slice(0, topN);
      },
    } as any;
    const index = new KnowledgeIndex(() => db, retrieval);
    index.rebuild();
    const result = await index.searchDetailed('如何安排任务', { limit: 2 });
    assert.equal(result.mode, 'hybrid_reranked');
    assert.equal(result.items[0].documentId, relevant.documentId);
    assert.equal(reranked, true);
    const stored = db.prepare('SELECT dimensions, vector_blob FROM document_chunk_embeddings LIMIT 1').get() as any;
    assert.equal(stored.dimensions, 2);
    assert.ok(Buffer.isBuffer(stored.vector_blob));
  } finally {
    db.close();
  }
});

test('retrieval profile supports unified single-provider configuration and optional reranker without switches', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'unisearch-retrieval-'));
  const configPath = path.join(directory, 'retrieval-profile.json');
  try {
    const service = new RetrievalService(configPath);
    const initial = service.getProfile(false);
    assert.equal(initial.apiKeyConfigured, false);
    assert.equal(initial.embeddingModel, 'BAAI/bge-m3');
    assert.equal(initial.rerankerModel, 'BAAI/bge-reranker-v2-m3');

    const saved = service.saveProfile({
      provider: 'custom',
      baseUrl: 'https://vectors.example/v1/',
      embeddingModel: 'embedding-v1',
      apiKey: 'retrieval-secret',
      rerankerModel: 'reranker-v1',
    });
    assert.equal(saved.baseUrl, 'https://vectors.example/v1');
    assert.equal(saved.apiKeyConfigured, true);
    assert.equal(saved.embeddingModel, 'embedding-v1');
    assert.equal(saved.rerankerModel, 'reranker-v1');
    assert.equal(service.getProfile(true).apiKey, 'retrieval-secret');

    // 清除 Key
    assert.equal(service.saveProfile({ clearApiKey: true }).apiKeyConfigured, false);
    assert.equal((JSON.parse(readFileSync(configPath, 'utf8')) as any).version, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Analyzer persists a deterministic profile from all canonical Documents', async () => {
  const db = database();
  try {
    await seed(db);
    const report = await new AnalysisService(() => db).run('dataset.profile');
    assert.match(report.content, /共对 1 个去重文档执行确定性统计/);
    assert.equal(report.metadata.datasetProfile.documentCount, 1);
    assert.equal(report.metadata.datasetProfile.distributions.platform.values[0].value, 'bing');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM analysis_reports').get() as any).count, 1);
  } finally {
    db.close();
  }
});

test('Dataset Profiler covers generic dimensions, dynamic fields, metrics and quality', () => {
  const first = mapRawItemToCanonicalDocument(buildRawItem('emitXhsNote', {
    note_id: 'profile-note-1',
    note_url: 'https://example.com/note-1',
    title: '第一篇',
    desc: '正文一',
    nickname: '作者甲',
    source_keyword: 'AI Agent',
    liked_count: 100,
    comment_count: 5,
    time: '2026-07-01T00:00:00.000Z',
  }));
  const second = mapRawItemToCanonicalDocument(buildRawItem('emitXhsNote', {
    note_id: 'profile-note-2',
    title: '第二篇',
    desc: '正文二',
    nickname: '作者乙',
    source_keyword: 'AI Agent',
    liked_count: 300,
    time: '2026-07-02T00:00:00.000Z',
  }));
  const profile = profileDataset([first, second]);

  assert.equal(profile.documentCount, 2);
  assert.deepEqual(profile.distributions.platform.values, [{ value: 'xhs', count: 2, percentage: 1 }]);
  assert.equal(profile.distributions.keyword.values[0].value, 'AI Agent');
  assert.equal(profile.fieldCoverage.sourceUrl.presentCount, 1);
  assert.equal(profile.fieldCoverage.sourceUrl.coverageRate, 0.5);
  assert.deepEqual(profile.metrics.likes.numeric, {
    validCount: 2, min: 100, max: 300, mean: 200, median: 200, p25: 150, p75: 250,
  });
  assert.equal(profile.metrics.comments.presentCount, 1);
  assert.equal(profile.metrics.comments.missingCount, 1);
  assert.equal(profile.quality.missingSourceUrlCount, 1);
});

test('RAG returns ranked citations and an honest fallback without a model key', async () => {
  const db = database();
  try {
    await seed(db);
    const index = new KnowledgeIndex(() => db);
    index.rebuild();
    const model = {
      getProfile: () => ({ apiKeyConfigured: false }),
      converse: async () => '',
    } as any;
    const result = await new RagService(index, model).answer('UniSearch 如何调度能力？');
    assert.ok(result.sources.length > 0);
    assert.equal(result.sources[0].id, 'S1');
    assert.equal(result.sources[0].kind, 'search_result');
    assert.ok(result.sources[0].chunkId);
    assert.match(result.answer, /\[S1\]/);
  } finally {
    db.close();
  }
});

test('Evidence Selector dynamically sizes, deduplicates and prioritizes target document types', async () => {
  assert.equal(dynamicEvidenceDocumentLimit(0), 0);
  assert.equal(dynamicEvidenceDocumentLimit(8), 8);
  assert.equal(dynamicEvidenceDocumentLimit(212), 22);
  assert.equal(dynamicEvidenceDocumentLimit(10_000), 30);
  assert.deepEqual(decomposeEvidenceQueries({
    workflowGoal: 'FDE 岗位市场调研',
    userRequest: '分析这些结果',
    analysisGoals: ['薪酬分布', '经验要求'],
  }), ['薪酬分布', '经验要求', 'FDE 岗位市场调研']);

  const results = Array.from({ length: 30 }, (_, index) => ({
    chunkId: `chunk-${index}`,
    documentId: `doc-${index}`,
    title: `资料 ${index}`,
    content: `资料正文 ${index}`,
    source: index < 8 ? 'job51' : index < 15 ? 'liepin' : index < 23 ? 'xhs' : 'weibo',
    kind: index < 15 ? 'job' : 'post',
    subject: { type: index < 15 ? 'company' : 'creator' },
    citations: [],
    metadata: {},
    score: 1 - index / 100,
  })) as any[];
  const selector = new EvidenceSelector({
    searchDetailed: async () => ({
      items: [results[0], { ...results[0], chunkId: 'duplicate-chunk' }, ...results.slice(1)],
      mode: 'lexical',
      warning: '当前未配置语义检索 API',
    }),
  } as any);
  const selection = await selector.select({
    workflowId: 'workflow-1',
    workflowGoal: 'FDE 岗位市场调研',
    userRequest: '分析薪酬和岗位要求',
    analysisGoals: ['薪酬分布', '经验要求'],
    datasetProfile: { documentCount: 212 } as any,
  });

  assert.equal(selection.targetDocumentCount, 22);
  assert.equal(selection.selectedDocumentCount, 22);
  assert.equal(new Set(selection.evidence.map((item) => item.documentId)).size, 22);
  assert.equal(selection.evidence.filter((item) => item.kind === 'job').length, 15);
  assert.ok(selection.evidence.some((item) => item.selectionReason === 'platform_representative'));
  assert.ok(selection.evidence.every((item) => item.matchedQueries.length === selection.queries.length));
  assert.equal(selection.retrievalMode, 'lexical');
  assert.deepEqual(selection.retrievalWarnings, ['当前未配置语义检索 API']);
});

test('quick analysis coverage distinguishes full statistics from representative evidence', () => {
  const evidence = [
    { id: 'S1', documentId: 'doc-1', chunkId: 'chunk-1' },
    { id: 'S2', documentId: 'doc-2', chunkId: 'chunk-2' },
  ] as any;
  const coverage = buildQuickAnalysisCoverage({ documentCount: 212 } as any, evidence, '结论一 [S1]，结论二 [S2]。');

  assert.deepEqual(coverage, {
    mode: 'quick',
    collectedDocumentCount: 212,
    statisticallyAnalyzedDocumentCount: 212,
    qualitativelyAnalyzedDocumentCount: 2,
    evidenceDocumentCount: 2,
    evidenceChunkCount: 2,
    citedDocumentCount: 2,
    fullDatasetStatistics: true,
    partial: false,
  });
  assert.match(buildQuickReportBoundary(coverage), /已入库 \*\*212\*\* 个去重文档/);
  assert.match(buildQuickReportBoundary(coverage), /分层选取的 \*\*2\*\* 个独立文档/);
  assert.match(buildQuickReportBoundary(coverage), /全部参与确定性统计/);
});

test('Quick Report Generator separates selection, generation and program-owned report assembly', async () => {
  let prompt = '';
  let materials: any;
  const selection = {
    targetDocumentCount: 22,
    candidateDocumentCount: 40,
    selectedDocumentCount: 2,
    queries: ['薪酬分布', '经验要求'],
    preferredKinds: ['job'],
    byPlatform: { job51: 1, liepin: 1 },
    byKind: { job: 2 },
    retrievalMode: 'hybrid',
    retrievalWarnings: [],
    evidence: [
      {
        id: 'S1', chunkId: 'chunk-1', documentId: 'doc-1', title: '岗位一', content: '薪资 20-30K',
        source: 'job51', kind: 'job', subject: { type: 'company' }, score: 1,
        matchedQueries: ['薪酬分布'], selectionReason: 'preferred_type',
      },
      {
        id: 'S2', chunkId: 'chunk-2', documentId: 'doc-2', title: '岗位二', content: '要求 3-5 年经验',
        source: 'liepin', kind: 'job', subject: { type: 'company' }, score: 0.9,
        matchedQueries: ['经验要求'], selectionReason: 'platform_representative',
      },
    ],
  } as any;
  const model = {
    getProfile: () => ({ apiKeyConfigured: true }),
    converse: async (messages: Array<{ content: string }>, options: any) => {
      prompt = messages[0].content;
      materials = options.materials;
      return '全量统计显示共有 212 条；代表性岗位显示相关要求 [S1][S2]。';
    },
  } as any;
  const generator = new QuickReportGenerator({ select: async () => selection } as any, model);
  const result = await generator.generate({
    workflowId: 'workflow-1',
    workflowGoal: 'FDE 岗位市场调研',
    reportName: '岗位调研报告',
    userRequest: '分析薪酬与经验',
    analysisGoals: ['薪酬分布', '经验要求'],
    datasetProfile: { documentCount: 212 } as any,
  });

  assert.match(prompt, /只能使用“全部文档的确定性统计结果”/);
  assert.match(prompt, /互动量只能表示传播或参与程度/);
  assert.match(prompt, /不得声称某主题正在增长/);
  assert.match(prompt, /单个创作者、广告或投诉内容中的说法必须明确归因/);
  assert.equal(materials.texts[0].label, '全部文档的确定性统计结果');
  assert.match(materials.texts[0].content, /"documentCount":212/);
  assert.match(result.answer, /全量统计显示共有 212 条；代表性岗位显示相关要求 \[S1\]\[S2\]。/);
  assert.equal(result.coverage.statisticallyAnalyzedDocumentCount, 212);
  assert.equal(result.coverage.qualitativelyAnalyzedDocumentCount, 2);
  assert.equal(result.coverage.citedDocumentCount, 2);
  assert.equal(result.evidenceSelection.candidateDocumentCount, 40);
  assert.equal(result.sources[0].selectionReason, 'preferred_type');
});

test('All registered knowledge exporters create portable artifacts', async () => {
  const db = database();
  const directory = mkdtempSync(path.join(os.tmpdir(), 'unisearch-exporters-'));
  try {
    const document = await seed(db);
    const exporters = exporterRegistry.list().map((e) => e.id);
    const outputPaths = new Map<string, string>();
    assert.equal(exporters.length >= 8, true);
    for (const id of exporters) {
      const target = path.join(directory, id);
      const fs = await import('node:fs');
      fs.mkdirSync(target, { recursive: true });
      const result = await exporterRegistry.get(id).export([document], {
        outputDirectory: target,
        now: () => new Date('2026-07-24T00:00:00.000Z'),
      });
      assert.equal(result.itemCount, 1);
      outputPaths.set(id, result.outputPath);
    }
    assert.match(readFileSync(outputPaths.get('markdown')!, 'utf8'), /document_id:/);
    assert.match(readFileSync(path.join(outputPaths.get('ima')!, 'manifest.json'), 'utf8'), /sources/);
    assert.match(readFileSync(path.join(outputPaths.get('notion')!, 'database.csv'), 'utf8'), /DocumentID/);
    const dify = JSON.parse(readFileSync(path.join(outputPaths.get('dify')!, 'chunks.jsonl'), 'utf8'));
    assert.equal(dify.metadata.projectorVersion, KNOWLEDGE_PROJECTOR_VERSION);
    assert.equal(dify.metadata.documentId, document.documentId);
    assert.equal(dify.metadata.ordinal, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Knowledge Projector indexes final answers but excludes model reasoning traces', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitQwenResult', {
    content_id: 'qa-projector-1',
    question: '统一知识库如何工作？',
    answer: 'Canonical Document 先投影，再分块进入检索。',
    reasoning_content: '不应进入知识库的内部推理草稿',
    citations: [{ title: '知识库设计', url: 'https://example.com/knowledge' }],
  }));
  const projection = knowledgeProjector.project(document);
  assert.match(projection.content, /Canonical Document/);
  assert.doesNotMatch(projection.content, /内部推理草稿/);
  assert.equal('reasoningContent' in projection.metadata.attributes, false);
  assert.equal(projection.metadata.citations[0].url, 'https://example.com/knowledge');
});

test('Processor capability catalog reports external binary availability honestly', () => {
  const capabilities = listProcessorCapabilities();
  for (const id of ['asset.download', 'pandoc.convert', 'ffmpeg.extract_audio', 'whisper.transcribe']) {
    const capability = capabilities.find((item) => item.id === id);
    assert.ok(capability);
    assert.equal(typeof capability.available, 'boolean');
  }
});

test('Chinese FTS5 lexical search matches local sub-phrases accurately', async () => {
  const db = database();
  try {
    const engine = new DocumentEngine(() => db);
    await engine.ingest(buildRawItem('emitXhsNote', {
      note_id: 'xhs-refund-1',
      title: '购物指南',
      desc: '小红书售后退货流程体验很好，商家处理非常迅速。',
      nickname: '评测家',
      source_keyword: '售后体验',
    }));
    const index = new KnowledgeIndex(() => db);
    index.rebuild();

    // Query with Chinese subphrase "退货流程"
    const results = await index.search('退货流程');
    assert.ok(results.length > 0);
    assert.match(results[0].content, /退货流程/);
    assert.equal(results[0].source, 'xhs');
    assert.equal(results[0].keyword, '售后体验');

    // Query with single word "售后"
    const shResults = await index.search('售后');
    assert.ok(shResults.length > 0);
    assert.match(shResults[0].content, /售后/);
  } finally {
    db.close();
  }
});

test('Knowledge Projector preserves Markdown headings and tracks breadcrumbs across multi-level chunks', () => {
  const markdown = [
    '## 概述',
    '这里是引言段落。介绍整体背景与目标。',
    '',
    '## 售后保障',
    '这里是售后保障的第一部分内容，说明基本服务范围。',
    '',
    '### 退款规则',
    '在七天无理由退货期限内，用户可直接申请全额退款。退款原路返回。',
    '',
    '### 换货流程',
    '如果商品存在非人为损坏，可申请免费换货服务。',
  ].join('\n');

  const base = mapRawItemToCanonicalDocument(buildRawItem('emitXhsNote', {
    note_id: 'note-breadcrumb-1',
    title: '主题指南',
    desc: '关于售后服务的完整指南说明。',
    nickname: '作者',
    source_keyword: '售后',
  }));
  const document = { ...base, markdown };

  const chunks = knowledgeProjector.chunks(document, 150, 30);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.retrievalText.includes('[平台: xhs'));
    assert.ok(chunk.retrievalText.includes('主题指南'));
    assert.ok(Array.isArray(chunk.metadata.breadcrumbs));
  }
  // Check that at least one chunk captured breadcrumbs under 售后保障 / 退款规则
  const refundChunk = chunks.find((c) => c.content.includes('退款原路返回'));
  assert.ok(refundChunk);
  assert.ok(refundChunk.metadata.breadcrumbs?.includes('售后保障') || refundChunk.metadata.breadcrumbs?.includes('退款规则'));
});

test('RAG service delivers full chunk content to LLM materials without 500-char truncation', async () => {
  const db = database();
  try {
    const engine = new DocumentEngine(() => db);
    const longContent = '关键线索开头：' + '详细描述文字。'.repeat(60) + '关键事实结尾：最终验证成功。';
    await engine.ingest(buildRawItem('emitSearchEngineResult', {
      engine: 'bing',
      content_id: 'long-doc-1',
      title: '完整长文档',
      snippet: longContent,
      real_url: 'https://example.com/long-doc',
    }));

    const index = new KnowledgeIndex(() => db);
    index.rebuild();

    let capturedMaterials: any = null;
    const mockModel = {
      getProfile: () => ({ apiKeyConfigured: true }),
      converse: async (_messages: any, options: any) => {
        capturedMaterials = options?.materials;
        return '根据资料回答完毕 [S1]';
      },
    } as any;

    const rag = new RagService(index, mockModel);
    const answer = await rag.answer('完整长文档的关键事实');

    assert.ok(answer.sources.length > 0);
    assert.ok(capturedMaterials);
    assert.ok(capturedMaterials.texts.length > 0);
    // The material content sent to LLM should include the text after char 500
    assert.match(capturedMaterials.texts[0].content, /关键事实结尾：最终验证成功/);
  } finally {
    db.close();
  }
});

test('KnowledgeIndex getAdjacentChunks retrieves neighboring chunks by ordinal', async () => {
  const db = database();
  try {
    const engine = new DocumentEngine(() => db);
    const longSections = Array.from({ length: 5 }, (_, i) => `## 第 ${i + 1} 节\n\n` + `这是第 ${i + 1} 节的内容说明。`.repeat(25)).join('\n\n');
    const document = await engine.ingest(buildRawItem('emitSearchEngineResult', {
      engine: 'bing',
      content_id: 'multi-chunk-doc',
      title: '多段长文',
      snippet: longSections,
      real_url: 'https://example.com/multi',
    }));

    const index = new KnowledgeIndex(() => db);
    index.rebuild();

    const chunks = (db.prepare('SELECT chunk_id, ordinal FROM document_chunks WHERE document_id=? ORDER BY ordinal').all(document.documentId) as Array<{ chunk_id: string; ordinal: number }>);
    assert.ok(chunks.length >= 3);

    const middleChunk = chunks[1];
    const neighbors = index.getAdjacentChunks(middleChunk.chunk_id, 1);
    assert.ok(neighbors.length >= 2);
    assert.ok(neighbors.some((n) => n.metadata.ordinal === middleChunk.ordinal - 1));
    assert.ok(neighbors.some((n) => n.metadata.ordinal === middleChunk.ordinal));
    assert.ok(neighbors.some((n) => n.metadata.ordinal === middleChunk.ordinal + 1));
  } finally {
    db.close();
  }
});

test('Report Artifact upgrade is strictly bounded by subtask count of the main thread', async () => {
  const db = database();
  try {
    const threadId = 'thread-version-test';
    const subtaskId1 = 'subtask-1';
    const subtaskId2 = 'subtask-2';
    const engine = new DocumentEngine(() => db);

    // 1. 建立主任务和第 1 轮子任务
    db.prepare("INSERT INTO agent_threads (thread_id, title, created_at, updated_at) VALUES (?, '天气调研', datetime('now'), datetime('now'))").run(threadId);
    db.prepare("INSERT INTO workflow_runs (workflow_id, thread_id, skill_id, skill_version, goal, created_at, updated_at) VALUES (?, ?, 'test.skill', '1.0', '天气调研', datetime('now'), datetime('now'))").run(subtaskId1, threadId);
    db.prepare("INSERT INTO crawl_runs (run_id, thread_id, workflow_id, platform, status, started_at) VALUES ('run-1', ?, ?, 'baidu', 'completed', datetime('now'))").run(threadId, subtaskId1);
    
    // 写入第 1 轮采集的文档
    const doc1 = await engine.ingest(buildRawItem('emitSearchEngineResult', {
      engine: 'baidu',
      content_id: 'w1',
      title: '福州今日天气',
      snippet: '福州今日晴天，气温适宜',
      real_url: 'https://example.com/w1',
    }), 'run-1');

    db.prepare("INSERT INTO analysis_reports (report_id, thread_id, workflow_id, analyzer_id, analyzer_version, title, content, created_at) VALUES ('analysis-1', ?, ?, 'quick.report', '1.0', '福州天气分析报告', '福州今日晴朗', datetime('now'))").run(threadId, subtaskId1);
    db.prepare("INSERT INTO graph_snapshots (graph_id, scope_type, scope_id, created_at) VALUES ('graph-1', 'thread', ?, datetime('now'))").run(threadId);

    const service = new ReportArtifactService(() => db, {
      latest: () => ({ id: 'graph-1' } as any),
      rebuild: () => ({ id: 'graph-1' } as any),
    } as any);

    // 生成 V1 报告
    const r1 = service.create({
      reportId: 'analysis-1',
      threadId,
      workflowId: subtaskId1,
      title: '福州天气分析报告',
      content: '福州今日晴朗 [S1]',
      sources: [{ documentId: doc1.documentId, id: 'S1' }],
    });

    assert.equal(r1.versionNumber, 1);
    assert.equal(r1.subtaskCount, 1);
    assert.equal(r1.canUpgrade, false);
    assert.equal(r1.hasNewData, false);

    // 只有一个子任务时，尝试升级应该被抛错拦截
    await assert.rejects(
      async () => service.refresh(r1.artifactId),
      /当前主任务仅完成 1 轮子任务采集，研报已是最高对应版本/
    );

    // 2. 主任务产生第 2 轮子任务采集
    db.prepare("INSERT INTO workflow_runs (workflow_id, thread_id, skill_id, skill_version, goal, created_at, updated_at) VALUES (?, ?, 'test.skill', '1.0', '补充采集', datetime('now'), datetime('now'))").run(subtaskId2, threadId);
    db.prepare("INSERT INTO crawl_runs (run_id, thread_id, workflow_id, platform, status, started_at) VALUES ('run-2', ?, ?, 'sogou', 'completed', datetime('now'))").run(threadId, subtaskId2);
    await engine.ingest(buildRawItem('emitSearchEngineResult', {
      engine: 'sogou',
      content_id: 'w2',
      title: '福州明日天气',
      snippet: '福州明日多云转阴',
      real_url: 'https://example.com/w2',
    }), 'run-2');

    // 重新获取 V1 报告状态
    const r1Updated = service.get(r1.artifactId);
    assert.equal(r1Updated.subtaskCount, 2);
    assert.equal(r1Updated.canUpgrade, true);
    assert.equal(r1Updated.hasNewData, true);

    // 升级生成 V2 研报
    const r2 = await service.refresh(r1.artifactId);
    assert.equal(r2.versionNumber, 2);
    assert.equal(r2.subtaskCount, 2);
    assert.equal(r2.coveredSubtaskCount, 2);
    assert.equal(r2.canUpgrade, false);
    assert.equal(r2.hasNewData, false);

    // 升级到最新后，再次尝试升级应该被拦截（无需重复点击）
    await assert.rejects(
      async () => service.refresh(r2.artifactId),
      /当前主任务仅完成 2 轮子任务采集，研报已是最高对应版本/
    );
  } finally {
    db.close();
  }
});


