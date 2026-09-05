function fail(code, message, detail = {}) {
  const err = new Error(message);
  err.code = code;
  err.detail = detail;
  throw err;
}

// role:"test" のファイルのうち、前周と今回で同じ path なのに sha256 が変わったものを返す。
// 新規追加のテストファイル（前周に同 path が無いもの）は「改変」ではないので対象外。
export function findChangedTestFiles(prevFiles, nowFiles) {
  const prevByPath = new Map(prevFiles.map((f) => [f.path, f]));
  const changed = [];
  for (const file of nowFiles) {
    if (file.role !== 'test') continue;
    const prevFile = prevByPath.get(file.path);
    if (prevFile && prevFile.sha256 !== file.sha256) {
      changed.push(file.path);
    }
  }
  return changed;
}

// R5: 改変されたテストファイルには test_inventory.diffs[] の対応エントリが必須。
export function checkAssertMutation(prevFiles, nowFiles, testInventory) {
  const changedTestFiles = findChangedTestFiles(prevFiles, nowFiles);
  if (changedTestFiles.length === 0) return;

  const diffedFiles = new Set((testInventory.diffs ?? []).map((d) => d.file));
  const missing = changedTestFiles.filter((path) => !diffedFiles.has(path));
  if (missing.length > 0) {
    fail('E_TEST_MUTATED_WITHOUT_DIFF', 'changed test files require test_inventory.diffs[] entries', {
      files: missing,
    });
  }
}

// §19.8.4「守れない範囲」の4項目。implement モードの fileset 提出が受理されるたびに、
// サーバが検出できない領域を warnings として明示する（正直な線引きを毎回可視化する）。
const HONEST_LIMITS = Object.freeze([
  'hash_authenticity_unverifiable',
  'command_execution_unverifiable',
  'genuine_pass_then_weaken_undetectable',
  'semantic_assertion_weakening_undetectable',
]);

export function honestLimitWarnings() {
  return HONEST_LIMITS.map((id) => `honest_limits:${id}`);
}
