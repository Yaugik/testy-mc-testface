export interface VisitorSelection {
  networkId: string;
  personId?: string;
  browserId: string;
}

export function visitorSelectionChanged(
  applied: VisitorSelection,
  draft: VisitorSelection,
): boolean {
  return (
    applied.networkId !== draft.networkId ||
    (applied.personId || "") !== (draft.personId || "") ||
    applied.browserId !== draft.browserId
  );
}

export function isDemoDiagnostic(name: string, status: string): boolean {
  return (
    status === "completed" &&
    [
      "synthetic-site-events",
      "gateway-ledger-summary",
      "provider-ledger-summary",
      "target-outcome",
    ].includes(name)
  );
}
