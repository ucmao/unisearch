import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { DocumentEngine } from '../src/document/document-engine';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { GraphService } from '../src/analyzers/graph-service';
import { ReportArtifactService } from '../src/analyzers/report-artifact-service';
import { AnalyticsRepository } from '../src/database/repository';
import { QualityGateService } from '../src/analyzers/quality-gate-service';
import { ConnectorHealthService } from '../src/connectors/health-service';
import { AgentRepository } from '../src/server/services/AgentRepository';
import { SearchRelevanceService } from '../src/analyzers/search-relevance-service';

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
    assert.equal(graph.snapshotDocumentCount, 1);
    assert.equal(graph.currentDocumentCount, 1);
    assert.equal(graph.isOutdated, false);
    assert.equal(graph.newDocumentCount, 0);
    assert.ok(graph.nodes.some((node: any) => node.type === 'subject' && node.label === '测试作者'));
    assert.ok(graph.nodes.some((node: any) => node.type === 'platform' && node.label === '小红书'));
    assert.ok(graph.nodes.some((node: any) => node.type === 'keyword' && node.label === '咖啡'));
    assert.ok(graph.edges.some((edge: any) => edge.relation === 'matched_keyword' && edge.documentIds.length === 1));
    assert.equal(service.latest({ threadId: 'thread-1' })?.id, graph.id);

    // Simulate new document ingested into thread-1
    await new DocumentEngine(() => db).ingest(buildRawItem('emitXhsNote', {
      note_id: 'note-2', title: '第二篇咖啡测评', desc: '更多深度对比内容', note_url: 'https://example.com/note-2',
      nickname: '新测评官', user_id: 'creator-2', tags: ['拿铁', '测评'], keyword: '拿铁',
    }), 'run-1');

    const outdatedGraph = service.latest({ threadId: 'thread-1' });
    assert.equal(outdatedGraph?.snapshotDocumentCount, 1);
    assert.equal(outdatedGraph?.currentDocumentCount, 2);
    assert.equal(outdatedGraph?.isOutdated, true);
    assert.equal(outdatedGraph?.newDocumentCount, 1);

    // Rebuild graph
    const rebuiltGraph = service.rebuild({ threadId: 'thread-1' });
    assert.equal(rebuiltGraph.snapshotDocumentCount, 2);
    assert.equal(rebuiltGraph.currentDocumentCount, 2);
    assert.equal(rebuiltGraph.isOutdated, false);
    assert.equal(rebuiltGraph.newDocumentCount, 0);

    const subject = graph.nodes.find((node: any) => node.type === 'subject');
    const evidence = service.evidence(graph.id, subject.id);
    assert.equal(evidence.documents.length, 1);
    assert.equal(evidence.documents[0].title, '咖啡测评');
    assert.equal(evidence.documents[0].platform, 'xhs');
    assert.equal(evidence.documents[0].platformLabel, '小红书');
  } finally { db.close(); }
});

test('search engine graph maps platform to Chinese and disambiguates publisher subjects', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  const now = new Date().toISOString();
  try {
    db.prepare("INSERT INTO agent_threads (thread_id,title,created_at,updated_at) VALUES ('thread-search','搜索任务',?,?)").run(now, now);
    db.prepare(`INSERT INTO workflow_runs
      (workflow_id,thread_id,skill_id,skill_version,goal,status,input_json,output_json,created_at,updated_at)
      VALUES ('workflow-search','thread-search','test','1','百度检索','completed','{}','{}',?,?)`).run(now, now);
    db.prepare(`INSERT INTO crawl_runs
      (run_id,thread_id,workflow_id,task_title,task_name,platform,crawler_type,keywords,status,started_at,config_json)
      VALUES ('run-search','thread-search','workflow-search','测试','测试','baidu','search','AIGC','running',?,?)`)
      .run(now, JSON.stringify({ connector_options: { max_items: 2 } }));

    const engine = new DocumentEngine(() => db);
    await engine.ingest(buildRawItem('emitSearchEngineResult', {
      search_engine: 'baidu', title: '百家号文章', url: 'https://baijiahao.baidu.com/s?id=1',
      snippet: '百家号深度内容', publisher: '百家号', source_keyword: 'AIGC', search_rank: 1,
    }), 'run-search');
    await engine.ingest(buildRawItem('emitSearchEngineResult', {
      search_engine: 'baidu', title: '通用搜索聚合', url: 'https://www.baidu.com/s?wd=AIGC',
      snippet: '搜索聚合卡片', publisher: '百度检索聚合', source_keyword: 'AIGC', search_rank: 2,
    }), 'run-search');

    const service = new GraphService(() => db);
    const graph = service.rebuild({ threadId: 'thread-search' });

    // Platform node must be mapped to '百度搜索', not 'baidu'
    const platformNode = graph.nodes.find((n: any) => n.type === 'platform');
    assert.ok(platformNode, 'Platform node should exist');
    assert.equal(platformNode.label, '百度搜索');

    // Subject nodes should be '百家号' and '百度检索聚合', never conflicting '百度搜索'
    const subjectNodes = graph.nodes.filter((n: any) => n.type === 'subject');
    const subjectLabels = subjectNodes.map((n: any) => n.label);
    assert.ok(subjectLabels.includes('百家号'));
    assert.ok(subjectLabels.includes('百度检索聚合'));
    assert.ok(!subjectLabels.includes('baidu'));
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
    const docx = await service.renderFormal(artifact.artifactId, 'docx');
    const pdf = await service.renderFormal(artifact.artifactId, 'pdf');
    assert.equal(docx.body.subarray(0, 2).toString(), 'PK');
    assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
    assert.equal(service.list('thread-1').length, 1);
  } finally { db.close(); }
});

