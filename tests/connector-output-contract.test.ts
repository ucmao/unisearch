import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildRawItem, connectorOutput } from '../src/connectors/output/connector-output';
import { parseConnectorEvent } from '../src/core/contracts/connector-event';
import { connectorEventEmitter } from '../src/core/contracts/connector-event-emitter';
import { CompositeOutputSink } from '../src/core/sinks/composite';
import { MemoryOutputSink } from '../src/core/sinks/memory';
import { SqliteOutputSink } from '../src/core/sinks/sqlite';
import { closeDb, getDb } from '../src/database/connection';

test('legacy connector payloads are wrapped in a versioned RawItem contract', () => {
  const fixturePath = path.resolve(import.meta.dirname, 'fixtures/connectors/xhs-note.json');
  const item = buildRawItem('storeXhsNote', JSON.parse(readFileSync(fixturePath, 'utf8')));

  assert.equal(item.schemaVersion, 1);
  assert.equal(item.id, 'xhs:post:fixture-note-1');
  assert.equal(item.source, 'xhs');
  assert.equal(item.kind, 'post');
  assert.equal(item.sourceItemId, 'fixture-note-1');
  assert.equal(item.parentId, undefined);
  assert.deepEqual(item.hints.mediaUrls, ['https://example.com/fixture-1.jpg']);
  assert.equal(item.metadata.operation, 'storeXhsNote');
});

test('connector output can be tested without a database through OutputSink', async () => {
  const first = new MemoryOutputSink();
  const second = new MemoryOutputSink();
  await connectorOutput.open(
    new CompositeOutputSink([first, second]),
    { runId: 'run-contract', source: 'bing', startedAt: new Date().toISOString() },
  );

  await connectorOutput.storeSearchEngineResult({
    engine: 'bing',
    title: '结果',
    real_url: 'https://example.com/result',
    snippet: '摘要',
  });
  const count = await connectorOutput.close({ status: 'completed' });

  assert.equal(count, 1);
  assert.equal(first.items.length, 1);
  assert.deepEqual(first.items, second.items);
  assert.equal(first.items[0].source, 'bing');
  assert.equal(first.items[0].kind, 'search_result');
});

test('SQLite sink preserves the existing platform storage behavior', async () => {
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'unisearch-output-sink-'));
  const previousUserDataDirectory = process.env.UNISEARCH_USER_DATA_DIR;
  process.env.UNISEARCH_USER_DATA_DIR = temporaryDirectory;
  try {
    const sink = new SqliteOutputSink();
    await sink.write(buildRawItem('storeXhsNote', {
      note_id: 'sqlite-note-1',
      title: '兼容写入',
      desc: '通过 Sink 写入原有平台表',
    }));
    const stored = getDb().prepare('SELECT note_id, title FROM xhs_note WHERE note_id=?').get('sqlite-note-1') as any;
    assert.deepEqual(stored, { note_id: 'sqlite-note-1', title: '兼容写入' });
    assert.equal((getDb().prepare('SELECT COUNT(*) AS count FROM documents').get() as any).count, 1);
  } finally {
    closeDb();
    if (previousUserDataDirectory === undefined) delete process.env.UNISEARCH_USER_DATA_DIR;
    else process.env.UNISEARCH_USER_DATA_DIR = previousUserDataDirectory;
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('structured connector IPC events are schema validated', () => {
  const event = parseConnectorEvent({
    schemaVersion: 1,
    type: 'progress',
    runId: 'run-1',
    source: 'douyin',
    timestamp: new Date().toISOString(),
    sequence: 3,
    current: 10,
    total: 20,
  });
  assert.equal(event.type, 'progress');
  assert.throws(() => parseConnectorEvent({ ...event, sequence: -1 }));

  connectorEventEmitter.configure({ runId: 'run-sequence', source: 'xhs' });
  const ready = connectorEventEmitter.send({ type: 'ready' });
  const started = connectorEventEmitter.send({ type: 'started' });
  connectorEventEmitter.reset();
  assert.equal(ready?.sequence, 0);
  assert.equal(started?.sequence, 1);
});

test('platform connectors no longer import the database store', () => {
  const platformsDirectory = path.resolve(import.meta.dirname, '../src/crawler/platforms');
  for (const filename of readdirSync(platformsDirectory).filter((value) => value.endsWith('.ts'))) {
    const source = readFileSync(path.join(platformsDirectory, filename), 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\.\/store['"]/u, filename);
    assert.doesNotMatch(source, /\bdbStore\./u, filename);
  }
});
