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
import { KnowledgeIndex, localEmbedding } from '../src/knowledge/knowledge-index';
import { KNOWLEDGE_PROJECTOR_VERSION, knowledgeProjector } from '../src/knowledge/knowledge-projector';
import { AnalysisService } from '../src/analyzers/registry';
import { exporterRegistry } from '../src/exporters/registry';
import { listProcessorCapabilities } from '../src/processor/capabilities';
import { RagService } from '../src/knowledge/rag-service';
import { profileDataset } from '../src/analyzers/dataset-profiler';
import { EvidenceSelector, decomposeEvidenceQueries, dynamicEvidenceDocumentLimit } from '../src/knowledge/evidence-selector';
import { buildQuickAnalysisCoverage, buildQuickReportBoundary, QuickReportGenerator } from '../src/analyzers/quick-report-generator';

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
    const results = index.search('Workflow Connector', { limit: 5 });
    assert.equal(results[0].documentId, document.documentId);
    assert.match(results[0].content, /Document Engine/);
    assert.equal(results[0].metadata.projectorVersion, KNOWLEDGE_PROJECTOR_VERSION);
    assert.equal(results[0].metadata.platform, 'bing');
    assert.equal(results[0].metadata.assets[0].role, 'thumbnail');
    assert.equal(results[0].metadata.totalChunks, 1);
    assert.equal(typeof results[0].metadata.characterStart, 'number');
    assert.equal(localEmbedding('测试').length, 256);
    assert.deepEqual(localEmbedding('测试'), localEmbedding('测试'));
  } finally {
    db.close();
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

test('Evidence Selector dynamically sizes, deduplicates and prioritizes target document types', () => {
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
  const selector = new EvidenceSelector({ search: () => [results[0], { ...results[0], chunkId: 'duplicate-chunk' }, ...results.slice(1)] } as any);
  const selection = selector.select({
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
  let streamed = '';
  const selection = {
    targetDocumentCount: 22,
    candidateDocumentCount: 40,
    selectedDocumentCount: 2,
    queries: ['薪酬分布', '经验要求'],
    preferredKinds: ['job'],
    byPlatform: { job51: 1, liepin: 1 },
    byKind: { job: 2 },
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
  const generator = new QuickReportGenerator({ select: () => selection } as any, model);
  const result = await generator.generate({
    workflowId: 'workflow-1',
    workflowGoal: 'FDE 岗位市场调研',
    reportName: '岗位调研报告',
    userRequest: '分析薪酬与经验',
    analysisGoals: ['薪酬分布', '经验要求'],
    datasetProfile: { documentCount: 212 } as any,
    onDelta: (delta) => { streamed += delta; },
  });

  assert.match(prompt, /只能使用“全部文档的确定性统计结果”/);
  assert.equal(materials.texts[0].label, '全部文档的确定性统计结果');
  assert.match(materials.texts[0].content, /"documentCount":212/);
  assert.match(streamed, /数据范围说明/);
  assert.match(result.answer, /^> \*\*数据范围说明\*\*/);
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
