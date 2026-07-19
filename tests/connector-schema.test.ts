import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';

test('content records preserve connector-specific source metadata', () => {
  const db = new Database(':memory:');
  try {
    initSchema(db);
    const columns = db.prepare('PRAGMA table_info(content_records)').all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'source_metadata'));
  } finally {
    db.close();
  }
});
