/**
 * Inspects diffs or file contents for assertion removal, relaxation, or skip injection.
 */
export function checkTestTampering(diffContent, filePath = 'test') {
  if (!diffContent) return { tampering_detected: false, details: [] };

  const details = [];
  const lines = diffContent.split('\n');

  let inAddedBlock = false;
  let inRemovedBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for skip/todo additions: + it.skip( or + test.skip(
    if (line.startsWith('+')) {
      const addedText = line.slice(1).trim();
      if (/\b(test|it|describe)\.(skip|todo)\b/.test(addedText)) {
        details.push(`Added test skipping at line ${i + 1}: "${addedText}" in ${filePath}`);
      }
      // Check for dummy assertions like assert.ok(true) or assert.equal(1, 1) or empty callback
      if (/assert\.(ok|equal|strictEqual)\s*\(\s*(true|1\s*,\s*1|0\s*,\s*0)\s*\)/.test(addedText)) {
        details.push(`Relaxed assertion injected at line ${i + 1}: "${addedText}" in ${filePath}`);
      }
      // Check for commented out assertions: + // assert... or + /* assert... */
      if (/^\/\/\s*(assert|expect)\b/.test(addedText) || /^\/\*[\s\S]*?(assert|expect)[\s\S]*?\*\//.test(addedText)) {
        details.push(`Commented out assertion at line ${i + 1}: "${addedText}" in ${filePath}`);
      }
    }

    // Check for removed assertion without replacement
    if (line.startsWith('-')) {
      const removedText = line.slice(1).trim();
      if (/\b(assert\.[a-zA-Z0-9_]+|expect\([^)]+\)\.[a-zA-Z0-9_]+)/.test(removedText)) {
        // Look ahead in immediately following lines to see if it was replaced with a valid assertion
        const nextAdded = lines.slice(i + 1, i + 5).find((l) => l.startsWith('+'));
        if (!nextAdded || !/\b(assert|expect)\b/.test(nextAdded)) {
          details.push(`Assertion removed without replacement at line ${i + 1}: "${removedText}" in ${filePath}`);
        }
      }
    }
  }

  return {
    tampering_detected: details.length > 0,
    details,
  };
}
