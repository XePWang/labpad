export interface DiagnosticCounts {
  warnings: number;
  errors: number;
}
export function diagnosticCounts(stdout: string, stderr = ''): DiagnosticCounts {
  const counts = { warnings: 0, errors: 0 };
  for (const line of (stdout + '\n' + stderr).split(/\r?\n/)) {
    const match = line.match(
      /^(?:(?:.*?:\d+(?::\d+)?|.+\(\d+(?:,\d+)?\)|[^\s:"()]+):\s*)?(fatal error|error|warning|错误|警告)(?:\s+[A-Z]\d+)?\s*[:：]/i,
    );
    if (!match || /^\s*(?:\d+\s*\||\||\^)/.test(line)) continue;
    if (/warning|警告/i.test(match[1])) counts.warnings++;
    else counts.errors++;
  }
  return counts;
}

/** IPC serializes errors as messages; recognize only the parser's canonical diagnostic header. */
export function isLpmakeDiagnostic(text: string): boolean {
  return /^LPMake\.txt:\d+:\d+: error: [^\r\n]+(?:\r?\n|$)/.test(text);
}
