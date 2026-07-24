import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { DocumentEngine } from '../src/document/document-engine';
import { documentProcessorRegistry } from '../src/document/processor-registry';
import { skillRegistry } from '../src/skills/registry';
import { WorkflowRepository } from '../src/workflow/workflow-repository';
import { WorkflowEngine } from '../src/workflow/workflow-engine';

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

test('Document Engine normalizes, cleans and deduplicates RawItems with provenance', async () => {
  const db = database();
  try {
    const engine = new DocumentEngine(() => db);
    const raw = buildRawItem('storeSearchEngineResult', {
      engine: 'bing',
      title: '  UniSearch   架构  ',
      snippet: '第一段  \r\n\r\n\r\n第二段\u0000',
      real_url: 'https://example.com/research#section',
      images: ['https://example.com/cover.webp'],
    });
    const first = await engine.ingest(raw, 'run-1');
    const second = await engine.ingest(raw, 'run-2');

    assert.equal(first.documentId, second.documentId);
    assert.equal(first.title, 'UniSearch 架构');
    assert.equal(first.markdown, '第一段\n\n第二段');
    assert.equal(first.sourceUrl, 'https://example.com/research');
    assert.equal(first.assets[0].kind, 'image');
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM documents').get() as any).count, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM document_sources').get() as any).count, 2);
    assert.equal(engine.listByRun('run-1').length, 1);
  } finally {
    db.close();
  }
});

test('default Processor registry exposes deterministic ingestion processors', () => {
  assert.deepEqual(
    documentProcessorRegistry.list().map((processor) => processor.id),
    ['metadata.normalize', 'document.clean_markdown'],
  );
  assert.throws(() => documentProcessorRegistry.get('whisper.transcribe'), /Unknown processor/);
});

test('multi-source Skill compiles into persistent Connector and Processor workflow steps', () => {
  const db = database();
  try {
    const repository = new WorkflowRepository(() => db);
    const engine = new WorkflowEngine(repository);
    const workflow = engine.ensureResearchWorkflow('plan-1', 'thread-1', {
      goal: '调研 UniSearch',
      platforms: ['xhs', 'bing'],
      keywords: ['UniSearch'],
      capability: 'keyword_search',
    });

    assert.equal(workflow.skill_id, 'multi-source-research');
    assert.deepEqual(workflow.steps.map((step: any) => step.step_key), [
      'collect:xhs',
      'collect:bing',
      'normalize-documents',
    ]);
    assert.deepEqual(workflow.steps[2].depends_on, ['collect:xhs', 'collect:bing']);

    engine.syncResearchPlan({
      plan_id: 'plan-1',
      status: 'running',
      steps: [
        { platform: 'xhs', status: 'completed', run_id: 'run-xhs' },
        { platform: 'bing', status: 'running', run_id: 'run-bing' },
      ],
    });
    assert.equal(engine.getByPlan('plan-1').status, 'running');

    const completed = engine.syncResearchPlan({
      plan_id: 'plan-1',
      status: 'completed',
      steps: [
        { platform: 'xhs', status: 'completed', run_id: 'run-xhs' },
        { platform: 'bing', status: 'completed', run_id: 'run-bing' },
      ],
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.steps.find((step: any) => step.step_key === 'normalize-documents').status, 'completed');
  } finally {
    db.close();
  }
});

test('Workflow repository rejects invalid dependency graphs and persists cancellation', () => {
  const db = database();
  try {
    const repository = new WorkflowRepository(() => db);
    assert.throws(() => repository.create(null, null, {
      skillId: 'invalid',
      skillVersion: '1',
      input: {},
      steps: [
        { key: 'a', kind: 'processor', uses: 'a', dependsOn: ['b'], input: {}, maxAttempts: 1 },
        { key: 'b', kind: 'processor', uses: 'b', dependsOn: ['a'], input: {}, maxAttempts: 1 },
      ],
    }), /dependency cycle/);

    const engine = new WorkflowEngine(repository);
    engine.ensureResearchWorkflow('plan-cancel', 'thread-cancel', {
      goal: '取消测试',
      platforms: ['bing'],
      keywords: ['测试'],
    });
    engine.cancelByPlan('plan-cancel');
    const cancelled = engine.getByPlan('plan-cancel');
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.steps.every((step: any) => step.status === 'cancelled'));

    const interrupted = engine.ensureResearchWorkflow('plan-interrupted', 'thread-interrupted', {
      goal: '恢复测试',
      platforms: ['bing'],
      keywords: ['测试'],
    });
    repository.setStatus(interrupted.workflow_id, 'running');
    repository.setStepStatus(interrupted.workflow_id, 'collect:bing', 'running');
    assert.equal(repository.reconcileInterrupted(), 1);
    const recovered = engine.getByPlan('plan-interrupted');
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.steps.find((step: any) => step.step_key === 'collect:bing').status, 'failed');
  } finally {
    db.close();
  }
});

test('Skill registry validates and exposes the built-in research Skill', () => {
  const skill = skillRegistry.get('multi-source-research');
  assert.equal(skill.version, '1.0.0');
  assert.deepEqual(skill.workflow.itemProcessors, ['metadata.normalize', 'document.clean_markdown']);
});

test('Workflow Engine executes registered local handlers and persists retry attempts', async () => {
  const db = database();
  try {
    const repository = new WorkflowRepository(() => db);
    const engine = new WorkflowEngine(repository);
    const workflow = repository.create(null, null, {
      skillId: 'processor-test',
      skillVersion: '1',
      input: {},
      steps: [{
        key: 'clean',
        kind: 'processor',
        uses: 'processor.test',
        dependsOn: [],
        input: { value: 'ok' },
        maxAttempts: 2,
        timeoutMs: 1000,
      }],
    });
    let attempts = 0;
    engine.registerHandler('processor.test', async (input) => {
      attempts++;
      if (attempts === 1) throw new Error('temporary');
      return { value: input.value };
    });

    const first = await engine.tick(workflow.workflow_id);
    assert.equal(first.steps[0].status, 'queued');
    assert.equal(first.steps[0].attempt, 1);
    const second = await engine.tick(workflow.workflow_id);
    assert.equal(second.status, 'completed');
    assert.equal(second.steps[0].status, 'completed');
    assert.equal(second.steps[0].attempt, 2);
    assert.deepEqual(second.steps[0].output, { value: 'ok' });
  } finally {
    db.close();
  }
});
