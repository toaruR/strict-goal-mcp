#!/usr/bin/env node
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { VERSION, NAME } from './src/version.js';
import { executeAndSanitize } from './src/implement/sanitize_test.js';

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function detectRole(filePath) {
  const p = filePath.toLowerCase();
  if (p.includes('/test/') || p.includes('\\test\\') || p.includes('.test.') || p.includes('.spec.') || p.startsWith('test/')) {
    return 'test';
  }
  if (p.endsWith('.md') || p.endsWith('.txt') || p.includes('/docs/') || p.startsWith('docs/')) {
    return 'doc';
  }
  if (p.endsWith('.json') || p.endsWith('.yaml') || p.endsWith('.yml') || p.includes('config') || p.startsWith('.')) {
    return 'config';
  }
  return 'source';
}

function computeManifestDigest(files) {
  const sorted = [...files].sort((a, b) => {
    const bufA = Buffer.from(a.path, 'utf8');
    const bufB = Buffer.from(b.path, 'utf8');
    return Buffer.compare(bufA, bufB);
  });
  const manifestText = sorted.map((f) => `${f.sha256}  ${f.path}\n`).join('');
  return sha256Hex(manifestText);
}

function collectFiles(inputs, baseDir = process.cwd()) {
  const result = [];
  for (const input of inputs) {
    const resolved = path.resolve(baseDir, input);
    if (!existsSync(resolved)) continue;
    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      const walk = (dir) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (entry.isFile()) {
            const rel = normalizePath(path.relative(baseDir, full));
            const content = readFileSync(full);
            result.push({
              path: rel,
              sha256: sha256Hex(content),
              bytes: content.length,
              role: detectRole(rel),
            });
          }
        }
      };
      walk(resolved);
    } else if (stat.isFile()) {
      const rel = normalizePath(path.relative(baseDir, resolved));
      const content = readFileSync(resolved);
      result.push({
        path: rel,
        sha256: sha256Hex(content),
        bytes: content.length,
        role: detectRole(rel),
      });
    }
  }
  return result;
}

