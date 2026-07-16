export type PrivacyIssueCode =
  | "credential-like-value"
  | "live-credential-pattern"
  | "private-key-material"
  | "real-email-address"
  | "unsafe-domain"
  | "unsafe-ip-address";

export interface PrivacyValidationIssue {
  readonly code: PrivacyIssueCode;
  readonly message: string;
  readonly filePath: string;
  readonly pointer?: string;
  readonly line?: number;
  readonly fingerprint?: string;
}

export interface PrivacyValidationReport {
  readonly schemaVersion: "1.0";
  readonly rootDirectory: string;
  readonly passed: boolean;
  readonly scannedFiles: number;
  readonly issues: readonly PrivacyValidationIssue[];
}

export interface PrivacyValidationOptions {
  readonly includeExtensions?: readonly string[];
  readonly allowedDomainSuffixes?: readonly string[];
}
