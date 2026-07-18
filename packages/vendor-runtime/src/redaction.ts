const secretPatterns: readonly [RegExp, string][] = [
  [
    /\bAuthorization\s*[:=]\s*(?:(?:Bearer|Basic)\s+[^\s,;]+|[^\r\n,;]+)/giu,
    "Authorization=[redacted]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]"],
  [/\bBasic\s+[A-Za-z0-9+/=]+/giu, "Basic [redacted]"],
  [/\bCookie\s*[:=]\s*[^\r\n]+/giu, "Cookie=[redacted]"],
  [/\bSet-Cookie\s*[:=]\s*[^\r\n]+/giu, "Set-Cookie=[redacted]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[email-redacted]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, "[ip-redacted]"],
];

export function sanitizeRuntimeLogs(logs: string): string {
  let sanitized = logs.replace(/([?&])[^\s"']+/gu, "$1[query-redacted]");
  for (const [pattern, replacement] of secretPatterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}
