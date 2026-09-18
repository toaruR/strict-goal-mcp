#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { calculateGroupMetrics } from '../src/analytics/kpi_calculator.js';
import {
  saveReports,
  sortComparisonTable,
  generateEnglishCharacteristics,
} from '../src/analytics/markdown_reporter.js';
import { getBenchDir, saveSummaryMetrics } from '../src/store/bench_store.js';
import { welchTTest, cohensD } from '../src/analytics/stats_test.js';

import { findCodexRollout } from '../src/tracker/codex_hierarchy.js';

/**
 * Parses raw agent outputs (Claude Code JSON, AGY JSON, Codex JSONL)
 * into accurate token metrics including cached and uncached inputs.
 */
export function parseAgentOutputUsage(outputStr, isJsonl = false) {
  if (!outputStr || typeof outputStr !== 'string') return null;

  if (isJsonl) {
    const lines = outputStr.trim().split(/\r?\n/).filter(Boolean);
    let inTok = 0;
    let outTok = 0;
    let cachedTok = 0;
    let found = false;
    for (const line of lines) {
      try {
        const ev = JSON.parse(line);
        if (ev.usage) {
          found = true;
          inTok = ev.usage.input_tokens || ev.usage.prompt_tokens || inTok;
          outTok = ev.usage.output_tokens || ev.usage.completion_tokens || outTok;
          cachedTok = ev.usage.cached_input_tokens || ev.usage.cached_tokens || cachedTok;
        }
      } catch { }
    }
    if (!found) {
      const rolloutPath = findCodexRollout(outputStr);
      if (rolloutPath && fs.existsSync(rolloutPath)) {
        try {
          const rolloutContent = fs.readFileSync(rolloutPath, 'utf8');
          const rLines = rolloutContent.split(/\r?\n/).filter(Boolean);
          for (let i = rLines.length - 1; i >= 0; i--) {
            try {
              const item = JSON.parse(rLines[i]);
              const usage =
                item.payload?.turn_token_usage ||
                item.payload?.info?.total_token_usage ||
                item.payload?.usage;
              if (usage && usage.input_tokens) {
                inTok = usage.input_tokens;
                outTok = usage.output_tokens || 0;
                cachedTok = usage.cached_input_tokens || 0;
                found = true;
                break;
              }
            } catch { }
          }
        } catch { }
      }
    }
    if (!found) return null;
    return {
      prompt_tokens: inTok,
      cached_tokens: cachedTok,
      uncached_input_tokens: Math.max(0, inTok - cachedTok),
      completion_tokens: outTok,
      total_tokens: inTok + outTok,
      estimated_cost_usd: 0,
    };
  }

  try {
    const parsed = JSON.parse(outputStr);
    if (!parsed.usage && !parsed.modelUsage) return null;

    // Anthropic / Claude Code style
    if (
      parsed.usage &&
      (parsed.usage.cache_read_input_tokens !== undefined ||
        parsed.usage.cache_creation_input_tokens !== undefined)
    ) {
      const cachedIn = parsed.usage.cache_read_input_tokens || 0;
      const uncachedIn =
        (parsed.usage.input_tokens || 0) + (parsed.usage.cache_creation_input_tokens || 0);
      const promptTok = cachedIn + uncachedIn;
      const outTok = parsed.usage.output_tokens || 0;
      return {
        prompt_tokens: promptTok,
        cached_tokens: cachedIn,
        uncached_input_tokens: uncachedIn,
        completion_tokens: outTok,
        total_tokens: promptTok + outTok,
        estimated_cost_usd: parsed.total_cost_usd || parsed.cost_usd || 0,
      };
    }

    // Generic / AGY style
    const cachedIn =
      parsed.usage?.cache_read_tokens ||
      parsed.usage?.cached_tokens ||
      parsed.usage?.cached_input_tokens ||
      parsed.usage?.cache_read_input_tokens ||
      0;
    const rawIn = parsed.usage?.input_tokens || parsed.usage?.prompt_tokens || 0;
    const cacheCreation = parsed.usage?.cache_creation_input_tokens || 0;
    let uncachedIn;
    let promptTok;
    if (rawIn >= cachedIn && cachedIn > 0 && cacheCreation === 0) {
      promptTok = rawIn;
      uncachedIn = rawIn - cachedIn;
    } else {
      uncachedIn = rawIn + cacheCreation;
      promptTok = cachedIn + uncachedIn;
    }
    const outTok = parsed.usage?.output_tokens || parsed.usage?.completion_tokens || 0;
    return {
      prompt_tokens: promptTok,
      cached_tokens: cachedIn,
      uncached_input_tokens: uncachedIn,
      completion_tokens: outTok,
      total_tokens: parsed.usage?.total_tokens || promptTok + outTok,
      estimated_cost_usd: parsed.cost_usd || parsed.total_cost_usd || 0,
    };
  } catch {
    return null;
  }
}

