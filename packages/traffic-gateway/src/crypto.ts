import { createHash, timingSafeEqual } from "node:crypto";

export function fingerprint(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function tokenMatches(expectedHash: string, token: string | undefined): boolean {
  if (!token) return false;
  const actual = Buffer.from(fingerprint(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
}
