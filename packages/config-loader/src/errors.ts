export interface SourceLocation {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly instancePath?: string;
}

export interface ValidationIssue {
  readonly code:
    | "yaml-invalid"
    | "schema-invalid"
    | "package-invalid"
    | "asset-invalid";
  readonly message: string;
  readonly location?: SourceLocation;
}

export class VendorPackageValidationError extends Error {
  public readonly issues: readonly ValidationIssue[];

  public constructor(issues: readonly ValidationIssue[]) {
    super(formatIssues(issues));
    this.name = "VendorPackageValidationError";
    this.issues = issues;
  }
}

function formatIssues(issues: readonly ValidationIssue[]): string {
  const details = issues.map((issue) => {
    const location = issue.location
      ? `${issue.location.filePath}:${issue.location.line}:${issue.location.column}: `
      : "";

    return `${location}${issue.message}`;
  });

  return ["Vendor package validation failed:", ...details].join("\n");
}