test('incremental reports form a version series with deterministic evidence and section diffs', async () => {
  const { db, now } = await fixture();
  try {
    const graphs = new GraphService(() => db);
    const service = new ReportArtifactService(() => db, graphs);
    db.prepare(`INSERT INTO analysis_reports
      (report_id,analyzer_id,analyzer_version,workflow_id,title,content,metadata_json,created_at)
      VALUES ('report-base','quick.report','1.0.0','workflow-1','研究报告','旧正文','{}',?)`).run(now);
    const first = service.create({
      reportId: 'report-base', threadId: 'thread-1', workflowId: 'workflow-1', title: '研究报告',
      content: '## 结论\n旧结论', sources: [{ id: 'S1', documentId: 'doc-1', title: '旧来源' }],
    });
    db.prepare(`INSERT INTO workflow_runs
      (workflow_id,thread_id,base_workflow_id,incremental_since,skill_id,skill_version,goal,status,input_json,output_json,created_at,updated_at)
      VALUES ('workflow-2','thread-1','workflow-1',?,'test','1','品牌研究增量','completed','{}','{}',?,?)`).run(now, now, now);
    db.prepare(`INSERT INTO analysis_reports
      (report_id,analyzer_id,analyzer_version,workflow_id,title,content,metadata_json,created_at)
      VALUES ('report-next','quick.report','1.0.0','workflow-2','研究报告','新正文','{}',?)`).run(now);
    const second = service.create({
      reportId: 'report-next', threadId: 'thread-1', workflowId: 'workflow-2', title: '研究报告',
      content: '## 结论\n新结论\n## 风险\n新增风险', sources: [{ id: 'S2', documentId: 'doc-2', title: '新来源' }],
    });
    assert.equal(first.versionNumber, 1);
    assert.equal(second.versionNumber, 2);
    assert.equal(second.previousArtifactId, first.artifactId);
    const comparison = service.compare(second.artifactId);
    assert.deepEqual(comparison.documents.added, ['doc-2']);
    assert.deepEqual(comparison.documents.removed, ['doc-1']);
    assert.deepEqual(comparison.sections.added, ['风险']);
    assert.deepEqual(comparison.sections.changed, ['结论']);
  } finally { db.close(); }
});

