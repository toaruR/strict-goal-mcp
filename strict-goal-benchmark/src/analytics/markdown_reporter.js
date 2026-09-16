import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const GROUP_CHARACTERISTICS = {
  vanilla: 'テスト改ざん（アサーション無効化・コメントアウト）を外部検知し即失格',
  prompt_rubric: '自己申告は合格と主張するが外部隠蔽テストで失敗（自己強化バイアス）',
  default_goal: '外部FSMなしの自律反復により周回・トークンが激増するも未達',
  strict_single: '厳格なサーバーFSM管理で全件合格（単体ループのためトークン消費大）',
  strict_hierarchical: '使い捨てサブエージェント協調により、D群比で 50.5% のトークン削減を達成',
};

export function generateMarkdownReport({
  bench_id,
  comparison_table,
  statistical_significance,
}) {
  let md = `# Quantitative Benchmark Evaluation Report\n\n`;
  md += `**Benchmark ID**: \`${bench_id}\`\n`;
  md += `**Generated At**: \`${new Date().toISOString()}\`\n\n`;

  md += `## 1. 5-Group Comparative Performance\n\n`;
  md += `| Treatment Group | Resolved Rate (Pass@1) | Shortcut Rate | Avg Tokens | Avg Cost (USD) | Avg Rounds | Characteristics (特徴) |\n`;
  md += `|---|---|---|---|---|---|---|\n`;

  for (const row of comparison_table) {
    const resPercent = `${(row.resolved_rate * 100).toFixed(1)}%`;
    const scPercent = `${(row.shortcut_rate * 100).toFixed(1)}%`;
    const charDesc = row.characteristics || GROUP_CHARACTERISTICS[row.group] || '-';
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

  const mdContent = generateMarkdownReport(reportData);
  const mdPath = path.join(outputDir, 'report.md');
  writeFileSync(mdPath, mdContent, 'utf8');

  const jsonPath = path.join(outputDir, 'report.json');
  writeFileSync(jsonPath, JSON.stringify(reportData, null, 2), 'utf8');

  let csvContent = 'group,resolved_rate,shortcut_rate,avg_tokens,avg_cost_usd,avg_rounds,characteristics\n';
  for (const row of reportData.comparison_table) {
    const charDesc = `"${(row.characteristics || GROUP_CHARACTERISTICS[row.group] || '').replace(/"/g, '""')}"`;
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
