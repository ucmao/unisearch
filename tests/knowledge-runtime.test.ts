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

test('Analyzer persists an extractive report from canonical Documents', async () => {
  const db = database();
  try {
    await seed(db);
    const report = await new AnalysisService(() => db).run('extractive.summary');
    assert.match(report.content, /共分析 1 篇资料/);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM analysis_reports').get() as any).count, 1);
  } finally {
    db.close();
  }
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
