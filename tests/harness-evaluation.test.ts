import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyHarnessRoute,
  evaluateCitationValidity,
  HARNESS_EVALUATION_CASES,
} from '../src/server/agent/HarnessEvaluation';

test('fixed Harness evaluation set covers the approved route categories', () => {
  assert.equal(HARNESS_EVALUATION_CASES.length, 30);
  assert.deepEqual(
    [...new Set(HARNESS_EVALUATION_CASES.map((item) => item.category))].sort(),
    ['chat', 'collection', 'deep_research', 'realtime', 'safety', 'web_read'],
  );
  const failures = HARNESS_EVALUATION_CASES
    .map((item) => ({ ...item, actual: classifyHarnessRoute(item.input) }))
    .filter((item) => item.actual !== item.expectedRoute);
  assert.deepEqual(failures, []);
});

test('citation evaluator rejects invented evidence ids', () => {
  assert.deepEqual(evaluateCitationValidity('结论一 [S1]，结论二 [S9]，再次引用 [S1]。', ['S1', 'S2']), {
    citationCount: 3,
    uniqueCitationCount: 2,
    invalidCitations: ['S9'],
    valid: false,
  });
  assert.equal(evaluateCitationValidity('证据支持 [S1][S2]', ['S1', 'S2']).valid, true);
});
