import fs from 'node:fs';
import path from 'node:path';
import { sessionDir } from './session_store.js';
import { writeJson, readJson } from './atomic.js';

export function trialHistoryPath(dataDir, sessionId) {
  return path.join(sessionDir(dataDir, sessionId), 'trial_history.json');
}

export function loadTrialHistory(dataDir, sessionId) {
  const p = trialHistoryPath(dataDir, sessionId);
  if (!fs.existsSync(p)) {
    return {
      visited_files: [],
      failed_hypotheses: [],
      completed_tasks: [],
    };
  }
  try {
    const data = readJson(p);
    return {
      visited_files: Array.isArray(data.visited_files) ? data.visited_files : [],
      failed_hypotheses: Array.isArray(data.failed_hypotheses) ? data.failed_hypotheses : [],
      completed_tasks: Array.isArray(data.completed_tasks) ? data.completed_tasks : [],
    };
  } catch {
    return {
      visited_files: [],
      failed_hypotheses: [],
      completed_tasks: [],
    };
  }
}

export function saveTrialHistory(dataDir, sessionId, history) {
  const p = trialHistoryPath(dataDir, sessionId);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(p, history);
  return history;
}

export function recordVisitedFile(dataDir, sessionId, filePath) {
  const history = loadTrialHistory(dataDir, sessionId);
  const normalized = filePath.replace(/\\/g, '/');
  if (!history.visited_files.includes(normalized)) {
    history.visited_files.push(normalized);
    saveTrialHistory(dataDir, sessionId, history);
  }
  return history;
}

export function recordFailedHypothesis(dataDir, sessionId, hypothesis) {
  const history = loadTrialHistory(dataDir, sessionId);
  const trimmed = String(hypothesis).trim().slice(0, 100);
  if (trimmed && !history.failed_hypotheses.includes(trimmed)) {
    history.failed_hypotheses.push(trimmed);
    saveTrialHistory(dataDir, sessionId, history);
  }
  return history;
}

export function recordCompletedTask(dataDir, sessionId, taskId) {
  const history = loadTrialHistory(dataDir, sessionId);
  if (!history.completed_tasks.includes(taskId)) {
    history.completed_tasks.push(taskId);
    saveTrialHistory(dataDir, sessionId, history);
  }
  return history;
}
