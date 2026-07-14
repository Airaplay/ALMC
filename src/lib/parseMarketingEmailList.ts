const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Split pasted lists: newlines, commas, semicolons, tabs. */
export function parseMarketingEmailList(raw: string): {
  valid: string[];
  invalid: string[];
} {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (EMAIL_RE.test(token)) {
      valid.push(token);
    } else {
      invalid.push(token);
    }
  }

  return { valid, invalid };
}