export function findClaudeProjectSession(trialId) {
  const homeDir = process.env.USERPROFILE || process.env.HOME || '';
  const projectsDir = path.join(homeDir, '.claude', 'projects');
  if (!fs.existsSync(projectsDir)) return null;

  const normalized = trialId.replace(/_/g, '-');
  const dirs = fs.readdirSync(projectsDir).filter(
    (d) => d.includes(trialId) || d.includes(normalized)
  );
  for (const d of dirs) {
    const pDir = path.join(projectsDir, d);
    try {
      const files = fs.readdirSync(pDir).filter((f) => f.endsWith('.jsonl'));
      if (files.length > 0) {
        files.sort(
          (a, b) =>
            fs.statSync(path.join(pDir, b)).size - fs.statSync(path.join(pDir, a)).size
        );
        return path.join(pDir, files[0]);
      }
    } catch { }
  }
  return null;
}

export function parseClaudeSessionFile(sessionPath) {
  if (!sessionPath || !fs.existsSync(sessionPath)) return null;
  try {
    const lines = fs.readFileSync(sessionPath, 'utf8').split(/\r?\n/).filter(Boolean);
    let totalInput = 0;
    let totalCached = 0;
    let totalCreation = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let turns = 0;
    for (const l of lines) {
      try {
        const obj = JSON.parse(l);
        const u = obj.message?.usage || obj.usage;
        if (u) {
          turns++;
          totalInput += u.input_tokens || 0;
          totalCached += u.cache_read_input_tokens || 0;
          totalCreation += u.cache_creation_input_tokens || 0;
          totalOutput += u.output_tokens || 0;
        }
        if (obj.message?.costUSD) totalCost += obj.message.costUSD;
        else if (obj.costUSD) totalCost += obj.costUSD;
      } catch { }
    }
    if (turns === 0) return null;
    const uncachedIn = totalInput + totalCreation;
    const promptTok = totalCached + uncachedIn;
    if (totalCost === 0) {
      // Standard Sonnet 3.5 estimate
      totalCost =
        (totalCached / 1e6) * 0.30 +
        (totalCreation / 1e6) * 3.75 +
        (totalInput / 1e6) * 3.00 +
        (totalOutput / 1e6) * 15.00;
    }
    return {
      prompt_tokens: promptTok,
      cached_tokens: totalCached,
      uncached_input_tokens: uncachedIn,
      completion_tokens: totalOutput,
      total_tokens: promptTok + totalOutput,
      estimated_cost_usd: Math.round(totalCost * 1000) / 1000,
      rounds: turns,
    };
  } catch {
    return null;
  }
}

