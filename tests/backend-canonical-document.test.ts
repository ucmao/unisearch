import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { DocumentEngine } from '../src/document/document-engine';
import { AnalyticsRepository } from '../src/database/repository';

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function insertRun(db: Database.Database, runId: string, platform: string): void {
  db.prepare(`
    INSERT INTO crawl_runs
      (run_id, task_title, task_name, platform, crawler_type, status, started_at)
    VALUES (?, ?, ?, ?, 'search', 'completed', ?)
  `).run(runId, runId, runId, platform, new Date().toISOString());
}

test('Document Engine persists Canonical Document v2 fields without legacy aliases', async () => {
  const db = database();
  try {
    insertRun(db, 'run-xhs', 'xhs');
    const engine = new DocumentEngine(() => db);
    const document = await engine.ingest(buildRawItem('emitXhsNote', {
      note_id: 'note-1',
      note_url: 'https://example.com/note-1',
      title: '  标准标题  ',
      desc: '第一段\r\n\r\n\r\n第二段',
      nickname: '  示例作者  ',
      creator_id: 'creator-1',
      source_keyword: '新能源',
      cover_url: 'https://example.com/note-cover.jpg',
      liked_count: '1.2万',
      comment_count: 8,
    }), 'run-xhs');

    assert.equal(document.schemaVersion, 2);
    assert.equal(document.title, '标准标题');
    assert.equal(document.summary, '第一段 第二段');
    assert.equal(document.markdown, '第一段\n\n第二段');
    assert.deepEqual(document.subject, { id: 'creator-1', name: '示例作者', type: 'creator' });
    assert.deepEqual(document.metrics, { likes: 12_000, comments: 8 });
    assert.equal(document.metrics.views, undefined);
    assert.equal(document.assets[0].role, 'cover');

    const row = db.prepare('SELECT * FROM documents WHERE document_id=?').get(document.documentId) as any;
    assert.equal(row.platform, 'xhs');
    assert.equal(row.summary, '第一段 第二段');
    assert.equal(row.subject_name, '示例作者');
    assert.deepEqual(JSON.parse(row.metrics_json), { likes: 12_000, comments: 8 });
    assert.equal('author' in row, false);
    assert.equal('metadata_json' in row, false);
    const storedAsset = db.prepare('SELECT role FROM document_assets WHERE document_id=?').get(document.documentId) as any;
    assert.equal(storedAsset.role, 'cover');
    assert.equal(engine.get(document.documentId)?.assets[0].role, 'cover');
  } finally {
    db.close();
  }
});

test('Analytics reads canonical snapshots and never reinterprets raw payload fields', async () => {
  const db = database();
  try {
    insertRun(db, 'run-old', 'xhs');
    insertRun(db, 'run-new', 'xhs');
    const engine = new DocumentEngine(() => db);
    const oldItem = {
      ...buildRawItem('emitXhsNote', {
        note_id: 'same-note', note_url: 'https://example.com/same-note', title: '同一内容',
        desc: '旧正文', nickname: '作者', liked_count: 1,
      }),
      fetchedAt: '2026-01-01T00:00:00.000Z',
    };
    const newItem = {
      ...buildRawItem('emitXhsNote', {
        note_id: 'same-note', note_url: 'https://example.com/same-note', title: '同一内容',
        desc: '新正文', nickname: '作者', liked_count: 9,
      }),
      fetchedAt: '2026-01-02T00:00:00.000Z',
    };
    await engine.ingest(oldItem, 'run-old');
    await engine.ingest(newItem, 'run-new');

    db.prepare(`
      UPDATE document_sources
      SET raw_payload_json='{"liked_count":999999,"creator_name":"伪造名称"}'
      WHERE run_id='run-old'
    `).run();

    const analytics = new AnalyticsRepository(() => db);
    const oldDocument = analytics.queryDocuments({ run_id: 'run-old' }).items[0];
    const newDocument = analytics.queryDocuments({ run_id: 'run-new' }).items[0];
    assert.equal(oldDocument.metrics.likes, 1);
    assert.equal(oldDocument.subject.name, '作者');
    assert.equal(oldDocument.markdown, '旧正文');
    assert.equal(newDocument.metrics.likes, 9);
    assert.equal(newDocument.markdown, '新正文');
    assert.equal(oldDocument.provenance.runId, 'run-old');
    assert.equal(newDocument.provenance.runId, 'run-new');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM documents').get() as any).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM document_versions').get() as any).count, 2);
  } finally {
    db.close();
  }
});

test('Analytics exposes generic dimensions and metric coverage across connector families', async () => {
  const db = database();
  try {
    insertRun(db, 'run-social', 'xhs');
    insertRun(db, 'run-job', 'zhaopin');
    const engine = new DocumentEngine(() => db);
    await engine.ingest(buildRawItem('emitXhsNote', {
      note_id: 'social-1', title: '社媒内容', desc: '正文', nickname: '创作者',
      source_keyword: '产品', liked_count: 5,
    }), 'run-social');
    await engine.ingest(buildRawItem('emitZhaopinResult', {
      job_id: 'job-1', job_name: '后端工程师', company_name: '示例科技',
      salary: '25-40K', work_city: '上海', job_experience: '3-5年', education: '本科',
      source_keyword: '工程师',
    }), 'run-job');

    const analytics = new AnalyticsRepository(() => db);
    const jobs = analytics.queryDocuments({ kind: 'job', subject_type: 'company' });
    assert.equal(jobs.total, 1);
    assert.deepEqual(jobs.items[0].metrics, {});
    assert.equal(jobs.items[0].attributes.salary, '25-40K');

    const summary = analytics.summary();
    assert.equal(summary.totals.document_count, 2);
    assert.equal(summary.totals.subject_count, 2);
    assert.deepEqual(summary.totals.metrics, { likes: 5 });
    assert.deepEqual(summary.totals.metric_coverage, { likes: 1 });
    assert.deepEqual(new Set(summary.filters.subject_types), new Set(['creator', 'company']));
    assert.ok(summary.filters.metric_keys.includes('likes'));
    assert.ok(summary.filters.attribute_keys.includes('salary'));
  } finally {
    db.close();
  }
});
