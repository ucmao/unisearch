import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { DocumentEngine } from '../src/document/document-engine';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { GraphService } from '../src/analyzers/graph-service';
import { ReportArtifactService } from '../src/analyzers/report-artifact-service';
import { AnalyticsRepository } from '../src/database/repository';

async function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO agent_threads (thread_id,title,created_at,updated_at) VALUES ('thread-1','测试任务',?,?)").run(now, now);
  db.prepare(`INSERT INTO workflow_runs
    (workflow_id,thread_id,skill_id,skill_version,goal,status,input_json,output_json,created_at,updated_at)
    VALUES ('workflow-1','thread-1','test','1','品牌研究','completed','{}','{}',?,?)`).run(now, now);
  db.prepare(`INSERT INTO crawl_runs
    (run_id,thread_id,workflow_id,task_title,task_name,platform,crawler_type,keywords,status,started_at,config_json)
    VALUES ('run-1','thread-1','workflow-1','测试','测试','xhs','search','咖啡','running',?,?)`)
    .run(now, JSON.stringify({ connector_options: { max_items: 1 } }));
  await new DocumentEngine(() => db).ingest(buildRawItem('emitXhsNote', {
    note_id: 'note-1', title: '咖啡测评', desc: '这是一篇咖啡品牌测评正文。', note_url: 'https://example.com/note-1',
    nickname: '测试作者', user_id: 'creator-1', tags: ['咖啡', '测评'], keyword: '咖啡',
  }), 'run-1');
  return { db, now };
}

test('deterministic graph persists traceable nodes and evidence edges', async () => {
  const { db } = await fixture();
  try {
    const service = new GraphService(() => db);
    const graph = service.rebuild({ threadId: 'thread-1' });
    assert.equal(graph.documentCount, 1);
    assert.ok(graph.nodes.some((node: any) => node.type === 'subject' && node.label === '测试作者'));
    assert.ok(graph.nodes.some((node: any) => node.type === 'keyword' && node.label === '咖啡'));
    assert.ok(graph.edges.some((edge: any) => edge.relation === 'matched_keyword' && edge.documentIds.length === 1));
    assert.equal(service.latest({ threadId: 'thread-1' })?.id, graph.id);
  } finally { db.close(); }
});

test('report artifact freezes citations, graph snapshot and portable downloads', async () => {
  const { db, now } = await fixture();
  try {
    db.prepare(`INSERT INTO analysis_reports
      (report_id,analyzer_id,analyzer_version,workflow_id,title,content,metadata_json,created_at)
      VALUES ('report-1','quick.report','1.0.0','workflow-1','研究报告','正文','{}',?)`).run(now);
    const graphs = new GraphService(() => db);
    const service = new ReportArtifactService(() => db, graphs);
    const artifact = service.create({
      reportId: 'report-1', threadId: 'thread-1', workflowId: 'workflow-1', title: '研究报告', content: '核心发现 [S1]',
      sources: [{ id: 'S1', documentId: 'doc-1', title: '来源一', sourceUrl: 'https://example.com' }],
      reproducibility: { analyzerVersion: '1.0.0' },
    });
    assert.ok(artifact.graphId);
    assert.deepEqual(artifact.documentIds, ['doc-1']);
    assert.match(service.render(artifact.artifactId, 'html').body.toString(), /核心发现/);
    assert.match(service.render(artifact.artifactId, 'markdown').body.toString(), /图谱快照/);
    assert.equal(service.list('thread-1').length, 1);
  } finally { db.close(); }
});

test('finishing a run records connector health and collection quality', async () => {
  const { db } = await fixture();
  try {
    const repository = new AnalyticsRepository(() => db);
    repository.finishRun('run-1', 'completed', 0, []);
    const health = db.prepare("SELECT * FROM connector_health WHERE connector_id='xhs'").get() as any;
    assert.equal(health.state, 'healthy');
    assert.equal(health.run_count, 1);
    assert.equal(health.success_rate, 1);
    assert.equal(health.yield_rate, 1);
    assert.ok(health.field_coverage > 0.6);
  } finally { db.close(); }
});
