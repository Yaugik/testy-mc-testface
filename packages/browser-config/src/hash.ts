import { createHash } from "node:crypto";

export function hashBrowserPackage(
  files: readonly { readonly relativePath: string; readonly content: string }[],
): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  )) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}
