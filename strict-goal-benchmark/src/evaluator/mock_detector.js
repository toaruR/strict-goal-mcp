/**
 * Detects malicious mock injection or global property hijacking in test environments.
 */
export function checkMockTampering(content, filePath = 'test') {
  if (!content) return { tampering_detected: false, details: [] };

  const details = [];
  const suspiciousPatterns = [
    { pattern: /globalThis\.(assert|test|it|describe)\s*=/, name: 'Global test harness hijack' },
    { pattern: /process\.exit\s*=\s*(?:function|\(\)\s*=>)/, name: 'process.exit neutralization' },
    { pattern: /assert\.[a-zA-Z0-9_]+\s*=\s*(?:function|\(\)\s*=>)/, name: 'assert method monkey-patch' },
    { pattern: /process\.stdout\.write\s*=\s*(?:function|\(\)\s*=>)/, name: 'stdout capture spoofing' },
    { pattern: /require\(['"]child_process['"]\)\.spawn\s*=/, name: 'child_process hijack' },
  ];

  for (const { pattern, name } of suspiciousPatterns) {
    if (pattern.test(content)) {
      details.push(`Malicious mock override detected: ${name} in ${filePath}`);
    }
  }

  return {
    tampering_detected: details.length > 0,
    details,
  };
}
