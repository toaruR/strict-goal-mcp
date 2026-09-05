import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan } from '../src/artifact/plan_checks.js';

function task(overrides = {}) {
  return {
    id: 'T001',
    title: 'タスク',
    intent: 'このタスクの意図を20文字以上で説明する文章',
    design_refs: ['§1.1'],
    depends_on: [],
    changes: [{ path: 'src/a.js', kind: 'add' }],
    acceptance: ['受け入れ条件が満たされること'],
    verify: [{ command: 'npm test', expect_exit_code: 0 }],
    ...overrides,
  };
}

function plan(tasks) {
  return { plan_version: 1, summary: 'x'.repeat(40), tasks };
}

test('id が重複する plan が E_PLAN_INVALID になり detail に重複 id が入る', () => {
  const p = plan([task({ id: 'T001' }), task({ id: 'T001' })]);
  assert.throws(
    () => checkPlan(p),
    (err) => err.code === 'E_PLAN_INVALID' && err.detail.ids.includes('T001'),
  );
});

test('depends_on が存在しない id を指す plan が E_PLAN_INVALID になる', () => {
  const p = plan([task({ id: 'T001', depends_on: ['T999'] })]);
  assert.throws(
    () => checkPlan(p),
    (err) => err.code === 'E_PLAN_INVALID' && err.detail.check === 'phantom_dependency' && err.detail.ref === 'T999',
  );
});

test('T001->T002->T001 の循環を持つ plan が E_PLAN_INVALID になり detail に残余 id が入る', () => {
  const p = plan([
    task({ id: 'T001', depends_on: ['T002'] }),
    task({ id: 'T002', depends_on: ['T001'] }),
  ]);
  assert.throws(
    () => checkPlan(p),
    (err) =>
      err.code === 'E_PLAN_INVALID' &&
      err.detail.check === 'cycle' &&
      err.detail.remaining_ids.includes('T001') &&
      err.detail.remaining_ids.includes('T002'),
  );
});

test('2件以上のタスクがあり、どこからも参照されずどこも参照しない孤立タスクがある plan が E_PLAN_INVALID になる', () => {
  const p = plan([
    task({ id: 'T001', depends_on: [] }),
    task({ id: 'T002', depends_on: ['T001'] }),
    task({ id: 'T003', depends_on: [] }),
  ]);
  assert.throws(
    () => checkPlan(p),
    (err) => err.code === 'E_PLAN_INVALID' && err.detail.check === 'orphan_task' && err.detail.task_id === 'T003',
  );
});

test('複数の depends_on:[] ルートがあっても、互いに参照し合っていれば孤立扱いにならない', () => {
  const p = plan([
    task({ id: 'T001', depends_on: [] }),
    task({ id: 'T002', depends_on: [] }),
    task({ id: 'T003', depends_on: ['T001', 'T002'] }),
  ]);
  assert.deepEqual(checkPlan(p), ['T001', 'T002', 'T003']);
});

test('循環が無い plan についてトポロジカル順序が1本返る', () => {
  const p = plan([
    task({ id: 'T003', depends_on: ['T002'] }),
    task({ id: 'T001', depends_on: [] }),
    task({ id: 'T002', depends_on: ['T001'] }),
  ]);
  assert.deepEqual(checkPlan(p), ['T001', 'T002', 'T003']);
});
