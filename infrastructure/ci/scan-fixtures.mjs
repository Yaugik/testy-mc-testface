import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots = ["vendors", "customers", "scenarios"].map((directory) =>
  resolve(repositoryRoot, directory),
);
const supportedExtensions = new Set([".json", ".yaml", ".yml", ".txt", ".html"]);
const findings = [];

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && supportedExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function isAllowedIpv4(ip) {
  const [a, b, c, d] = ip.split(".").map(Number);
  if ([a, b, c, d].some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true;
  return (
    a === 10 ||
    a === 127 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function scan(file, source) {
  const display = relative(repositoryRoot, file);

  for (const match of source.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    if (!isAllowedIpv4(match[0])) findings.push(`${display}: publicly routable IPv4 ${match[0]}`);
  }

  for (const match of source.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
    const domain = match[1].toLowerCase();
    if (!domain.endsWith(".example") && !domain.endsWith(".test") && !domain.endsWith(".invalid")) {
      findings.push(`${display}: non-synthetic email ${match[0]}`);
    }
  }

  for (const match of source.matchAll(/\b(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})\b/gi)) {
    const domain = match[1].toLowerCase();
    if (
      !domain.endsWith(".example") &&
      !domain.endsWith(".test") &&
      !domain.endsWith(".invalid") &&
      domain !== "json-schema.org"
    ) {
      findings.push(`${display}: non-reserved domain ${domain}`);
    }
  }

  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /\b(?:password|secret|api[_-]?key)\s*[:=]\s*["']?(?!synthetic|example|test)[^\s"']+/i,
  ];
  for (const pattern of credentialPatterns) {
    if (pattern.test(source)) findings.push(`${display}: possible credential matching ${pattern}`);
  }
}

for (const root of roots) {
  for (const file of await walk(root)) {
    scan(file, await readFile(file, "utf8"));
  }
}

if (findings.length > 0) {
  console.error("Synthetic fixture scan failed:\n" + findings.map((finding) => `- ${finding}`).join("\n"));
  process.exit(1);
}

console.log("Synthetic fixture scan passed.");