test('search relevance assessment persists weak queries and produces provider-specific rewrites', async () => {
  const { db, now } = await fixture();
  try {
    db.prepare("UPDATE workflow_runs SET goal='新能源汽车电池安全研究', input_json=? WHERE workflow_id='workflow-1'")
      .run(JSON.stringify({ keywords: ['新能源汽车'] }));
    db.prepare(`INSERT INTO workflow_steps
      (step_id,workflow_id,step_key,kind,uses_id,depends_on_json,input_json,output_json,status,max_attempts,timeout_ms,external_ref,created_at,updated_at)
      VALUES ('search-step','workflow-1','collect:baidu','connector','connector.baidu','[]','{}','{"runId":"search-run"}','completed',1,300000,'baidu',?,?)`).run(now, now);
    db.prepare(`INSERT INTO crawl_runs
      (run_id,thread_id,workflow_id,task_title,task_name,platform,crawler_type,keywords,status,started_at,config_json)
      VALUES ('search-run','thread-1','workflow-1','搜索','搜索','baidu','search','新能源汽车','completed',?,'{}')`).run(now);
    await new DocumentEngine(() => db).ingest(buildRawItem('emitSearchEngineResult', {
      search_engine: 'baidu', title: '汽车销量排行榜', snippet: '本月汽车市场销量统计',
      real_url: 'https://example.com/cars', source_keyword: '新能源汽车', search_rank: 1,
    }), 'search-run');
    const service = new SearchRelevanceService(() => db);
    const result = await service.evaluate('workflow-1', '新能源汽车电池安全研究', 'initial', ['collect:baidu']);
    assert.equal(result.assessments[0].status, 'weak');
    assert.match(result.rewrittenByProvider.baidu[0], /电池|安全/);
    assert.equal(service.list('workflow-1').length, 1);
  } finally { db.close(); }
});

test('manual entity merge and split rules survive deterministic graph rebuilds', async () => {
  const { db } = await fixture();
  try {
    await new DocumentEngine(() => db).ingest(buildRawItem('emitXhsNote', {
      note_id: 'note-2', title: '咖啡复测', desc: '第二篇完整咖啡测评正文。', note_url: 'https://example.com/note-2',
      nickname: '测试作者别名', user_id: 'creator-2', tags: ['咖啡'], keyword: '咖啡',
    }), 'run-1');
    const service = new GraphService(() => db);
    const graph = service.rebuild({ threadId: 'thread-1' });
    const subjects = graph.nodes.filter((node: any) => node.type === 'subject');
    const platform = graph.nodes.find((node: any) => node.type === 'platform');
    assert.equal(subjects.length, 2);
    assert.ok(platform);

    // 平台节点安全保护约束
    assert.throws(() => service.mergeEntities(graph.id, [platform.id, platform.id], '非法合并平台'), /平台作为物理信源维度/);
    assert.throws(() => service.ignoreEntity(graph.id, platform.id), /平台为客观信源节点/);

    // 语义化关联连线
    const linked = service.linkEntities(graph.id, subjects[0].id, subjects[1].id, 'competitor');
    assert.ok(linked.edges.some((edge: any) => edge.relation === 'competitor'));

    const merged = service.mergeEntities(graph.id, subjects.map((node: any) => node.id), '统一作者');
    const mergedNode = merged.nodes.find((node: any) => node.type === 'subject' && node.label === '统一作者');
    assert.equal(mergedNode.weight, 2);
    const split = service.splitEntity(merged.id, mergedNode.id, [mergedNode.documentIds[0]], '独立作者');
    assert.ok(split.nodes.some((node: any) => node.type === 'subject' && node.label === '独立作者'));
    assert.equal(service.listEntityRules(split.id).length, 3);
    const splitRule = service.listEntityRules(split.id).find((rule: any) => rule.operation === 'split');
    const restored = service.removeEntityRule(split.id, splitRule.ruleId);
    assert.equal(restored.nodes.some((node: any) => node.label === '独立作者'), false);
  } finally { db.close(); }
});

