import assert from 'node:assert/strict';
import test from 'node:test';
import { CrawlerManager } from '../src/server/services/CrawlerManager';

test('crawler manager uses a bounded application-wide concurrency limit', () => {
  const manager = new CrawlerManager();

  assert.equal(manager.getMaxConcurrentTasks(), 3);
  assert.equal(manager.setMaxConcurrentTasks(5), 5);
  assert.equal(manager.setMaxConcurrentTasks(10), 5);
  assert.equal(manager.setMaxConcurrentTasks(0), 1);
  assert.equal(manager.getActiveTaskCount(), 0);
  assert.equal(manager.hasCapacity(), true);
});
