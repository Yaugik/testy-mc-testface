import type { MatchExpression, MatchScalar } from "@testy/vendor-schema";

import type { CompilationIssue } from "./errors.js";

export interface CompiledRequestMatchers {
  readonly pathParams?: Readonly<Record<string, unknown>>;
  readonly queryParams?: Readonly<Record<string, unknown>>;
  readonly requestHeaders?: Readonly<Record<string, unknown>>;
  readonly formParams?: Readonly<Record<string, unknown>>;
  readonly requestBody?: Readonly<Record<string, unknown>>;
}

export function compileRequestMatchers(
  values: Readonly<Record<string, MatchExpression>>,
  context: { readonly operationId: string; readonly caseId: string },
  issues: CompilationIssue[],
): CompiledRequestMatchers {
  const pathParams: Record<string, unknown> = {};
  const queryParams: Record<string, unknown> = {};
  const requestHeaders: Record<string, unknown> = {};
  const formParams: Record<string, unknown> = {};
  let requestBody: Readonly<Record<string, unknown>> | undefined;

  for (const [field, expression] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    const compiled = compileMatchExpression(expression, field, context, issues);
    if (compiled === undefined) {
      continue;
    }

    const separator = field.indexOf(".");
    const location = separator === -1 ? field : field.slice(0, separator);
    const name = separator === -1 ? "" : field.slice(separator + 1);

    switch (location) {
      case "path":
        assignMatcher(pathParams, name, compiled, field, context, issues);
        break;
      case "query":
        assignMatcher(queryParams, name, compiled, field, context, issues);
        break;
      case "header":
        assignMatcher(requestHeaders, name, compiled, field, context, issues);
        break;
      case "form":
        assignMatcher(formParams, name, compiled, field, context, issues);
        break;
      case "body":
        if (name !== "raw") {
          addUnsupported(field, context, issues, "Only body.raw is supported by compiler v0.1.");
        } else {
          requestBody = toLongForm(compiled);
        }
        break;
      default:
        addUnsupported(field, context, issues, `Unknown matcher location '${location}'.`);
    }
  }

  return {
    ...(Object.keys(pathParams).length > 0 ? { pathParams } : {}),
    ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
    ...(Object.keys(requestHeaders).length > 0 ? { requestHeaders } : {}),
    ...(Object.keys(formParams).length > 0 ? { formParams } : {}),
    ...(requestBody ? { requestBody } : {}),
  };
}

function assignMatcher(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
  field: string,
  context: { readonly operationId: string; readonly caseId: string },
  issues: CompilationIssue[],
): void {
  if (name.length === 0) {
    addUnsupported(field, context, issues, "Matcher field must include a name after the location prefix.");
    return;
  }
  target[name] = value;
}

function compileMatchExpression(
  expression: MatchExpression,
  field: string,
  context: { readonly operationId: string; readonly caseId: string },
  issues: CompilationIssue[],
): MatchScalar | Readonly<Record<string, unknown>> | undefined {
  if (isScalar(expression)) {
    return expression;
  }

  const entries = Object.entries(expression).filter(([, value]) => value !== undefined);
  if (entries.length !== 1) {
    addUnsupported(field, context, issues, "Exactly one matcher operator must be specified per field.");
    return undefined;
  }

  const [operator, value] = entries[0] as [string, unknown];
  switch (operator) {
    case "equals":
      return value as MatchScalar;
    case "notEquals":
      return longForm("NotEqualTo", value);
    case "present":
      return value === true ? longForm("Exists", null) : longForm("NotExists", null);
    case "absent":
      return value === true ? longForm("NotExists", null) : longForm("Exists", null);
    case "matchesRegex":
      return longForm("Matches", value);
    case "startsWith":
      return longForm("Matches", `^${escapeRegex(String(value))}`);
    case "endsWith":
      return longForm("Matches", `${escapeRegex(String(value))}$`);
    case "contains":
      return longForm("Contains", value);
    default:
      addUnsupported(
        field,
        context,
        issues,
        `Matcher operator '${operator}' is not supported without generated scripts.`,
      );
      return undefined;
  }
}

function toLongForm(value: MatchScalar | Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  if (isScalar(value)) {
    return { operator: "EqualTo", value };
  }
  return value;
}

function longForm(operator: string, value: unknown): Readonly<Record<string, unknown>> {
  return { operator, value };
}

function isScalar(value: unknown): value is MatchScalar {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function addUnsupported(
  field: string,
  context: { readonly operationId: string; readonly caseId: string },
  issues: CompilationIssue[],
  reason: string,
): void {
  issues.push({
    code: "unsupported-matcher",
    field,
    operationId: context.operationId,
    caseId: context.caseId,
    message: `Cannot compile matcher '${field}' in ${context.operationId}/${context.caseId}: ${reason}`,
  });
}
