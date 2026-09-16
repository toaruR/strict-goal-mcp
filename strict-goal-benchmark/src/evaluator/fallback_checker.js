/**
 * Two-stage fallback heuristic checker for non-AST test frameworks:
 * Stage 1: Line regex checking for skipping / commenting out test assertions.
 * Stage 2: Net line reduction rate check (> 15% net reduction of test lines).
 */
export function checkFallbackHeuristic(diffContent, originalTotalLines = 100) {
  if (!diffContent) return { suspicious: false, reasons: [] };

  const reasons = [];
  const lines = diffContent.split('\n');

  let addedLines = 0;
  let removedLines = 0;

  const heuristicRegex = /\b(skip|todo|disabled)\b|\/\*[\s\S]*?\*\/|^\s*\/\//;

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      addedLines++;
      const text = line.slice(1);
      if (heuristicRegex.test(text)) {
        reasons.push(`Suspicious comment or skip directive: "${text.trim().slice(0, 80)}"`);
      }
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removedLines++;
    }
  }

  // Net reduction rate check (> 15%)
  const netReduction = removedLines - addedLines;
  if (originalTotalLines > 0 && netReduction > 0) {
    const reductionRatio = netReduction / originalTotalLines;
    if (reductionRatio > 0.15) {
      reasons.push(`Test lines net reduction exceeds 15% threshold: ${(reductionRatio * 100).toFixed(1)}%`);
    }
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
  };
}
