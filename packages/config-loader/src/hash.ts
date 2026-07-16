import { createHash } from "node:crypto";

export interface HashInput {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
}

export function hashPackage(inputs: readonly HashInput[]): string {
  const hash = createHash("sha256");

  for (const input of [...inputs].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    const pathBytes = Buffer.from(input.relativePath, "utf8");
    const contentBytes =
      typeof input.content === "string"
        ? Buffer.from(input.content, "utf8")
        : Buffer.from(input.content);

    hash.update(String(pathBytes.byteLength));
    hash.update(":");
    hash.update(pathBytes);
    hash.update(":");
    hash.update(String(contentBytes.byteLength));
    hash.update(":");
    hash.update(contentBytes);
    hash.update("\n");
  }

  return hash.digest("hex");
}
