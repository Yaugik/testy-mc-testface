export interface BrowserConfigIssue {
  readonly code: "yaml-invalid" | "schema-invalid" | "package-invalid";
  readonly message: string;
  readonly filePath?: string;
  readonly instancePath?: string;
}

export class BrowserPackageValidationError extends Error {
  public constructor(public readonly issues: readonly BrowserConfigIssue[]) {
    super(
      [
        "Browser package validation failed:",
        ...issues.map((issue) =>
          [issue.filePath, issue.instancePath, issue.message]
            .filter(Boolean)
            .join(": "),
        ),
      ].join("\n"),
    );
    this.name = "BrowserPackageValidationError";
  }
}
