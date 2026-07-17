export type TestyCommand =
  | { readonly name: "validate-scenario"; readonly path: string }
  | { readonly name: "run"; readonly scenarioId: string }
  | { readonly name: "status"; readonly runId: string }
  | { readonly name: "cancel"; readonly runId: string }
  | { readonly name: "timeline"; readonly runId: string }
  | { readonly name: "report"; readonly runId: string }
  | { readonly name: "artifacts"; readonly runId: string }
  | { readonly name: "doctor" };

export function parseCommand(args: readonly string[]): TestyCommand {
  const [command, first, second] = args;
  if (command === "validate" && first === "scenario" && second) {
    return { name: "validate-scenario", path: second };
  }
  if (command === "run" && first) return { name: "run", scenarioId: first };
  if (command === "status" && first) return { name: "status", runId: first };
  if (command === "cancel" && first) return { name: "cancel", runId: first };
  if (command === "timeline" && first) return { name: "timeline", runId: first };
  if (command === "report" && first) return { name: "report", runId: first };
  if (command === "artifacts" && first) return { name: "artifacts", runId: first };
  if (command === "doctor" && first === undefined) return { name: "doctor" };
  throw new Error(usage());
}

export function controlPlaneUrl(
  baseUrl: string,
  path: string,
): string {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), normalized).toString();
}

export function usage(): string {
  return [
    "Usage:",
    "  testy validate scenario <path>",
    "  testy run <scenario-id>",
    "  testy status <run-id>",
    "  testy cancel <run-id>",
    "  testy timeline <run-id>",
    "  testy report <run-id>",
    "  testy artifacts <run-id>",
    "  testy doctor",
  ].join("\n");
}
