import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loopOpenCreate } from '../src/tools/loop_open_create.js';
import { loopOpenResume } from '../src/tools/loop_open_resume.js';
import { artifactCommit } from '../src/tools/artifact_commit.js';
import { scoreSubmit } from '../src/tools/score_submit.js';
import { readSession } from '../src/store/session_store.js';
import { appendIssueEvent, readIssueLedger } from '../src/evidence/issue_ledger.js';
import { pinSessionPolicy } from '../src/policy/session_policy.js';
import { persistEvaluationContext } from '../src/evidence/evaluation_context.js';
import { saveContentArtifact, saveFilesetArtifact, artifactStoredPath } from '../src/artifact/store.js';
import { computeManifestDigest, validateFilesetManifest } from '../src/artifact/fileset.js';
import { loopState } from '../src/tools/loop_state.js';
import { escalate } from '../src/tools/escalate.js';

let n = 0;
const id = () => `migration-${++n}`;
const rubric = { criteria: [{ id: 'works', statement: 'The implementation meets the stated requirement.', weight: 1, verification: 'manual', anchors: { 1: 'bad state', 5: 'fair state', 9: 'good state' } }] };
function setup(stage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-migration-'));
  const persistence = { mode: 'durable', source: 'test', dir, roundReductionStage: stage };
  const created = loopOpenCreate({ persistence, input: { mode: 'create', submission_id: id(), loop_mode: 'design', task: 'A sufficiently long session migration test task.', rubric } });
  const committed = artifactCommit({ persistence, input: { session_id: created.session_id, submission_id: id(), expected_round: 1, content: 'A precise piece of evidence for this test.', change_note: 'A sufficiently long change note for the artifact.' } });
  const input = { session_id: created.session_id, submission_id: id(), expected_round: 1, artifact_digest: committed.artifact.digest, scores: [{ criterion_id: 'works', score: 9, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: 'text', excerpt: 'A precise piece of evidence for this test.' }] }] };
  if (stage === 'enforce-new-session') input.evaluation_context = { snapshot: { artifact_digest: committed.artifact.digest, rubric_digest: readSession(dir, created.session_id).rubric_digest, scope_digest: `sha256:${'a'.repeat(64)}`, environment_digest: `sha256:${'b'.repeat(64)}`, test_selection_digest: `sha256:${'c'.repeat(64)}` }, condition_changes: [] };
  return { persistence, created, input, dir };
}

test('legacy session reloads and finalizes without requiring or writing a v2 ledger', () => {
  const { persistence, created, input, dir } = setup('v1');
  const sessionPath = path.join(dir, 'sessions', created.session_id, 'session.json');
  const disk = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  delete disk.evaluation_policy;
  fs.writeFileSync(sessionPath, JSON.stringify(disk));
  const loaded = readSession(dir, created.session_id);
  assert.equal(loaded.evaluation_policy.schema_version, 1);
  assert.equal(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).evaluation_policy, undefined);
  assert.equal(scoreSubmit({ persistence, input }).state, 'FINAL');
  assert.equal(readIssueLedger(dir, created.session_id).length, 0);
});

test('rollback affects only new sessions and existing v2 retains enforcement on resume', () => {
  const { persistence, created, input, dir } = setup('enforce-new-session');
  persistence.roundReductionStage = 'v1';
  loopOpenResume({ persistence, input: { mode: 'resume', submission_id: id(), session_id: created.session_id } });
  assert.equal(readSession(dir, created.session_id).evaluation_policy.stage, 'enforce-new-session');
  appendIssueEvent(dir, created.session_id, { issue_id: 'blocking', lifecycle: 'opened', severity: 'blocking', blocking: true, criterion_ids: ['works'], submission_id: id(), round: 1 });
  assert.throws(() => scoreSubmit({ persistence, input }), { code: 'E_ISSUE_STATE_INVALID' });
  assert.equal(pinSessionPolicy('v1').schema_version, 1);
  assert.throws(() => pinSessionPolicy('unknown'), { code: 'E_SESSION_POLICY_INVALID' });
});

test('v1 rejects v2 context and malformed pinned policies fail closed', () => {
  const { persistence, created, input, dir } = setup('v1');
  assert.throws(() => scoreSubmit({ persistence, input: { ...input, evaluation_context: { snapshot: {}, condition_changes: [] } } }), { code: 'E_SESSION_POLICY_INVALID' });
  const sessionPath = path.join(dir, 'sessions', created.session_id, 'session.json');
  const disk = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  disk.evaluation_policy = { schema_version: 1, policy_version: 'v1', stage: 'enforce-new-session' };
  fs.writeFileSync(sessionPath, JSON.stringify(disk));
  assert.throws(() => readSession(dir, created.session_id), { code: 'E_SESSION_POLICY_INVALID' });
});

