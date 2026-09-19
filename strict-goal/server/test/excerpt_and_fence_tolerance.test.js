import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesExcerpt } from '../src/hash/digest.js';
import { verifyLocatorEvidence, verifyUpstreamEvidence } from '../src/evidence/verify.js';
import { parsePlanContent, stripMarkdownCodeFences } from '../src/artifact/plan_schema.js';

test('matchesExcerpt handles multiline excerpts across newlines and indentations', () => {
  const body = `
# Section 1. Overview
This is the first sentence of the specification.
  It continues on the second line with indentation.
And concludes on the third line.
`;

  // 1. 完全一致
  assert.ok(matchesExcerpt(body, 'This is the first sentence of the specification.'));

  // 2. 改行を跨ぐ引用
  assert.ok(
    matchesExcerpt(
      body,
      'This is the first sentence of the specification.\nIt continues on the second line with indentation.',
    ),
  );

  // 3. 改行がスペースに置換された引用
  assert.ok(
    matchesExcerpt(
      body,
      'This is the first sentence of the specification. It continues on the second line with indentation.',
    ),
  );

  // 4. 複数行にわたる3行分の引用
  assert.ok(
    matchesExcerpt(
      body,
      'It continues on the second line with indentation.\nAnd concludes on the third line.',
    ),
  );

  // 5. 本文にない文字列は false
  assert.ok(!matchesExcerpt(body, 'This sentence does not exist in the body.'));
});

test('verifyLocatorEvidence succeeds when excerpt spans multiple lines', () => {
  const artifactBody = 'Line 1: system architecture design.\nLine 2: high performance components.\nLine 3: end.';
  const evidence = {
    kind: 'locator',
    locator: '§1',
    excerpt: 'Line 1: system architecture design.\nLine 2: high performance components.',
  };

  assert.doesNotThrow(() => {
    verifyLocatorEvidence('arch_1', evidence, artifactBody);
  });
});

test('verifyUpstreamEvidence succeeds when excerpt has whitespace/newline variance', () => {
  const upstreamBody = 'Phase A requirement definition.\nPhase B implementation plan.';
  const evidence = {
    kind: 'upstream',
    upstream_locator: '§2',
    excerpt: 'Phase A requirement definition. Phase B implementation plan.',
  };

  assert.doesNotThrow(() => {
    verifyUpstreamEvidence('plan_1', evidence, 'plan', upstreamBody);
  });
});

test('stripMarkdownCodeFences unwraps ```json code fences', () => {
  const jsonText = '{\n  "plan_version": 1,\n  "summary": "test"\n}';
  const wrapped = `\`\`\`json\n${jsonText}\n\`\`\``;
  assert.equal(stripMarkdownCodeFences(wrapped), jsonText);

  const wrappedWithoutLang = `\`\`\`\n${jsonText}\n\`\`\``;
  assert.equal(stripMarkdownCodeFences(wrappedWithoutLang), jsonText);

  const raw = jsonText;
  assert.equal(stripMarkdownCodeFences(raw), jsonText);
});

test('parsePlanContent parses JSON wrapped in markdown code fences', () => {
  const validPlan = {
    plan_version: 1,
    summary: 'A valid plan summary with at least 40 characters for the plan schema.',
    tasks: [
      {
        id: 'T001',
        title: 'Task 1 title',
        intent: 'Task 1 intent description with at least 20 chars',
        design_refs: ['§1.1 Overview'],
        depends_on: [],
        changes: [{ path: 'src/main.js', kind: 'modify' }],
        acceptance: ['Acceptance criterion with >= 10 chars'],
        verify: [{ command: 'npm test', expect_exit_code: 0 }],
      },
    ],
  };

  const fenced = '```json\n' + JSON.stringify(validPlan, null, 2) + '\n```';
  const parsed = parsePlanContent(fenced);
  assert.equal(parsed.plan_version, 1);
  assert.equal(parsed.tasks[0].id, 'T001');
});

