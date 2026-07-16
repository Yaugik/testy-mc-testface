import { createHash } from "node:crypto";

export function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createBundleId(parts: readonly string[]): string {
  return sha256(parts.join("\n")).slice(0, 24);
}