test('observe-only records issues without changing v1 finalization', () => {
  const { persistence, created, input, dir } = setup('observe-only');
  appendIssueEvent(dir, created.session_id, { issue_id: 'blocking', lifecycle: 'opened', severity: 'blocking', blocking: true, criterion_ids: ['works'], submission_id: id(), round: 1 });
  const result = scoreSubmit({ persistence, input });
  assert.equal(result.state, 'FINAL');
  assert.equal(result.evaluation.issue_summary.unresolved_count, 1);
  const context = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', created.session_id, 'evaluation-context.json'), 'utf8'));
  assert.deepEqual(context.records[0].unknown_fields, ['scope_digest', 'environment_digest', 'test_selection_digest']);
});

test('enforced v2 rejects incomplete context, and successful evaluations persist fresh context keys', () => {
  const { persistence, created, input, dir } = setup('enforce-new-session');
  const { evaluation_context: ignored, ...withoutContext } = input;
  assert.throws(() => scoreSubmit({ persistence, input: { ...withoutContext, submission_id: id() } }), { code: 'E_EVALUATION_CONTEXT_INVALID' });
  const { environment_digest: ignoredEnvironment, ...incompleteSnapshot } = input.evaluation_context.snapshot;
  assert.throws(() => scoreSubmit({ persistence, input: { ...input, submission_id: id(), evaluation_context: { snapshot: incompleteSnapshot, condition_changes: [] } } }), { code: 'E_EVALUATION_CONTEXT_INVALID' });
  assert.equal(scoreSubmit({ persistence, input }).state, 'FINAL');
  const score = readSession(dir, created.session_id).last_evaluation.scores[0];
  assert.match(score.context_key, /^sha256:[0-9a-f]{64}$/);
  assert.equal(score.evaluation_basis, 'fresh');
});

test('dual-read reports v2 rejection candidates without enforcing them', () => {
  const { persistence, input } = setup('dual-read');
  input.scores[0] = { ...input.scores[0], score: 8, evidence: [{ kind: 'command', command: 'node --test', exit_code: 0, output_excerpt: 'passed', output_sha256: 'a'.repeat(64), target_digest: input.artifact_digest }] };
  const result = scoreSubmit({ persistence, input });
  assert.equal(result.state, 'DRAFTING');
  assert.ok(result.warnings.includes('v2_context_required'));
  assert.ok(result.warnings.includes('v2_E_ISSUE_BINDING_REQUIRED:works'));
});

test('dual-read warns on unapproved scope change without blocking v1 finalization', () => {
  const { persistence, created, input, dir } = setup('dual-read');
  const snapshot = { artifact_digest: input.artifact_digest, rubric_digest: readSession(dir, created.session_id).rubric_digest, scope_digest: `sha256:${'a'.repeat(64)}`, environment_digest: `sha256:${'b'.repeat(64)}`, test_selection_digest: `sha256:${'c'.repeat(64)}` };
  persistEvaluationContext(dir, created.session_id, { context: snapshot, invalidation: [], submission_id: id(), round: 0 });
  input.evaluation_context = { snapshot: { ...snapshot, scope_digest: `sha256:${'d'.repeat(64)}` }, condition_changes: [] };
  const result = scoreSubmit({ persistence, input });
  assert.equal(result.state, 'FINAL');
  assert.ok(result.warnings.includes('v2_E_SCOPE_APPROVAL_REQUIRED'));
});

test('public v2 scoring uses fresh evaluations when dependency declarations are unknown', () => {
  const { persistence, created, input, dir } = setup('enforce-new-session');
  const content = 'A precise piece of evidence for this test.';
  input.scores[0].score = 8;
  assert.equal(scoreSubmit({ persistence, input }).evaluation.per_criterion[0].evaluation_basis, 'fresh');
  const commit = (round, body) => artifactCommit({ persistence, input: { session_id: created.session_id, submission_id: id(), expected_round: round, content: body, change_note: 'A sufficiently long change note for this round.', addresses: ['works'] } });
  const same = commit(2, content);
  const second = { ...input, submission_id: id(), expected_round: 2, artifact_digest: same.artifact.digest };
  assert.equal(scoreSubmit({ persistence, input: second }).evaluation.per_criterion[0].evaluation_basis, 'fresh');
  const changed = commit(3, `${content}\nAdditional material alters the artifact.`);
  const third = { ...input, submission_id: id(), expected_round: 3, artifact_digest: changed.artifact.digest, evaluation_context: { ...input.evaluation_context, snapshot: { ...input.evaluation_context.snapshot, artifact_digest: changed.artifact.digest } } };
  assert.equal(scoreSubmit({ persistence, input: third }).evaluation.per_criterion[0].evaluation_basis, 'fresh');
  assert.equal(readSession(dir, created.session_id).last_evaluation.scores[0].evaluation_basis, 'fresh');
});

