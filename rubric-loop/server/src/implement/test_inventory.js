function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

export function assertTestInventoryRequired(artifactKind, testInventory) {
  if (artifactKind !== 'fileset') return;
  if (!testInventory) {
    fail('E_TEST_INVENTORY_REQUIRED', 'test_inventory is required for artifact_kind:"fileset"');
  }
}

function idSet(inventory) {
  return new Set((inventory.tests ?? []).map((t) => t.id));
}

// R1: prev にあった id が説明（now.removed_tests）なしに消えている。
export function checkRemovedTests(prevInventory, nowInventory) {
  if (!prevInventory) return;
  const prevIds = idSet(prevInventory);
  const nowIds = idSet(nowInventory);
  const removed = [...prevIds].filter((id) => !nowIds.has(id));
  if (removed.length === 0) return;

  const explained = new Set((nowInventory.removed_tests ?? []).map((r) => r.id));
  const unexplained = removed.filter((id) => !explained.has(id));
  if (unexplained.length > 0) {
    fail('E_TEST_REGRESSION', 'tests were removed without explanation', { unexplained });
  }
}

// R2 の commit 時点で判定可能な部分。設計書の R2 は「skip_delta>0 かつ今回のスコアが
// 前周より上がっている」だが、スコアは score_submit までわからないため、
// artifact_commit の受理時点では skip_delta>0 単独で検出する
// （スコアとの組み合わせ判定は score_submit 側の責務として別途持たせる）。
export function checkSkipIncrease(prevInventory, nowInventory) {
  if (!prevInventory) return;
  const skipDelta = nowInventory.counts.skipped - prevInventory.counts.skipped;
  if (skipDelta > 0) {
    fail('E_TEST_REGRESSION', 'skipped test count increased', { skip_delta: skipDelta });
  }
}

// R3: 説明（removed_tests）なしに総数が減っている。
export function checkTotalDecrease(prevInventory, nowInventory) {
  if (!prevInventory) return;
  const removedTests = nowInventory.removed_tests ?? [];
  if (nowInventory.counts.total < prevInventory.counts.total && removedTests.length === 0) {
    fail('E_TEST_REGRESSION', 'total test count decreased without removed_tests explanation', {
      prev_total: prevInventory.counts.total,
      now_total: nowInventory.counts.total,
    });
  }
}

// R1〜R3 をまとめて実行する（artifact_commit の受理時に呼ぶ想定）。
export function checkTestInventoryOnCommit(prevInventory, nowInventory) {
  checkRemovedTests(prevInventory, nowInventory);
  checkSkipIncrease(prevInventory, nowInventory);
  checkTotalDecrease(prevInventory, nowInventory);
}

// R4: テストが green でないのに、verification:"auto" のいずれかの基準に pass_score 以上を付けた
// （score_submit の判定時に呼ぶ想定。score_submit 自体は未実装のため、ここでは契約として持つ）。
export function checkTestNotGreen(testInventory, autoScores, passScore) {
  const isGreen = testInventory.counts.failed === 0 && testInventory.source_exit_code === 0;
  if (isGreen) return;
  const raised = autoScores.filter((s) => s.score >= passScore).map((s) => s.criterion_id);
  if (raised.length > 0) {
    fail('E_TEST_NOT_GREEN', 'auto criteria scored at or above pass_score while tests are not green', {
      criteria: raised,
    });
  }
}