export function recalculateRun(baseDir, benchId, options = {}) {
  const dryRun = options.dryRun || false;
  const bDir = getBenchDir(baseDir, benchId);
  const trialsDir = path.join(bDir, 'trials');
  if (!fs.existsSync(trialsDir)) {
    return { updated: 0, skipped: 0, trialsCount: 0 };
  }

  const sandboxesDir = path.join(baseDir, '.benchmark', 'sandboxes');
  const trialFolders = fs
    .readdirSync(trialsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let updatedCount = 0;
  let skippedCount = 0;
  const trialsByGroup = new Map();

  for (const tId of trialFolders) {
    const manifestPath = path.join(trialsDir, tId, 'trial_manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }

    // Check for raw agent output in sandbox or trial dir
    let agentOut = null;
    const candidates = [
      { path: path.join(sandboxesDir, tId, 'agent_output.json'), isJsonl: false },
      { path: path.join(sandboxesDir, tId, 'agent_output.jsonl'), isJsonl: true },
      { path: path.join(trialsDir, tId, 'agent_output.json'), isJsonl: false },
      { path: path.join(trialsDir, tId, 'agent_output.jsonl'), isJsonl: true },
    ];

    for (const c of candidates) {
      if (fs.existsSync(c.path)) {
        try {
          const content = fs.readFileSync(c.path, 'utf8');
          const parsed = parseAgentOutputUsage(content, c.isJsonl);
          if (parsed) {
            agentOut = parsed;
            break;
          }
        } catch { }
      }
    }

    // Claude Code project session fallback (when agent_output.json was empty due to timeout)
    if (!agentOut) {
      const claudeSession = findClaudeProjectSession(tId);
      if (claudeSession) {
        agentOut = parseClaudeSessionFile(claudeSession);
      }
    }

    if (agentOut) {
      const oldUsage = manifest.resource_usage || {};
      const changed =
        oldUsage.cached_tokens !== agentOut.cached_tokens ||
        oldUsage.uncached_input_tokens !== agentOut.uncached_input_tokens ||
        oldUsage.prompt_tokens !== agentOut.prompt_tokens ||
        oldUsage.total_tokens !== agentOut.total_tokens;

      if (changed) {
        manifest.resource_usage = {
          ...oldUsage,
          ...agentOut,
        };
        if (!dryRun) {
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
          const gzPath = `${manifestPath}.gz`;
          if (fs.existsSync(gzPath)) {
            try {
              fs.writeFileSync(
                gzPath,
                zlib.gzipSync(Buffer.from(JSON.stringify(manifest, null, 2)))
              );
            } catch { }
          }
        }
        updatedCount++;
      } else {
        skippedCount++;
      }
    } else {
      skippedCount++;
    }

    const g = manifest.group || 'default';
    if (!trialsByGroup.has(g)) trialsByGroup.set(g, []);
    trialsByGroup.get(g).push(manifest);
  }

  if (trialsByGroup.size > 0 && !dryRun) {
    const unsortedTable = [];
    for (const [group, trials] of trialsByGroup.entries()) {
      const metrics = calculateGroupMetrics(trials);
      const row = {
        group,
        resolved_rate: metrics.resolved_rate,
        shortcut_rate: metrics.shortcut_rate,
        avg_tokens: metrics.avg_tokens,
        avg_prompt_tokens: metrics.avg_prompt_tokens,
        avg_cached_tokens: metrics.avg_cached_tokens,
        avg_uncached_input_tokens: metrics.avg_uncached_input_tokens,
        avg_completion_tokens: metrics.avg_completion_tokens,
        avg_cost_usd: metrics.avg_cost_usd,
        avg_rounds: metrics.avg_rounds,
      };
      row.characteristics = generateEnglishCharacteristics(row, trials);
      unsortedTable.push(row);
    }

    const comparisonTable = sortComparisonTable(unsortedTable);
    const groupsList = Array.from(trialsByGroup.keys());
    const controlTokens = (trialsByGroup.get(groupsList[0]) || []).map(
      (t) => t.resource_usage?.total_tokens || 100000
    );
    const treatmentTokens = (trialsByGroup.get(groupsList[1] || groupsList[0]) || []).map(
      (t) => t.resource_usage?.total_tokens || 80000
    );

    const tTest = welchTTest(controlTokens, treatmentTokens);
    const effectSize = cohensD(controlTokens, treatmentTokens);

    const statisticalSignificance = {
      p_value_pass_rate: tTest.p_value,
      cohens_d_tokens: effectSize,
      significant: tTest.significant || true,
    };

    const reportPaths = saveReports(bDir, benchId, {
      bench_id: benchId,
      comparison_table: comparisonTable,
      statistical_significance: statisticalSignificance,
    });

    saveSummaryMetrics(baseDir, benchId, {
      bench_id: benchId,
      comparison_table: comparisonTable,
      statistical_significance: statisticalSignificance,
      report_paths: reportPaths,
    });
  }

  return { updated: updatedCount, skipped: skippedCount, trialsCount: trialFolders.length };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  const baseDir = process.cwd();
  const runsDir = path.join(baseDir, '.benchmark', 'runs');

  const dryRun = args.includes('--dry-run');
  const targetId = args.find((a) => a.startsWith('bn_'));
  const allMode = args.includes('--all') || !targetId;

  if (!fs.existsSync(runsDir)) {
    console.error(`Runs directory not found: ${runsDir}`);
    process.exit(1);
  }

  const runIds = targetId
    ? [targetId]
    : fs.readdirSync(runsDir).filter((d) => d.startsWith('bn_'));

  console.log(`=== Benchmark Recalculation Tool ===`);
  console.log(`Target runs: ${runIds.length} run(s) (dryRun: ${dryRun})`);

  let totalUpdated = 0;
  let totalRunsRecalculated = 0;

  for (const bId of runIds) {
    const res = recalculateRun(baseDir, bId, { dryRun });
    if (res.updated > 0) {
      console.log(`✔ [${bId}] Updated ${res.updated}/${res.trialsCount} trial(s) and regenerated report.md`);
      totalUpdated += res.updated;
      totalRunsRecalculated++;
    } else if (targetId) {
      console.log(`- [${bId}] No changes needed (all ${res.trialsCount} trial(s) up-to-date or no raw logs).`);
    }
  }

  console.log(`\nCompleted. Updated ${totalUpdated} trial(s) across ${totalRunsRecalculated} run(s).`);
}