function parseTestOutput(rawOutput, exitCode) {
  const lines = rawOutput.split('\n');
  const tests = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // ℹ で始まる spec レポーターのサマリ行、# で始まる TAP のコメント/
    // サマリ行（"# fail 1" 等）は実テスト結果行ではないため除外する。
    if (trimmed.startsWith('ℹ') || trimmed.startsWith('#')) continue;
    const passMatch = line.match(/(?:✔|ok|PASS)\s+(?:test at\s+)?([^\r\n]+)/i);
    const failMatch = line.match(/(?:✖|not ok|FAIL)\s+(?:test at\s+)?([^\r\n]+)/i);
    const skipMatch = line.match(/(?:skip|# SKIP)\s+([^\r\n]+)/i);

    if (passMatch) {
      passed += 1;
      tests.push({ id: `t_${tests.length + 1}`, file: 'test_suite', status: 'passed' });
    } else if (failMatch) {
      failed += 1;
      tests.push({ id: `t_${tests.length + 1}`, file: 'test_suite', status: 'failed' });
    } else if (skipMatch) {
      skipped += 1;
      tests.push({ id: `t_${tests.length + 1}`, file: 'test_suite', status: 'skipped' });
    }
  }

  // Fallback if no specific test lines matched
  if (tests.length === 0) {
    if (exitCode === 0) {
      passed = 1;
      tests.push({ id: 't_main', file: 'test_suite', status: 'passed' });
    } else {
      failed = 1;
      tests.push({ id: 't_main', file: 'test_suite', status: 'failed' });
    }
  }

  const total = passed + failed + skipped;
  return { counts: { total, passed, failed, skipped }, tests };
}

function runCommand(commandStr) {
  const isWin = process.platform === 'win32';
  const shell = isWin ? 'cmd.exe' : '/bin/sh';
  const flag = isWin ? '/c' : '-c';

  // NODE_TEST_CONTEXT を継承したままだと、自分自身が node --test 配下で
  // 実行されている場合にネストした `node --test` 呼び出しが「再帰呼び出し」
  // と誤検知されてスキップされ、exit 0 を返してしまう(Linux で顕著)。
  const { NODE_TEST_CONTEXT, ...env } = process.env;

  const res = spawnSync(shell, [flag, commandStr], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    env,
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const combined = stdout + (stderr ? `\n--- STDERR ---\n${stderr}` : '');
  const exitCode = res.status !== null ? res.status : (res.error ? 1 : 0);

  return { stdout, stderr, combined, exitCode };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`strict-goal helper utility

Usage:
  node strict-goal/server/helper.js version
    Prints the version of strict-goal.

  node strict-goal/server/helper.js fileset <path...>
    Computes files array, manifest_command, and manifest_output_sha256 for artifact_commit.

  node strict-goal/server/helper.js test-run <test command...>
    Runs test command and returns test_inventory & command_evidence ready for commit & score_submit.

  node strict-goal/server/helper.js sanitize-test <test command...>
    Runs test command, saves raw log to sessions/<id>/logs/, and returns sanitized output with capped error length.

  node strict-goal/server/helper.js digest <file>
    Computes sha256 of a file.
`);
    process.exit(0);
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`${NAME} ${VERSION}`);
    process.exit(0);
  }

  if (command === 'fileset') {
    const fileArgs = args.slice(1);
    if (fileArgs.length === 0) {
      console.error('Error: specify at least one file or directory');
      process.exit(1);
    }
    const files = collectFiles(fileArgs);
    const manifestDigest = computeManifestDigest(files);
    const cmdStr = `node strict-goal/server/helper.js fileset ${fileArgs.join(' ')}`;
    const output = {
      files,
      manifest_command: cmdStr,
      manifest_output_sha256: manifestDigest,
    };
    console.log(JSON.stringify(output, null, 2));
  } else if (command === 'test-run') {
    const testCmd = args.slice(1).join(' ');
    if (!testCmd) {
      console.error('Error: specify test command to run');
      process.exit(1);
    }
    const result = runCommand(testCmd);
    const outputSha = sha256Hex(result.combined);
    const parsed = parseTestOutput(result.combined, result.exitCode);

    const excerpt = result.combined.length > 3000
      ? result.combined.slice(-3000)
      : result.combined;

    const payload = {
      test_inventory: {
        source_command: testCmd,
        source_exit_code: result.exitCode,
        source_output_sha256: outputSha,
        counts: parsed.counts,
        tests: parsed.tests,
      },
      command_evidence: {
        kind: 'command',
        command: testCmd,
        exit_code: result.exitCode,
        output_sha256: outputSha,
        output_excerpt: excerpt.trim(),
        target_digest: '<fill_with_committed_artifact_digest>',
      },
    };
    console.log(JSON.stringify(payload, null, 2));
  } else if (command === 'sanitize-test') {
    const testCmd = args.slice(1).join(' ');
    if (!testCmd) {
      console.error('Error: specify test command to run');
      process.exit(1);
    }
    const result = runCommand(testCmd);
    const sanitized = executeAndSanitize(result);
    console.log(JSON.stringify(sanitized, null, 2));
    if (result.exitCode !== 0) {
      process.exit(result.exitCode || 1);
    }
  } else if (command === 'digest') {
    const targetFile = args[1];
    if (!targetFile) {
      console.error('Error: specify target file');
      process.exit(1);
    }
    const content = readFileSync(targetFile);
    console.log(sha256Hex(content));
  } else if (command === 'verify-doc') {
    const docPath = args[1];
    if (!docPath) {
      console.error('Error: specify document path to verify');
      process.exit(1);
    }
    const resolved = path.resolve(process.cwd(), docPath);
    if (!existsSync(resolved)) {
      console.error(`Error: file not found: ${resolved}`);
      process.exit(1);
    }
    const content = readFileSync(resolved, 'utf8');
    const lines = content.split(/\r?\n/);

    const headings = [];
    const sections = [];
    let currentHeading = null;
    let currentLevel = 0;
    let currentLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        if (currentHeading) {
          sections.push({
            heading: currentHeading,
            level: currentLevel,
            content: currentLines.join('\n').trim(),
          });
        }
        currentHeading = match[2].trim();
        currentLevel = match[1].length;
        headings.push({ heading: currentHeading, level: currentLevel });
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }
    if (currentHeading) {
      sections.push({
        heading: currentHeading,
        level: currentLevel,
        content: currentLines.join('\n').trim(),
      });
    }

    const weaknesses = [];
    if (headings.length === 0) {
      weaknesses.push('文書に見出しが存在しない');
    }

    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      const nextSec = sections[i + 1];
      const isParent = nextSec && nextSec.level > sec.level && sec.content.length === 0;
      if (!isParent && sec.content.length < 50) {
        weaknesses.push(`セクション「${sec.heading}」の記述が不十分（${sec.content.length}文字 < 50文字）`);
      }
    }

    const placeholderPatterns = [
      /\b(?:TODO|FIXME|TBD|WIP)\b/i,
      /【(?:未定|要検討|検討中|保留|後日)】/,
      /<<<.*?>>>/,
    ];
    for (const pattern of placeholderPatterns) {
      const m = content.match(pattern);
      if (m) {
        weaknesses.push(`未解決プレースホルダ検出: "${m[0]}"`);
      }
    }

    const ok = weaknesses.length === 0;
    const score = ok ? 9 : 6;
    const result = {
      ok,
      score,
      total_headings: headings.length,
      total_sections: sections.length,
      weaknesses,
      summary: ok
        ? '文書静的検証合格: 全セクション十分な文字数、未解決プレースホルダなし'
        : `文書静的検証不合格: ${weaknesses.length}件の不備を検出`,
    };

    console.log(JSON.stringify(result, null, 2));
    if (!ok) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
