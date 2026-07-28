import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyConnectorError } from '../src/core/contracts/errors';

test('missing packaged dependencies are classified as permanent failures', () => {
  const error = classifyConnectorError(new Error("Cannot find module 'playwright'"));
  assert.equal(error.code, 'UNSUPPORTED_CAPABILITY');
  assert.equal(error.retryable, false);
});

test('transient network failures remain retryable', () => {
  const error = classifyConnectorError(new Error('connect ECONNRESET'));
  assert.equal(error.code, 'NETWORK_ERROR');
  assert.equal(error.retryable, true);
});
