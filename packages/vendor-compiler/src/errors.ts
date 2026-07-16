export interface CompilationIssue {
  readonly code: "unsupported-matcher" | "unsupported-fault" | "invalid-runtime-image";
  readonly message: string;
  readonly operationId?: string;
  readonly caseId?: string;
  readonly field?: string;
}

export class VendorCompilationError extends Error {
  public readonly issues: readonly CompilationIssue[];

  public constructor(issues: readonly CompilationIssue[]) {
    super(issues.map((issue) => issue.message).join("\n"));
    this.name = "VendorCompilationError";
    this.issues = issues;
  }
}
