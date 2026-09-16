import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { handleToolsCall } from '../src/mcp/tools_call.js';
import { clearRegistryForTests } from '../src/store/session_registry.js';
import { readSession, writeSession, sessionExists } from '../src/store/session_store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, '..', '..');

test.beforeEach(() => {
  clearRegistryForTests();
});

test('workspace_dir allows dynamic session creation in specified workspace', () => {
  const ws1 = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ws1-'));
  const ws2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ws2-'));
  const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-default-'));
  const persistence = { mode: 'persistent', dir: defaultDir, source: 'cli_flag' };

  try {
    // 1. Create session in WS1
    const res1 = handleToolsCall({
      name: 'loop_open',
      arguments: {
        mode: 'create',
        submission_id: 'sub_create_ws1_test',
        workspace_dir: ws1,
        loop_mode: 'design',
        task: 'Testing dynamic workspace persistence in ws1 1234567890',
        rubric_preset: 'design',
      },
    }, { pluginRoot, persistence });

    assert.equal(res1.isError, undefined);
    const s1 = res1.structuredContent;
    assert.equal(s1.ok, true);
    assert.ok(s1.session_id);

    // Verify s1 is saved in ws1/.strict-goal
    const ws1StrictGoal = path.join(ws1, '.strict-goal');
    assert.ok(sessionExists(ws1StrictGoal, s1.session_id), 's1 exists in ws1/.strict-goal');
    assert.equal(sessionExists(defaultDir, s1.session_id), false, 's1 does not exist in defaultDir');

    // 2. Create session in WS2
    const res2 = handleToolsCall({
      name: 'loop_open',
      arguments: {
        mode: 'create',
        submission_id: 'sub_create_ws2_test',
        workspace_dir: ws2,
        loop_mode: 'design',
        task: 'Testing dynamic workspace persistence in ws2 1234567890',
        rubric_preset: 'design',
      },
    }, { pluginRoot, persistence });

    assert.equal(res2.isError, undefined);
    const s2 = res2.structuredContent;
    assert.equal(s2.ok, true);
    assert.ok(s2.session_id);

    // Verify s2 is saved in ws2/.strict-goal
    const ws2StrictGoal = path.join(ws2, '.strict-goal');
    assert.ok(sessionExists(ws2StrictGoal, s2.session_id), 's2 exists in ws2/.strict-goal');
    assert.equal(sessionExists(ws1StrictGoal, s2.session_id), false, 's2 does not exist in ws1/.strict-goal');
    assert.equal(sessionExists(defaultDir, s2.session_id), false, 's2 does not exist in defaultDir');

    // 3. Invoke loop_state on s1 WITHOUT workspace_dir
    const stateRes1 = handleToolsCall({
      name: 'loop_state',
      arguments: {
        session_id: s1.session_id,
      },
    }, { persistence });

    assert.equal(stateRes1.isError, undefined);
    assert.equal(stateRes1.structuredContent.ok, true);
    assert.equal(stateRes1.structuredContent.session_id, s1.session_id);

    // 4. Invoke artifact_commit on s1 WITHOUT workspace_dir
    const commitRes1 = handleToolsCall({
      name: 'artifact_commit',
      arguments: {
        session_id: s1.session_id,
        submission_id: 'sub_commit_ws1_test',
        expected_round: 1,
        content: '# Test WS1 Artifact\nLine 2 content here for test.\nLine 3 content here for test.',
        change_note: 'Initial draft of WS1 artifact for dynamic persistence verification testing.',
      },
    }, { persistence });

    assert.equal(commitRes1.isError, undefined);
    assert.equal(commitRes1.structuredContent.ok, true);

    // Confirm session in ws1 was updated
    const updatedS1 = readSession(ws1StrictGoal, s1.session_id);
    assert.equal(updatedS1.state, 'SCORING');
    assert.ok(updatedS1.current_artifact);

    // 5. Resume s1 with workspace_dir
    const resumeRes1 = handleToolsCall({
      name: 'loop_open',
      arguments: {
        mode: 'resume',
        submission_id: 'sub_resume_ws1_test',
        session_id: s1.session_id,
        workspace_dir: ws1,
      },
    }, { persistence });

    assert.equal(resumeRes1.isError, undefined);
    assert.equal(resumeRes1.structuredContent.ok, true);
    assert.equal(resumeRes1.structuredContent.resumed, true);

  } finally {
    fs.rmSync(ws1, { recursive: true, force: true });
    fs.rmSync(ws2, { recursive: true, force: true });
    fs.rmSync(defaultDir, { recursive: true, force: true });
  }
});

test('downstream session inherits workspace_dir from upstream session_id', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-ws-upstream-'));
  const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-default-'));
  const persistence = { mode: 'persistent', dir: defaultDir, source: 'cli_flag' };

  try {
    // 1. Create upstream design session in ws
    const resDesign = handleToolsCall({
      name: 'loop_open',
      arguments: {
        mode: 'create',
        submission_id: 'sub_create_design_upstream',
        workspace_dir: ws,
        loop_mode: 'design',
        task: 'Upstream design task description 1234567890',
        rubric_preset: 'design',
      },
    }, { pluginRoot, persistence });

    assert.equal(resDesign.isError, undefined);
    const sDesign = resDesign.structuredContent;

    // Commit artifact
    const commitDesign = handleToolsCall({
      name: 'artifact_commit',
      arguments: {
        session_id: sDesign.session_id,
        submission_id: 'sub_commit_design_upstream',
        expected_round: 1,
        content: '# Upstream Design Spec\nDetailed specification contents here.',
        change_note: 'Initial commit of design specification for upstream inheritance.',
      },
    }, { persistence });

    assert.equal(commitDesign.isError, undefined);
    const digest = commitDesign.structuredContent.artifact.digest;
    assert.ok(digest);

    // Set upstream session to FINAL state in ws/.strict-goal so validatePin accepts it
    const wsStrictGoal = path.join(ws, '.strict-goal');
    const upstreamSession = readSession(wsStrictGoal, sDesign.session_id);
    upstreamSession.state = 'FINAL';
    writeSession(wsStrictGoal, upstreamSession);

    // 2. Open downstream plan session WITHOUT specifying workspace_dir (only upstream)
    const resPlan = handleToolsCall({
      name: 'loop_open',
      arguments: {
        mode: 'create',
        submission_id: 'sub_create_plan_downstream',
        loop_mode: 'plan',
        task: 'Downstream plan task description 1234567890',
        upstream: {
          session_id: sDesign.session_id,
          artifact_digest: digest,
        },
        rubric_preset: 'plan',
      },
    }, { pluginRoot, persistence });

    assert.equal(resPlan.isError, undefined);
    const sPlan = resPlan.structuredContent;
    assert.equal(sPlan.ok, true);

    // Verify plan session is created in ws/.strict-goal, NOT in defaultDir
    assert.ok(sessionExists(wsStrictGoal, sPlan.session_id), 'plan session is in ws/.strict-goal');
    assert.equal(sessionExists(defaultDir, sPlan.session_id), false, 'plan session is not in defaultDir');

  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(defaultDir, { recursive: true, force: true });
  }
});

