import assert from 'node:assert/strict';
import test from 'node:test';
import { selectPlanPreviews } from '../webui/src/lib/livePreviewScope';

test('live previews are isolated by plan while concurrent tasks are running', () => {
  const previews = [
    { id: 'zheng', title: '郑成功', plan_id: 'plan-history', seq: 1 },
    { id: 'humen', title: '虎门销烟', plan_id: 'plan-current', seq: 2 },
    { id: 'ma', title: '马化腾', plan_id: 'plan-current', seq: 3 },
    { id: 'other', title: '其他并发任务', plan_id: 'plan-other', seq: 4 },
  ];

  assert.deepEqual(
    selectPlanPreviews(previews, 'plan-current', 0).map((item) => item.id),
    ['humen', 'ma'],
  );
});

test('already processed previews from the same plan are not replayed', () => {
  const previews = [
    { id: 'old', plan_id: 'plan-current', seq: 8 },
    { id: 'new', plan_id: 'plan-current', seq: 9 },
  ];

  assert.deepEqual(selectPlanPreviews(previews, 'plan-current', 8).map((item) => item.id), ['new']);
});