test('rubricAmend cleans up deleted criterion from session.last_evaluation.must_fix', async () => {
  const { loopOpenCreate } = await import('../src/tools/loop_open_create.js');
  const { scoreSubmit } = await import('../src/tools/score_submit.js');
  const { artifactCommit } = await import('../src/tools/artifact_commit.js');
  const { rubricAmend } = await import('../src/tools/rubric_amend.js');
  const { readSession } = await import('../src/store/session_store.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-test-amend-'));
  const persistence = { mode: 'durable', dir: tmpDir };

  // 1. セッション作成 (criteria: c1, c2)
  const criteria = [
    {
      id: 'c1',
      statement: 'Criterion 1 statement >= 10 chars',
      weight: 1,
      verification: 'manual',
      anchors: { 1: 'poor condition', 5: 'fair condition', 9: 'good condition' },
    },
    {
      id: 'c2',
      statement: 'Criterion 2 statement >= 10 chars',
      weight: 1,
      verification: 'manual',
      anchors: { 1: 'poor condition', 5: 'fair condition', 9: 'good condition' },
    },
  ];

  const opened = loopOpenCreate({
    input: {
      mode: 'create',
      submission_id: 'sub_open_1',
      task: 'Task description with at least twenty characters',
      artifact_kind: 'markdown',
      rubric: { criteria, policy: { pass_score: 9, min_first_round_must_fix: 1 } },
    },
    persistence,
  });

  const sessionId = opened.session_id;

  // 2. Round 1 コミット
  const commit1 = artifactCommit({
    input: {
      session_id: sessionId,
      submission_id: 'sub_commit_1',
      expected_round: 1,
      change_note: 'Initial commit for round 1 >= 20 chars',
      content: '# Initial design document body line 1\nLine 2',
    },
    persistence,
  });

  // 3. Round 1 スコア (c1=5, c2=9 -> must_fix: [c1])
  scoreSubmit({
    input: {
      session_id: sessionId,
      submission_id: 'sub_score_1',
      expected_round: 1,
      artifact_digest: commit1.artifact.digest,
      scores: [
        {
          criterion_id: 'c1',
          score: 5,
          rationale: 'Score 5 rationale tied to evidence >= 40 characters long',
          weakness: 'Weakness description >= 10 chars',
          evidence: [{ kind: 'locator', locator: '§1', excerpt: 'Initial design document body line 1' }],
        },
        {
          criterion_id: 'c2',
          score: 9,
          rationale: 'Score 9 rationale tied to evidence >= 40 characters long',
          weakness: 'Weakness description >= 10 chars',
          evidence: [{ kind: 'locator', locator: '§1', excerpt: 'Initial design document body line 1' }],
        },
      ],
    },
    persistence,
  });

  let session = readSession(tmpDir, sessionId);
  assert.equal(session.last_evaluation.must_fix[0].criterion_id, 'c1');

  // 4. rubric_amend で c1 を削除 (criteria: c2 のみ)
  rubricAmend({
    input: {
      session_id: sessionId,
      submission_id: 'sub_amend_1',
      expected_round: 2,
      reason: 'Removing criterion c1 for simplification >= 40 characters',
      acknowledge_relaxation: true,
      criteria: [criteria[1]], // c2 のみ
    },
    persistence,
  });

  session = readSession(tmpDir, sessionId);
  // c1 が must_fix から自動除外されていること
  assert.ok(!session.last_evaluation.must_fix.some((m) => m.criterion_id === 'c1'));

  // 5. Round 2 コミットで addresses に c1 を指定しなくても通ること！
  assert.doesNotThrow(() => {
    artifactCommit({
      input: {
        session_id: sessionId,
        submission_id: 'sub_commit_2',
        expected_round: 2,
        change_note: 'Round 2 commit without mentioning deleted c1 >= 20 chars',
        content: '# Revised design document body line 1\nLine 2',
        addresses: ['c2'],
      },
      persistence,
    });
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('verifyLocatorEvidence in fileset mode matches individual source file content', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rl-test-fileset-'));
  const srcFile = path.join(tmpDir, 'src', 'example.js');
  fs.mkdirSync(path.dirname(srcFile), { recursive: true });
  fs.writeFileSync(srcFile, 'export function calculateTotal(items) {\n  return items.reduce((a, b) => a + b, 0);\n}\n', 'utf8');

  const manifest = {
    files: [
      {
        path: 'src/example.js',
        sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        bytes: 100,
        role: 'source',
      },
    ],
  };

  const artifactBody = JSON.stringify(manifest, null, 2);
  const evidence = {
    kind: 'locator',
    locator: 'src/example.js:L2',
    excerpt: 'return items.reduce((a, b) => a + b, 0);',
  };

  // マニフェスト文字列には含まれないが、実ファイル src/example.js の本文に含まれているため受理される！
  assert.doesNotThrow(() => {
    verifyLocatorEvidence('code_clarity', evidence, artifactBody, { dataDir: tmpDir });
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

