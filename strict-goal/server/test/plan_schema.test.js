import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanSchema, parsePlanContent } from '../src/artifact/plan_schema.js';

function validTask(overrides = {}) {
  return {
    id: 'T001',
    title: 'タスク1',
    intent: 'このタスクの意図を20文字以上で説明する文章',
    design_refs: ['§1.1'],
    depends_on: [],
    changes: [{ path: 'src/a.js', kind: 'add' }],
    acceptance: ['受け入れ条件が満たされること'],
    verify: [{ command: 'npm test', expect_exit_code: 0 }],
    ...overrides,
  };
}

function validPlan(overrides = {}) {
  return {
    plan_version: 1,
    summary: 'これは40文字以上になるように書いた計画の要約文章です。ダミーの文字を足して長さを稼ぎます。',
    tasks: [validTask()],
    ...overrides,
  };
}

test('妥当な plan は例外を投げない', () => {
  assert.equal(validatePlanSchema(validPlan()), true);
});

test('plan_version / summary / tasks のいずれかを欠くと E_PLAN_SCHEMA になる', () => {
  for (const key of ['plan_version', 'summary', 'tasks']) {
    const plan = validPlan();
    delete plan[key];
    assert.throws(() => validatePlanSchema(plan), { code: 'E_PLAN_SCHEMA' }, key);
  }
});

test('task の id が T1 や TASK001 のとき pattern 違反として E_PLAN_SCHEMA になる', () => {
  for (const id of ['T1', 'TASK001']) {
    const plan = validPlan({ tasks: [validTask({ id })] });
    assert.throws(() => validatePlanSchema(plan), { code: 'E_PLAN_SCHEMA' }, id);
  }
});

test('tasks が0件のとき、および201件のとき E_PLAN_SCHEMA になる', () => {
  assert.throws(() => validatePlanSchema(validPlan({ tasks: [] })), { code: 'E_PLAN_SCHEMA' });

  const tooMany = Array.from({ length: 201 }, (_, i) =>
    validTask({ id: `T${String(i % 1000).padStart(3, '0')}` }),
  );
  assert.throws(() => validatePlanSchema(validPlan({ tasks: tooMany })), { code: 'E_PLAN_SCHEMA' });
});

test('task に未知キーを足すと additionalProperties 違反で E_PLAN_SCHEMA になる', () => {
  const plan = validPlan({ tasks: [validTask({ unknown_key: 'x' })] });
  assert.throws(() => validatePlanSchema(plan), { code: 'E_PLAN_SCHEMA' });
});

test('summary が39文字のとき E_PLAN_SCHEMA、40文字は通る', () => {
  assert.throws(() => validatePlanSchema(validPlan({ summary: 'あ'.repeat(39) })), { code: 'E_PLAN_SCHEMA' });
  assert.equal(validatePlanSchema(validPlan({ summary: 'あ'.repeat(40) })), true);
});

test('changes / acceptance / verify のいずれかが0件のとき E_PLAN_SCHEMA になる', () => {
  for (const key of ['changes', 'acceptance', 'verify']) {
    const plan = validPlan({ tasks: [validTask({ [key]: [] })] });
    assert.throws(() => validatePlanSchema(plan), { code: 'E_PLAN_SCHEMA' }, key);
  }
});

test('task が design_refs を持たないとき required 違反として E_PLAN_SCHEMA になり detail.path/reason が正しい', () => {
  const task = validTask();
  delete task.design_refs;
  const plan = validPlan({ tasks: [task] });
  assert.throws(
    () => validatePlanSchema(plan),
    (err) =>
      err.code === 'E_PLAN_SCHEMA' &&
      err.detail.path === '/tasks/0/design_refs' &&
      err.detail.reason === 'required',
  );
});

test('design_refs が空配列のとき minItems 違反として E_PLAN_SCHEMA になり detail.reason が min_items になる', () => {
  const plan = validPlan({ tasks: [validTask({ design_refs: [] })] });
  assert.throws(
    () => validatePlanSchema(plan),
    (err) => err.code === 'E_PLAN_SCHEMA' && err.detail.reason === 'min_items',
  );
});

test('task スキーマの required が8件（id/title/intent/design_refs/depends_on/changes/acceptance/verify）である', () => {
  const requiredKeys = ['id', 'title', 'intent', 'design_refs', 'depends_on', 'changes', 'acceptance', 'verify'];
  for (const key of requiredKeys) {
    const task = validTask();
    delete task[key];
    assert.throws(() => validatePlanSchema(validPlan({ tasks: [task] })), { code: 'E_PLAN_SCHEMA' }, key);
  }
});

test('content が JSON として不正なとき E_PLAN_SCHEMA になる', () => {
  assert.throws(() => parsePlanContent('{ not json'), { code: 'E_PLAN_SCHEMA' });
});

test('content が妥当な plan JSON 文字列のとき parse された plan を返す', () => {
  const plan = parsePlanContent(JSON.stringify(validPlan()));
  assert.equal(plan.plan_version, 1);
});
