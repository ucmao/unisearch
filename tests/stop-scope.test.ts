import assert from 'node:assert/strict';
import test from 'node:test';
import { planIdsForRunningCrawlers } from '../src/server/services/StopScope';

const RUNS: Record<string, string | null> = {
  'run-plan-a': 'plan-a',
  'run-plan-a-2': 'plan-a',
  'run-plan-b': 'plan-b',
  'run-manual': null,
};
const lookup = (runId: string) => RUNS[runId];

test('a plan-owned crawler resolves to its plan so the plan gets cancelled', () => {
  // Killing only the process lets the workflow start its next queued platform,
  // so the user would see collection continue right after pressing stop.
  assert.deepEqual(
    planIdsForRunningCrawlers([{ status: 'running', run_id: 'run-plan-a' }], lookup),
    ['plan-a'],
  );
});

test('an ad-hoc crawler resolves to no plan and is stopped directly', () => {
  assert.deepEqual(
    planIdsForRunningCrawlers([{ status: 'running', run_id: 'run-manual' }], lookup),
    [],
  );
});

test('platforms of the same plan are cancelled once, not once per platform', () => {
  assert.deepEqual(
    planIdsForRunningCrawlers([
      { status: 'running', run_id: 'run-plan-a' },
      { status: 'running', run_id: 'run-plan-a-2' },
      { status: 'running', run_id: 'run-plan-b' },
    ], lookup),
    ['plan-a', 'plan-b'],
  );
});

test('a crawler already stopping still counts, an idle one does not', () => {
  assert.deepEqual(
    planIdsForRunningCrawlers([{ status: 'stopping', run_id: 'run-plan-a' }], lookup),
    ['plan-a'],
  );
  assert.deepEqual(
    planIdsForRunningCrawlers([
      { status: 'idle', run_id: 'run-plan-a' },
      { status: 'completed', run_id: 'run-plan-b' },
    ], lookup),
    [],
  );
});

test('missing or unknown run ids are ignored rather than throwing', () => {
  assert.deepEqual(
    planIdsForRunningCrawlers([
      { status: 'running', run_id: null },
      { status: 'running' },
      { status: 'running', run_id: 'run-that-vanished' },
    ], lookup),
    [],
  );
  assert.deepEqual(planIdsForRunningCrawlers([], lookup), []);
});