test('an unknown dependency declaration remains fresh on a matching second score', () => {
  const { persistence, created, input } = setup('enforce-new-session');
  input.scores[0].score = 8;
  scoreSubmit({ persistence, input });
  const committed = artifactCommit({ persistence, input: { session_id: created.session_id, submission_id: id(), expected_round: 2, content: 'A precise piece of evidence for this test.', change_note: 'A sufficiently long change note for this round.', addresses: ['works'] } });
  const result = scoreSubmit({ persistence, input: { ...input, submission_id: id(), expected_round: 2, artifact_digest: committed.artifact.digest } });
  assert.equal(result.evaluation.per_criterion[0].evaluation_basis, 'fresh');
});

function setupRebaseScores(ambiguous = false, fileset = false, corrupt = false, corruptOutput = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-rebase-'));
  const persistence = { mode: 'durable', source: 'test', dir, roundReductionStage: 'enforce-new-session' };
  const open = (rubricValue) => loopOpenCreate({ persistence, input: { mode: 'create', submission_id: id(), loop_mode: 'design', task: 'A sufficiently long task for rebase integration testing.', rubric: rubricValue } });
  const upstream = open(rubric);
  const items = [{ id: 'T001', description: 'original contract' }, { id: 'T002', description: 'stable contract' }];
  const oldPlan = JSON.stringify({ plan_version: 1, summary: 'unchanged', tasks: items });
  const upstreamDir = path.join(dir, 'sessions', upstream.session_id);
  const file = (name, hash) => ({ path: name, sha256: hash.repeat(64), bytes: 1, role: 'source' });
  const oldFiles = [file('src/a.js', 'a'), file('src/b.js', 'b')];
  // Seed immutable upstream fixtures directly; rebase and scoring below use public tools.
  const saveFiles = (files) => {
    const digest = `sha256:${computeManifestDigest(files)}`;
    const manifest = { files, manifest_command: 'fixture', manifest_output_sha256: digest.slice(7) };
    if (new Set(files.map((entry) => entry.path)).size === files.length) validateFilesetManifest(manifest);
    saveFilesetArtifact(upstreamDir, digest, manifest);
    return { digest, bytes: Buffer.byteLength(JSON.stringify(manifest)) };
  };
  const oldArtifact = fileset ? saveFiles(oldFiles) : saveContentArtifact(upstreamDir, 'plan', oldPlan);
  const upstreamPath = path.join(dir, 'sessions', upstream.session_id, 'session.json');
  const rawUpstream = JSON.parse(fs.readFileSync(upstreamPath, 'utf8'));
  rawUpstream.artifact_kind = fileset ? 'fileset' : 'plan';
  rawUpstream.state = 'FINAL';
  rawUpstream.current_artifact = { digest: oldArtifact.digest, bytes: oldArtifact.bytes };
  fs.writeFileSync(upstreamPath, JSON.stringify(rawUpstream));
  const twoRubric = { criteria: ['changed', 'stable'].map((criterionId) => ({ id: criterionId, statement: 'A clear requirement with sufficient detail to assess.', weight: 1, verification: 'manual', anchors: { 1: 'bad state', 5: 'fair state', 9: 'good state' } })) };
  const downstream = open(twoRubric);
  const downstreamPath = path.join(dir, 'sessions', downstream.session_id, 'session.json');
  const rawDownstream = JSON.parse(fs.readFileSync(downstreamPath, 'utf8'));
  rawDownstream.upstream = { session_id: upstream.session_id, artifact_digest: oldArtifact.digest };
  fs.writeFileSync(downstreamPath, JSON.stringify(rawDownstream));
  const content = 'A precise piece of evidence for this test.';
  const commit = (round, addresses) => artifactCommit({ persistence, input: { session_id: downstream.session_id, submission_id: id(), expected_round: round, content, change_note: 'A sufficiently long change note for this round.', ...(addresses ? { addresses } : {}) } });
  const firstCommit = commit(1);
  const snapshot = { artifact_digest: firstCommit.artifact.digest, rubric_digest: readSession(dir, downstream.session_id).rubric_digest, scope_digest: `sha256:${'a'.repeat(64)}`, environment_digest: `sha256:${'b'.repeat(64)}`, test_selection_digest: `sha256:${'c'.repeat(64)}` };
  const declaration = (contract) => ({ artifact_paths: fileset ? [contract] : [], upstream_contract_ids: fileset ? [] : [contract], scope_ids: [], rubric_clause_ids: [], evidence_kinds: ['locator'], verification_env_keys: [] });
  const score = (criterionId, value, contract) => ({ criterion_id: criterionId, score: value, rationale: 'a'.repeat(45), weakness: 'b'.repeat(15), evidence: [{ kind: 'locator', locator: 'text', excerpt: content }], dependency_declaration: declaration(contract) });
  const scores = [score('changed', 8, fileset ? 'src/a.js' : 'T001'), score('stable', 9, fileset ? 'src/b.js' : 'T002')];
  scoreSubmit({ persistence, input: { session_id: downstream.session_id, submission_id: id(), expected_round: 1, artifact_digest: firstCommit.artifact.digest, evaluation_context: { snapshot, condition_changes: [] }, scores } });
  const newTasks = [{ ...items[0], description: 'changed contract' }, items[1], ...(ambiguous ? [items[1]] : [])];
  const newFiles = [file('src/a.js', 'c'), oldFiles[1], ...(ambiguous ? [oldFiles[1]] : [])];
  const newArtifact = fileset ? saveFiles(newFiles) : saveContentArtifact(upstreamDir, 'plan', JSON.stringify({ plan_version: 1, summary: 'unchanged', tasks: newTasks }));
  if (corrupt) fs.writeFileSync(artifactStoredPath(upstreamDir, newArtifact.digest, 'fileset'), JSON.stringify({ files: oldFiles }));
  if (corruptOutput) {
    const stored = artifactStoredPath(upstreamDir, newArtifact.digest, 'fileset');
    const manifest = JSON.parse(fs.readFileSync(stored, 'utf8'));
    manifest.manifest_output_sha256 = '0'.repeat(64);
    fs.writeFileSync(stored, JSON.stringify(manifest));
  }
  rawUpstream.current_artifact = { digest: newArtifact.digest, bytes: newArtifact.bytes };
  fs.writeFileSync(upstreamPath, JSON.stringify(rawUpstream));
  loopState({ persistence, input: { session_id: downstream.session_id } });
  const rebase = escalate({ persistence, input: { session_id: downstream.session_id, submission_id: id(), action: 'rebase', upstream_digest: newArtifact.digest, note: 'a'.repeat(45) } });
  const session = readSession(dir, downstream.session_id);
  const committed = commit(session.round, ['changed']);
  const result = scoreSubmit({ persistence, input: { session_id: downstream.session_id, submission_id: id(), expected_round: session.round, artifact_digest: committed.artifact.digest, evaluation_context: { snapshot, condition_changes: [] }, scores } });
  return { rebase, session, result };
}