test('interrupted connector steps keep a resumable checkpoint instead of becoming failed', async () => {
  const { db, now } = await fixture();
  try {
    db.prepare("UPDATE workflow_runs SET status='running' WHERE workflow_id='workflow-1'").run();
    db.prepare(`INSERT INTO workflow_steps
      (step_id,workflow_id,step_key,kind,uses_id,depends_on_json,input_json,output_json,status,max_attempts,timeout_ms,external_ref,created_at,updated_at)
      VALUES ('step-1','workflow-1','collect:xhs','connector','connector.xhs','[]','{}','{"runId":"run-1"}','running',2,300000,'xhs',?,?)`).run(now, now);
    const repository = new AgentRepository(() => db);
    repository.reconcileStuckTasks();
    assert.equal((db.prepare("SELECT status FROM workflow_steps WHERE step_id='step-1'").get() as any).status, 'queued');
    assert.equal((db.prepare("SELECT status FROM workflow_runs WHERE workflow_id='workflow-1'").get() as any).status, 'interrupted');
    const checkpoint = repository.getStepCheckpoint('step-1');
    assert.equal(checkpoint.lastRunId, 'run-1');
    assert.equal(checkpoint.collectedItemCount, 1);
    assert.deepEqual(checkpoint.details.runIds, ['run-1']);
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

test('quality gate selects only traceable deficient documents for enrichment and persists the decision', async () => {
  const { db } = await fixture();
  try {
    const service = new QualityGateService(() => db);
    const result = service.assess({ workflowId: 'workflow-1', runId: 'run-1', platform: 'xhs', phase: 'enrichment', minTextChars: 200 });
    assert.equal(result.status, 'insufficient');
    assert.equal(result.missingTextCount, 1);
    assert.deepEqual(result.targets, ['https://example.com/note-1']);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM quality_gate_runs').get() as any).count, 1);
  } finally { db.close(); }
});

test('health policy replaces implicit broken connectors but requires confirmation for explicit choices', async () => {
  const { db, now } = await fixture();
  try {
    const insert = db.prepare(`INSERT INTO connector_health
      (connector_id,state,run_count,success_rate,yield_rate,duplicate_rate,field_coverage,metrics_json,updated_at)
      VALUES (?,?,?,?,0,0,0,'{}',?)`);
    insert.run('xhs', 'broken', 3, 0, now);
    insert.run('douyin', 'healthy', 3, 1, now);
    const service = new ConnectorHealthService(() => db);
    const implicit = service.evaluatePlan(['xhs'], [], 'keyword_search');
    assert.deepEqual(implicit.selectedPlatforms, ['douyin']);
    assert.equal(implicit.decisions[0].action, 'replace');
    const explicit = service.evaluatePlan(['xhs'], ['xhs'], 'keyword_search');
    assert.deepEqual(explicit.selectedPlatforms, ['xhs']);
    assert.equal(explicit.requiresConfirmation, true);
  } finally { db.close(); }
});

test('social keyword workflow inserts selective enrichment and a final quality gate before analysis', async () => {
  const { db } = await fixture();
  try {
    const repository = new AgentRepository(() => db);
    const plan = repository.createPlan('thread-1', {
      goal: '咖啡研究', platforms: ['xhs'], keywords: ['咖啡'], capability: 'keyword_search',
      contentEnrichment: { mode: 'auto', maxReadItems: 8, maxPerDomain: 2, concurrency: 2, timeoutMsPerUrl: 30000 },
      collectionDepth: 'standard', loginType: 'qrcode', headless: false, analysis: [], autoAnalyze: true, outputs: [],
    });
    const persistedSteps = db.prepare('SELECT step_key, depends_on_json FROM workflow_steps WHERE workflow_id=?').all(plan.plan_id) as any[];
    const steps = persistedSteps.map((step) => step.step_key);
    assert.ok(steps.includes('quality:xhs'));
    assert.ok(steps.includes('enrich:xhs'));
    assert.ok(steps.includes('quality-final'));
    const finalizer = persistedSteps.find((step) => step.step_key === 'finalize-documents');
    assert.deepEqual(JSON.parse(finalizer.depends_on_json), ['quality-final']);
  } finally { db.close(); }
});

test('completed workflows can create a destructive-schema incremental successor with a fixed watermark', async () => {
  const { db, now } = await fixture();
  try {
    const repository = new AgentRepository(() => db);
    const base = repository.createPlan('thread-1', {
      goal: '咖啡研究', platforms: ['xhs'], keywords: ['咖啡'], capability: 'keyword_search',
      contentEnrichment: { mode: 'snippet', maxReadItems: 0, maxPerDomain: 2, concurrency: 2, timeoutMsPerUrl: 30000 },
      collectionDepth: 'quick', loginType: 'qrcode', headless: false, analysis: [], autoAnalyze: true, outputs: [],
    });
    db.prepare("UPDATE workflow_runs SET status='completed', finished_at=?, updated_at=? WHERE workflow_id=?")
      .run(now, now, base.plan_id);
    const incremental = repository.createIncrementalPlan(base.plan_id);
    assert.equal(incremental.base_workflow_id, base.plan_id);
    assert.equal(incremental.incremental_since, now);
    assert.equal(incremental.plan.incremental.baseWorkflowId, base.plan_id);
    assert.match(incremental.goal, /增量更新/);
  } finally { db.close(); }
});
