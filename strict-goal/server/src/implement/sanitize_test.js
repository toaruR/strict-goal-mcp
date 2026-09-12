import fs from 'node:fs';
import path from 'node:path';
import {
  SANITIZE_MAX_ERROR_CHARS,
  SANITIZE_MAX_FAILURES_RETURNED,
  SANITIZE_MAX_TOTAL_CHARS,
} from '../config/defaults.js';
import { saveSessionLog, ensureLogsDir } from '../store/log_store.js';

export function findActiveSession(dataDir) {
  const indexPath = path.join(dataDir, 'index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (!index.sessions) return null;
    const sessionIds = Object.keys(index.sessions);
    if (sessionIds.length === 0) return null;
    // Prefer non-final or most recent
    const sorted = sessionIds.map(id => ({ id, ...index.sessions[id] }))
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
    const active = sorted.find(s => s.state !== 'FINAL') || sorted[0];
    return active ? active.id : null;
  } catch {
    return null;
  }
}

export function sanitizeStackTrace(rawText, maxChars = SANITIZE_MAX_ERROR_CHARS) {
  const lines = rawText.split('\n');
  const cleaned = [];
  for (const line of lines) {
    // skip common node internal frames
    if (line.includes('node:internal') || line.includes('node_modules')) continue;
    cleaned.push(line);
  }
  let result = cleaned.join('\n').trim();
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + '... (truncated)';
  }
  return result;
}

export function extractFailures(rawOutput) {
  const lines = rawOutput.split('\n');
  const failures = [];
  let currentTest = null;
  let errorLines = [];
  let location = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // TAP のコメント/要約行（"# fail 1" 等）を誤って失敗マーカーとして
    // 拾わないよう、"#" で始まる行は先にスキップする。
    if (line.trim().startsWith('#')) continue;
    const failMatch = line.match(/(?:✖|not ok|FAIL)\s+(?:test at\s+)?([^\r\n]+)/i);
    if (failMatch) {
      if (currentTest) {
        failures.push({
          test_name: currentTest,
          assertion_error: sanitizeStackTrace(errorLines.join('\n')),
          location: location || 'unknown',
        });
      }
      currentTest = failMatch[1].trim();
      errorLines = [];
      location = null;
      continue;
    }

    if (currentTest) {
      if (line.match(/(?:✔|ok|PASS)\s+/i)) {
        failures.push({
          test_name: currentTest,
          assertion_error: sanitizeStackTrace(errorLines.join('\n')),
          location: location || 'unknown',
        });
        currentTest = null;
        errorLines = [];
        location = null;
        continue;
      }
      if (!location) {
        const locMatch = line.match(/(?:at\s+)?([a-zA-Z0-9_/\\.-]+:\d+:\d+)/);
        if (locMatch) {
          location = locMatch[1].replace(/\\/g, '/');
        }
      }
      errorLines.push(line);
    }
  }

  if (currentTest) {
    failures.push({
      test_name: currentTest,
      assertion_error: sanitizeStackTrace(errorLines.join('\n')),
      location: location || 'unknown',
    });
  }

  if (failures.length === 0) {
    // Generic failure parsing if no test marker matched
    const assertionMatch = rawOutput.match(/(AssertionError[^\n]*)/i) || rawOutput.match(/(Error:[^\n]*)/i);
    const errText = assertionMatch ? assertionMatch[1] : rawOutput.slice(0, SANITIZE_MAX_ERROR_CHARS);
    failures.push({
      test_name: 'test_suite',
      assertion_error: sanitizeStackTrace(errText),
      location: 'unknown',
    });
  }

  return failures;
}

export function executeAndSanitize(runResult, dataDir = null) {
  const effectiveDataDir = dataDir || process.env.STRICT_GOAL_DATA_DIR || process.env.PLUGIN_DATA || path.resolve(process.cwd(), '.strict-goal');
  const activeSessionId = findActiveSession(effectiveDataDir);

  let logPath = '';
  let roundNum = 1;
  if (activeSessionId) {
    const sessionJsonPath = path.join(effectiveDataDir, 'sessions', activeSessionId, 'session.json');
    if (fs.existsSync(sessionJsonPath)) {
      try {
        const s = JSON.parse(fs.readFileSync(sessionJsonPath, 'utf8'));
        roundNum = s.round || 1;
      } catch {}
    }
    const logFilename = `test_r${roundNum}.log`;
    logPath = saveSessionLog(effectiveDataDir, activeSessionId, logFilename, runResult.combined);
  } else {
    const fallbackDir = path.join(effectiveDataDir, 'logs');
    fs.mkdirSync(fallbackDir, { recursive: true });
    logPath = path.join(fallbackDir, 'test_last.log');
    fs.writeFileSync(logPath, runResult.combined, 'utf8');
  }

  // Normalize logPath for cross-platform
  const normalizedLogPath = logPath.replace(/\\/g, '/');

  if (runResult.exitCode === 0) {
    return {
      exit_code: 0,
      summary: 'All tests passed',
      failures: [],
      log_path: normalizedLogPath,
    };
  }

  const allFailures = extractFailures(runResult.combined);
  const failures = allFailures.slice(0, SANITIZE_MAX_FAILURES_RETURNED);
  const summary = allFailures.length > failures.length
    ? `${allFailures.length} test(s) failed (showing first ${failures.length})`
    : `${allFailures.length} test(s) failed`;

  return shrinkToFit({
    exit_code: runResult.exitCode,
    summary,
    failures,
    log_path: normalizedLogPath,
  });
}

// 出力先(helper.js の `JSON.stringify(payload, null, 2)`)がバウンド外に
// 膨らまないよう、Node バージョン差などで assertion_error が想定より
// 大きくなった場合でも SANITIZE_MAX_TOTAL_CHARS 以内に収まるまで縮める。
function shrinkToFit(payload, maxTotalChars = SANITIZE_MAX_TOTAL_CHARS) {
  let maxChars = SANITIZE_MAX_ERROR_CHARS;
  let candidate = payload;
  while (JSON.stringify(candidate, null, 2).length > maxTotalChars && maxChars > 20) {
    maxChars = Math.floor(maxChars / 2);
    candidate = {
      ...payload,
      failures: payload.failures.map((f) => ({
        ...f,
        assertion_error: sanitizeStackTrace(f.assertion_error, maxChars),
      })),
    };
  }
  return candidate;
}