test('public rebase and scoring derive changed contracts from fixed bytes and mix fresh and reused criteria', () => {
  const { session, result } = setupRebaseScores();
  assert.deepEqual(session.verified_reuse.changed_keys, ['upstream:T001']);
  assert.deepEqual(session.verified_reuse.criterion_ids, ['stable']);
  assert.deepEqual(result.evaluation.per_criterion.map((c) => c.evaluation_basis), ['fresh', 'reused']);
});

test('ambiguous upstream IDs invalidate all criteria despite self-reported dependencies', () => {
  const { session, result } = setupRebaseScores(true);
  assert.equal(session.verified_reuse.changed_keys, null);
  assert.deepEqual(session.verified_reuse.criterion_ids, []);
  assert.deepEqual(result.evaluation.per_criterion.map((c) => c.evaluation_basis), ['fresh', 'fresh']);
});

test('public rebase and scoring derive file changes from committed manifest bytes', () => {
  const { session, result } = setupRebaseScores(false, true);
  assert.deepEqual(session.verified_reuse.changed_keys, ['artifact:src/a.js']);
  assert.deepEqual(session.verified_reuse.criterion_ids, ['stable']);
  assert.deepEqual(result.evaluation.per_criterion.map((c) => c.evaluation_basis), ['fresh', 'reused']);
});

test('ambiguous fileset paths or digest mismatch force fresh public evaluations', () => {
  for (const [ambiguous, corrupt, corruptOutput] of [[true, false, false], [false, true, false], [false, false, true]]) {
    const { session, result } = setupRebaseScores(ambiguous, true, corrupt, corruptOutput);
    assert.equal(session.verified_reuse.changed_keys, null);
    assert.deepEqual(session.verified_reuse.criterion_ids, []);
    assert.deepEqual(result.evaluation.per_criterion.map((c) => c.evaluation_basis), ['fresh', 'fresh']);
  }
});
