function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

function checkDuplicateIds(tasks) {
  const seen = new Set();
  const duplicates = new Set();
  for (const task of tasks) {
    if (seen.has(task.id)) duplicates.add(task.id);
    seen.add(task.id);
  }
  if (duplicates.size > 0) {
    fail('E_PLAN_INVALID', 'duplicate task id', { check: 'duplicate_id', ids: [...duplicates] });
  }
}

function checkPhantomDependencies(tasks, idSet) {
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      if (!idSet.has(dep)) {
        fail('E_PLAN_INVALID', `depends_on references unknown id: ${dep}`, {
          check: 'phantom_dependency',
          task_id: task.id,
          ref: dep,
        });
      }
    }
  }
}

// Kahn 法によるトポロジカルソート。循環が残れば E_PLAN_INVALID（detail に残余 id）。
function topologicalSort(tasks) {
  const inDegree = new Map(tasks.map((t) => [t.id, 0]));
  const adjacency = new Map(tasks.map((t) => [t.id, []]));
  for (const task of tasks) {
    for (const dep of task.depends_on) {
      adjacency.get(dep).push(task.id);
      inDegree.set(task.id, inDegree.get(task.id) + 1);
    }
  }

  const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
  const order = [];
  while (queue.length > 0) {
    queue.sort();
    const id = queue.shift();
    order.push(id);
    for (const next of adjacency.get(id)) {
      inDegree.set(next, inDegree.get(next) - 1);
      if (inDegree.get(next) === 0) queue.push(next);
    }
  }

  if (order.length !== tasks.length) {
    const remaining = tasks.map((t) => t.id).filter((id) => !order.includes(id));
    fail('E_PLAN_INVALID', 'circular dependency detected', { check: 'cycle', remaining_ids: remaining });
  }

  return order;
}

// depends_on:[] かつどこからも参照されないタスク（グラフから完全に孤立している）を排除する。
// 複数の depends_on:[] ルートがあること自体は正当（島が複数あっても全体が DAG なら良い）。
function checkOrphanTasks(tasks) {
  if (tasks.length < 2) return;
  const referenced = new Set();
  for (const task of tasks) {
    for (const dep of task.depends_on) referenced.add(dep);
  }
  for (const task of tasks) {
    if (task.depends_on.length === 0 && !referenced.has(task.id)) {
      fail('E_PLAN_INVALID', `orphan task: ${task.id}`, { check: 'orphan_task', task_id: task.id });
    }
  }
}

function checkAcceptanceAndVerify(tasks) {
  for (const task of tasks) {
    if (!task.acceptance || task.acceptance.length === 0) {
      fail('E_PLAN_INVALID', `task has no acceptance: ${task.id}`, { check: 'empty_acceptance', task_id: task.id });
    }
    if (!task.verify || task.verify.length === 0) {
      fail('E_PLAN_INVALID', `task has no verify: ${task.id}`, { check: 'empty_verify', task_id: task.id });
    }
  }
}

// スキーマ検査（T028）を通った plan に対する機械検査。5検査すべて E_PLAN_INVALID で弾く。
// 通れば tasks のトポロジカル順序（id の配列）を返す。
export function checkPlan(plan) {
  const tasks = plan.tasks;
  checkDuplicateIds(tasks);
  const idSet = new Set(tasks.map((t) => t.id));
  checkPhantomDependencies(tasks, idSet);
  const order = topologicalSort(tasks);
  checkOrphanTasks(tasks);
  checkAcceptanceAndVerify(tasks);
  return order;
}
