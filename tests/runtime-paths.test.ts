import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { getBrowserDataDir, getRuntimeResourcesDir, resolveRuntimeResource } from '../src/tools/runtimePaths';

test('runtime paths honor explicit packaged directories', () => {
  const previousResources = process.env.UNISEARCH_RESOURCES_DIR;
  const previousData = process.env.UNISEARCH_USER_DATA_DIR;
  try {
    process.env.UNISEARCH_RESOURCES_DIR = path.join(path.sep, 'opt', 'unisearch-resources');
    process.env.UNISEARCH_USER_DATA_DIR = path.join(path.sep, 'var', 'unisearch-data');

    assert.equal(getRuntimeResourcesDir(), path.resolve(process.env.UNISEARCH_RESOURCES_DIR));
    assert.equal(
      resolveRuntimeResource('libs', 'stealth.min.js'),
      path.join(path.resolve(process.env.UNISEARCH_RESOURCES_DIR), 'libs', 'stealth.min.js'),
    );
    assert.equal(
      getBrowserDataDir(),
      path.join(path.resolve(process.env.UNISEARCH_USER_DATA_DIR), 'browser_data'),
    );
  } finally {
    if (previousResources === undefined) delete process.env.UNISEARCH_RESOURCES_DIR;
    else process.env.UNISEARCH_RESOURCES_DIR = previousResources;
    if (previousData === undefined) delete process.env.UNISEARCH_USER_DATA_DIR;
    else process.env.UNISEARCH_USER_DATA_DIR = previousData;
  }
});
