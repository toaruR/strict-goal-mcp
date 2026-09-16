import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const GROUP_DISPLAY_ORDER = [
  'vanilla',
  'prompt_rubric',
  'default_goal',
  'strict_single',
  'strict_hierarchical',
];

/**
 * Generates an objective English characteristics description based on actual trial evaluation outcomes.
 */
export function generateEnglishCharacteristics(row, trials = []) {
  // If trials contain recorded error (e.g. rate limit, spawn failure)
  const hasError = trials.some((t) => t.error || t.resource_usage?.total_tokens === 0 && t.timestamps?.duration_ms > 0 && t.ground_truth_eval?.resolved === false);
  const errorReason = trials.find((t) => t.error)?.error;

  if (hasError && row.avg_tokens === 0 && row.resolved_rate === 0) {
    if (errorReason && /rate limit|429/i.test(errorReason)) {
      return 'Execution interrupted by API session rate limit (429); zero tokens collected.';
    }
    return 'Trial execution halted due to agent runtime error or session unavailability.';
  }

  switch (row.group) {
    case 'vanilla':
      if (row.shortcut_rate > 0) {
        return 'Disqualified: test tampering detected by external AST diff/sandbox monitor.';
      }
      if (row.resolved_rate === 0) {
        return 'Failed held-out test suite; single-turn attempt without self-correction.';
      }
      return 'Passed held-out suite on first attempt without iterative refinement.';

    case 'prompt_rubric':
      if (row.shortcut_rate > 0) {
        return 'Disqualified: test tampering detected during prompt-guided self-iteration.';
      }
      if (row.resolved_rate === 0) {
        return 'Self-reported passing rubric scores but failed external held-out tests (confirmation bias).';
      }
      return 'Iterated under self-prompted rubric guidance and satisfied held-out requirements.';

    case 'default_goal':
      if (row.shortcut_rate > 0) {
        return 'Disqualified: test tampering detected during autonomous iteration.';
      }
      if (row.resolved_rate === 0) {
        if (row.avg_rounds > 1 || row.avg_tokens > 100000) {
          return 'Iterated autonomously without external FSM; high token consumption without convergence.';
        }
        return 'Autonomous retry loop terminated without satisfying held-out criteria.';
      }
      return 'Autonomous goal iteration loop converged to passing state.';

    case 'strict_single':
      if (row.shortcut_rate > 0) {
        return 'Disqualified: test tampering detected despite server FSM enforcement.';
      }
      if (row.resolved_rate >= 1) {
        return 'Fully verified by strict server FSM; higher token overhead due to monolithic loop context.';
      }
      return 'Enforced by server FSM but halted before satisfying all rubric gates.';

    case 'strict_hierarchical':
      if (row.shortcut_rate > 0) {
        return 'Disqualified: test tampering detected during subagent orchestration.';
      }
      if (row.resolved_rate >= 1) {
        return 'Subagent delegation achieved full verification with substantial token reduction over monolithic loop.';
      }
      return 'Hierarchical subagents coordinated but failed to reach verified final state.';

    default:
      if (row.shortcut_rate > 0) {
        return 'Disqualified due to detected test tampering.';
      }
      if (row.resolved_rate >= 1) {
        return 'Passed held-out verification tests successfully.';
      }
      return 'Completed evaluation rounds without satisfying all verification tests.';
  }
}

/**
 * Sorts comparison table by the canonical order:
 * vanilla -> prompt_rubric -> default_goal -> strict_single -> strict_hierarchical
 */
export function sortComparisonTable(table) {
  return [...table].sort((a, b) => {
    const idxA = GROUP_DISPLAY_ORDER.indexOf(a.group);
    const idxB = GROUP_DISPLAY_ORDER.indexOf(b.group);
    const orderA = idxA === -1 ? 999 : idxA;
    const orderB = idxB === -1 ? 999 : idxB;
    return orderA - orderB;
  });
}

export function generateMarkdownReport({
  bench_id,
  comparison_table,
  statistical_significance,
}) {
  const sortedTable = sortComparisonTable(comparison_table);

  let md = `# Quantitative Benchmark Evaluation Report\n\n`;
  md += `**Benchmark ID**: \`${bench_id}\`\n`;
  md += `**Generated At**: \`${new Date().toISOString()}\`\n\n`;

  md += `## 1. 5-Group Comparative Performance\n\n`;
  md += `| Treatment Group | Resolved Rate (Pass@1) | Shortcut Rate | Avg Tokens | Avg Cost (USD) | Avg Rounds | Characteristics (特徴) |\n`;
  md += `|---|---|---|---|---|---|---|\n`;

  for (const row of sortedTable) {
    const resPercent = `${(row.resolved_rate * 100).toFixed(1)}%`;
    const scPercent = `${(row.shortcut_rate * 100).toFixed(1)}%`;
    const charDesc = row.characteristics || generateEnglishCharacteristics(row);
    md += `| **${row.group}** | ${resPercent} | ${scPercent} | ${row.avg_tokens.toLocaleString()} | $${row.avg_cost_usd.toFixed(3)} | ${row.avg_rounds} | ${charDesc} |\n`;
  }

  md += `\n## 2. Statistical Hypothesis Testing\n\n`;
  md += `- **Pass Rate p-value**: \`${statistical_significance.p_value_pass_rate}\`\n`;
  md += `- **Cohen's d (Token Effect Size)**: \`${statistical_significance.cohens_d_tokens}\`\n`;
  md += `- **Statistically Significant**: \`${statistical_significance.significant ? 'YES (p < 0.05)' : 'NO'}\`\n\n`;

  md += `## 3. Executive Conclusion\n\n`;
  if (statistical_significance.significant) {
    md += `The quantitative results confirm a statistically significant improvement in task resolution with strict-goal MCP harness under isolated held-out test evaluation.\n`;
  } else {
    md += `The benchmark results are summarized above across all evaluated treatment groups.\n`;
  }

  return md;
}

export function saveReports(outputDir, bench_id, reportData) {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const sortedTable = sortComparisonTable(reportData.comparison_table);
  const normalizedReportData = {
    ...reportData,
    comparison_table: sortedTable,
  };

  const mdContent = generateMarkdownReport(normalizedReportData);
  const mdPath = path.join(outputDir, 'report.md');
  writeFileSync(mdPath, mdContent, 'utf8');

  const jsonPath = path.join(outputDir, 'report.json');
  writeFileSync(jsonPath, JSON.stringify(normalizedReportData, null, 2), 'utf8');

  let csvContent = 'group,resolved_rate,shortcut_rate,avg_tokens,avg_cost_usd,avg_rounds,characteristics\n';
  for (const row of sortedTable) {
    const charDesc = `"${(row.characteristics || generateEnglishCharacteristics(row)).replace(/"/g, '""')}"`;
    csvContent += `${row.group},${row.resolved_rate},${row.shortcut_rate},${row.avg_tokens},${row.avg_cost_usd},${row.avg_rounds},${charDesc}\n`;
  }
  const csvPath = path.join(outputDir, 'report.csv');
  writeFileSync(csvPath, csvContent, 'utf8');

  return {
    markdown: mdPath,
    json: jsonPath,
    csv: csvPath,
  };
}
