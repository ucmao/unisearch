import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveComposerMode } from '../webui/src/lib/agentTaskState';

test('a message running in another task does not replace this task send action', () => {
  assert.equal(resolveComposerMode({
    messagePending: false,
    planRunning: false,
    hasInput: true,
  }), 'send');
});

test('typing during collection keeps the send action available', () => {
  assert.equal(resolveComposerMode({
    messagePending: false,
    planRunning: true,
    hasInput: true,
  }), 'send');
});

test('an empty composer keeps the existing collection stop shortcut', () => {
  assert.equal(resolveComposerMode({
    messagePending: false,
    planRunning: true,
    hasInput: false,
  }), 'stop-plan');
});

test('only the current task message generation takes precedence', () => {
  assert.equal(resolveComposerMode({
    messagePending: true,
    planRunning: true,
    hasInput: true,
  }), 'stop-message');
});
