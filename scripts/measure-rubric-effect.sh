#!/usr/bin/env bash
# §5 効果測定スクリプト: 5群の成果物バイト数・見出し数・範囲外見出し数・ラウンド数を TSV で出力する。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Header (5 columns)
HEADER="group	document_bytes	heading_count	out_of_scope_sections	rounds"
echo -e "$HEADER"

if [ "${1:-}" = "--dry-run" ]; then
  exit 0
fi

SCOPE_TERMS="配布,CI,運用手順,自己適用,レビュー記録"
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    exit 0
  elif [[ "$arg" =~ ^--scope[-_]guard[-_]terms=(.*)$ ]]; then
    SCOPE_TERMS="${BASH_REMATCH[1]}"
  elif [ "$arg" != "--scope-guard-terms" ] && [ "$arg" != "--scope_guard_terms" ] && [[ ! "$arg" =~ ^-- ]]; then
    SCOPE_TERMS="$arg"
  fi
done

node -e '
const fs = require("fs");
const path = require("path");

const scopeTermsArg = process.argv[1] || "";
const scopeTerms = scopeTermsArg ? scopeTermsArg.split(",").map(s => s.trim()).filter(Boolean) : [];

const benchmarkRuns = path.join(".benchmark", "runs");
if (!fs.existsSync(benchmarkRuns)) {
  process.exit(0);
}

for (const b of fs.readdirSync(benchmarkRuns)) {
  const trialsDir = path.join(benchmarkRuns, b, "trials");
  if (!fs.existsSync(trialsDir)) continue;

  for (const f of fs.readdirSync(trialsDir)) {
    const m = f.match(/^specification_(.+)_[0-9A-Z]{26}\.md$/);
    if (!m) continue;
    const group = m[1];
    const trialMatch = f.match(/_([0-9A-Z]{26})\.md$/);
    const trialId = trialMatch ? trialMatch[1] : null;

    const fullPath = path.join(trialsDir, f);
    const stat = fs.statSync(fullPath);
    if (stat.size < 100) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    const lines = content.split(/\r?\n/);
    let headings = 0;
    let outOfScope = 0;
    let inFence = false;

    for (const line of lines) {
      const trimmed = line.trimStart();
      if (/^(```+|~~~+)/.test(trimmed)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      if (/^#{1,6}\s+/.test(trimmed)) {
        headings++;
        if (scopeTerms.some(t => trimmed.includes(t))) {
          outOfScope++;
        }
      }
    }

    let rounds = 1;
    if (trialId) {
      const sbSessionDir = path.join(".benchmark", "sandboxes", `tr_${trialId}`, ".strict-goal", "sessions");
      if (fs.existsSync(sbSessionDir)) {
        for (const s of fs.readdirSync(sbSessionDir)) {
          const sJson = path.join(sbSessionDir, s, "session.json");
          if (fs.existsSync(sJson)) {
            try {
              const parsed = JSON.parse(fs.readFileSync(sJson, "utf8"));
              if (parsed.round) rounds = parsed.round;
            } catch {}
          }
        }
      }
    }

    console.log([group, stat.size, headings, outOfScope, rounds].join("\t"));
  }
}
' "$SCOPE_TERMS"
