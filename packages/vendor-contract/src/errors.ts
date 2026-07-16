export class VendorContractValidationError extends Error {
  public constructor(public readonly issues: readonly string[]) {
    super(["Vendor contract validation failed:", ...issues].join("\n"));
    this.name = "VendorContractValidationError";
  }
}
