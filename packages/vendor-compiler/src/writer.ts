import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { CompiledVendorBundle, WrittenVendorBundle } from "./types.js";

export async function writeVendorBundle(
  bundle: CompiledVendorBundle,
  outputRoot: string,
): Promise<WrittenVendorBundle> {
  const resolvedOutputRoot = resolve(outputRoot);
  const finalDirectory = join(resolvedOutputRoot, bundle.bundleId);
  const temporaryDirectory = join(
    resolvedOutputRoot,
    `.tmp-${bundle.bundleId}-${randomUUID()}`,
  );

  await mkdir(temporaryDirectory, { recursive: true });

  try {
    for (const file of bundle.files) {
      const destination = safeDestination(temporaryDirectory, file.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, file.content, { flag: "wx" });
    }

    await mkdir(resolvedOutputRoot, { recursive: true });
    await rm(finalDirectory, { recursive: true, force: true });
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    ...bundle,
    rootDirectory: finalDirectory,
    configDirectory: join(finalDirectory, "imposter"),
    manifestPath: join(finalDirectory, "manifest.json"),
    sourceMapPath: join(finalDirectory, "source-map.json"),
  };
}

function safeDestination(rootDirectory: string, relativePath: string): string {
  if (isAbsolute(relativePath)) {
    throw new Error(`Bundle file path '${relativePath}' must be relative.`);
  }

  const resolvedRoot = resolve(rootDirectory);
  const destination = resolve(resolvedRoot, relativePath);
  const relativeDestination = relative(resolvedRoot, destination);

  if (
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${sep}`) ||
    isAbsolute(relativeDestination)
  ) {
    throw new Error(`Bundle file path '${relativePath}' escapes the output directory.`);
  }

  return destination;
}
