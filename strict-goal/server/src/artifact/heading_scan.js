// §3 改善2 / 改善4 の見出し走査。
// Markdown の ``` や ~~~ のコードフェンス内を除外して見出し行を走査する。
// 4スペースインデントのコードブロックは追わない（設計書の限界記述どおり）。

export function scanHeadings(content, tailRatio = 0.2) {
  if (typeof content !== 'string') return [];
  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const headings = [];
  let inFence = false;
  let fenceChar = '';

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    const fenceMatch = trimmed.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
        fenceChar = '';
      }
      continue;
    }

    if (inFence) {
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const isTail = totalLines > 0 && (totalLines - i) / totalLines <= tailRatio + 1e-9;
      headings.push({
        raw: line,
        title: headingMatch[1].trim(),
        lineIndex: i,
        isTail,
      });
    }
  }

  return headings;
}
