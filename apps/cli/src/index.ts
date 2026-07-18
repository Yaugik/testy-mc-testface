import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileVendorPackage,
  validateVendorPackage,
  VendorValidationError,
} from "@testy/vendor-compiler";
import { runImposterCapabilitySpike } from "@testy/vendor-runtime";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function usage(): never {
  console.error(
    [
      "Usage:",
      "  testy vendor validate <vendor-id>",
      "  testy vendor compile <vendor-id>",
      "  testy spike imposter",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [group, command, argument] = process.argv.slice(2);

  if (group === "spike" && command === "imposter" && argument === undefined) {
    const result = await runImposterCapabilitySpike(
      resolve(repositoryRoot, "infrastructure", "imposter", "spike"),
    );
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (group !== "vendor" || argument === undefined) {
    usage();
  }

  const vendorId = argument;
  const vendorDirectory = resolve(repositoryRoot, "vendors", vendorId);

  if (command === "validate") {
    await validateVendorPackage(vendorDirectory);
    console.log(`Vendor ${vendorId} is valid.`);
    return;
  }

  if (command === "compile") {
    const outputDirectory = resolve(
      repositoryRoot,
      "generated",
      "run_preview",
      "vendors",
      vendorId,
    );
    const result = await compileVendorPackage(vendorDirectory, outputDirectory);
    console.log(
      JSON.stringify(
        {
          vendorId,
          outputDirectory: result.outputDirectory,
          contentHash: result.contentHash,
        },
        null,
        2,
      ),
    );
    return;
  }

  usage();
}

main().catch((error: unknown) => {
  if (error instanceof VendorValidationError) {
    for (const diagnostic of error.diagnostics) {
      console.error(diagnostic);
    }
    process.exitCode = 1;
    return;
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
