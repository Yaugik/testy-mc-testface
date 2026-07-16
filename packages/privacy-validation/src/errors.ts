import type { PrivacyValidationIssue } from "./types.js";

export class PrivacyValidationError extends Error {
  public readonly issues: readonly PrivacyValidationIssue[];

  public constructor(issues: readonly PrivacyValidationIssue[]) {
    super(
      [
        "Vendor privacy validation failed:",
        ...issues.map(
          (issue) =>
            `${issue.filePath}${issue.pointer ? `#${issue.pointer}` : ""}: ${issue.message}`,
        ),
      ].join("\n"),
    );
    this.name = "PrivacyValidationError";
    this.issues = issues;
  }
}
