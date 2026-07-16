import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";

import { parse as parseYaml } from "yaml";

import { PrivacyValidationError } from "./errors.js";
import type {
  PrivacyValidationIssue,
  PrivacyValidationOptions,
  PrivacyValidationReport,
} from "./types.js";

const DEFAULT_EXTENSIONS = [".json", ".yaml", ".yml"] as const;
const DEFAULT_ALLOWED_SUFFIXES = [".example", ".test", ".invalid"] as const;
const SENSITIVE_KEY = /(?:^|[-_.])(authorization|api[-_]?key|password|secret|token)(?:$|[-_.])/iu;
const SYNTHETIC_VALUE = /(?:test|synthetic|example|dummy|fake|invalid|redacted|placeholder)/iu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,63})\b/giu;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const DOMAIN_PATTERN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/giu;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu;
const LIVE_CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/gu,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/gu,
  /\bsk_live_[A-Za-z0-9]{16,}\b/gu,
  /\bsk-[A-Za-z0-9]{24,}\b/gu,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  /\bAIza[0-9A-Za-z_-]{35}\b/gu,
  /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/gu,
];

export async function scanVendorPackagePrivacy(
  packagePath: string,
  options: PrivacyValidationOptions = {},
): Promise<PrivacyValidationReport> {
  const rootDirectory = resolve(packagePath);
  const extensions = new Set(
    (options.includeExtensions ?? DEFAULT_EXTENSIONS).map((value) =>
      value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`,
    ),
  );
  const allowedDomainSuffixes = normalizeAllowedSuffixes(
    options.allowedDomainSuffixes ?? DEFAULT_ALLOWED_SUFFIXES,
  );
  const filePaths = await listFiles(rootDirectory, extensions);
  const issues: PrivacyValidationIssue[] = [];

  for (const filePath of filePaths) {
    const content = await readFile(filePath, "utf8");
    const relativePath = normalizePath(relative(rootDirectory, filePath));
    issues.push(...scanRawContent(content, relativePath));

    try {
      const parsed =
        extname(filePath).toLowerCase() === ".json"
          ? (JSON.parse(content) as unknown)
          : (parseYaml(content) as unknown);
      issues.push(
        ...scanStructuredValue(parsed, relativePath, allowedDomainSuffixes),
      );
    } catch {
      // Syntax validation belongs to the package loader. Raw secret scanning still ran.
    }
  }

  return {
    schemaVersion: "1.0",
    rootDirectory,
    passed: issues.length === 0,
    scannedFiles: filePaths.length,
    issues: deduplicateIssues(issues),
  };
}

export async function validateVendorPackagePrivacy(
  packagePath: string,
  options: PrivacyValidationOptions = {},
): Promise<PrivacyValidationReport> {
  const report = await scanVendorPackagePrivacy(packagePath, options);
  if (!report.passed) {
    throw new PrivacyValidationError(report.issues);
  }
  return report;
}

export function scanStructuredValue(
  value: unknown,
  filePath: string,
  allowedDomainSuffixes: readonly string[] = DEFAULT_ALLOWED_SUFFIXES,
): readonly PrivacyValidationIssue[] {
  const issues: PrivacyValidationIssue[] = [];
  visitValue(
    value,
    filePath,
    "",
    undefined,
    normalizeAllowedSuffixes(allowedDomainSuffixes),
    issues,
  );
  return deduplicateIssues(issues);
}

function visitValue(
  value: unknown,
  filePath: string,
  pointer: string,
  key: string | undefined,
  allowedDomainSuffixes: readonly string[],
  issues: PrivacyValidationIssue[],
): void {
  if (typeof value === "string") {
    scanString(value, filePath, pointer || "/", key, allowedDomainSuffixes, issues);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      visitValue(
        entry,
        filePath,
        `${pointer}/${index}`,
        key,
        allowedDomainSuffixes,
        issues,
      ),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      visitValue(
        childValue,
        filePath,
        `${pointer}/${escapePointer(childKey)}`,
        childKey,
        allowedDomainSuffixes,
        issues,
      );
    }
  }
}

function scanString(
  value: string,
  filePath: string,
  pointer: string,
  key: string | undefined,
  allowedDomainSuffixes: readonly string[],
  issues: PrivacyValidationIssue[],
): void {
  if (
    key &&
    SENSITIVE_KEY.test(key) &&
    value.length >= 8 &&
    !SYNTHETIC_VALUE.test(value)
  ) {
    issues.push({
      code: "credential-like-value",
      filePath,
      pointer,
      fingerprint: fingerprint(value),
      message: `Sensitive field '${key}' contains a value that is not visibly synthetic.`,
    });
  }

  for (const match of value.matchAll(EMAIL_PATTERN)) {
    const domain = (match[1] ?? "").toLowerCase();
    if (!isAllowedDomain(domain, allowedDomainSuffixes)) {
      issues.push({
        code: "real-email-address",
        filePath,
        pointer,
        fingerprint: fingerprint(match[0]),
        message: `Email address uses non-synthetic domain '${domain}'.`,
      });
    }
  }

  for (const match of value.matchAll(IPV4_PATTERN)) {
    if (!isAllowedIpv4(match[0])) {
      issues.push({
        code: "unsafe-ip-address",
        filePath,
        pointer,
        fingerprint: fingerprint(match[0]),
        message:
          "IP address is outside the approved documentation ranges and localhost.",
      });
    }
  }

  for (const match of value.matchAll(DOMAIN_PATTERN)) {
    const domain = match[0].toLowerCase();
    if (
      !isAllowedDomain(domain, allowedDomainSuffixes) &&
      !looksLikeEmailDomainMatch(value, match.index ?? 0) &&
      !looksLikeFileReference(value, match.index ?? 0, domain)
    ) {
      issues.push({
        code: "unsafe-domain",
        filePath,
        pointer,
        fingerprint: fingerprint(domain),
        message: `Domain '${domain}' is outside approved synthetic suffixes.`,
      });
    }
  }
}

function scanRawContent(
  content: string,
  filePath: string,
): readonly PrivacyValidationIssue[] {
  const issues: PrivacyValidationIssue[] = [];
  for (const match of content.matchAll(PRIVATE_KEY_PATTERN)) {
    issues.push({
      code: "private-key-material",
      filePath,
      line: lineNumber(content, match.index ?? 0),
      fingerprint: fingerprint(match[0]),
      message: "Private key material is prohibited in vendor fixtures.",
    });
  }

  for (const pattern of LIVE_CREDENTIAL_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      issues.push({
        code: "live-credential-pattern",
        filePath,
        line: lineNumber(content, match.index ?? 0),
        fingerprint: fingerprint(match[0]),
        message: "Value matches a known live credential format.",
      });
    }
  }
  return issues;
}

function isAllowedIpv4(value: string): boolean {
  const octets = value.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const [first, second, third] = octets as [number, number, number, number];
  return (
    first === 127 ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isAllowedDomain(
  domain: string,
  allowedDomainSuffixes: readonly string[],
): boolean {
  return allowedDomainSuffixes.some(
    (suffix) => domain === suffix.slice(1) || domain.endsWith(suffix),
  );
}

function normalizeAllowedSuffixes(values: readonly string[]): readonly string[] {
  return values.map((value) => {
    const normalized = value.toLowerCase().replace(/^\*?/u, "");
    return normalized.startsWith(".") ? normalized : `.${normalized}`;
  });
}

function looksLikeEmailDomainMatch(value: string, index: number): boolean {
  return index > 0 && value[index - 1] === "@";
}

function looksLikeFileReference(
  value: string,
  index: number,
  candidate: string,
): boolean {
  const previous = index > 0 ? value[index - 1] : undefined;
  return (
    previous === "/" ||
    /\.(?:json|ya?ml|js|mjs|cjs|html?|css|txt|md)$/iu.test(candidate)
  );
}

async function listFiles(
  directory: string,
  extensions: ReadonlySet<string>,
): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(path, extensions)));
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      paths.push(path);
    }
  }
  return paths;
}

function deduplicateIssues(
  issues: readonly PrivacyValidationIssue[],
): readonly PrivacyValidationIssue[] {
  const values = new Map<string, PrivacyValidationIssue>();
  for (const issue of issues) {
    const key = [
      issue.code,
      issue.filePath,
      issue.pointer ?? "",
      issue.line ?? "",
      issue.fingerprint ?? "",
    ].join("\u0000");
    values.set(key, issue);
  }
  return [...values.values()].sort((left, right) =>
    `${left.filePath}:${left.pointer ?? ""}:${left.code}`.localeCompare(
      `${right.filePath}:${right.pointer ?? ""}:${right.code}`,
    ),
  );
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function normalizePath(value: string): string {
  return value.split(sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
