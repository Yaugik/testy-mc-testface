#!/usr/bin/env node
import { resolve } from "node:path";

import { scanVendorPackagePrivacy } from "./scanner.js";

const packagePath = resolve(process.argv[2] ?? "vendors/ipinfo");
const report = await scanVendorPackagePrivacy(packagePath);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.passed) {
  process.exitCode = 1;
}
