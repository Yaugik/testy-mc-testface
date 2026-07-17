export class AssertionFailureError extends Error {
  public constructor(
    public readonly failedAssertionIds: readonly string[],
  ) {
    super(
      `${String(failedAssertionIds.length)} required assertion(s) failed: ${failedAssertionIds.join(", ")}.`,
    );
    this.name = "AssertionFailureError";
  }
}
