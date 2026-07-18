import { describe, expect, it } from "vitest";

import type { CompilationIssue } from "../src/errors.js";
import { compileRequestMatchers } from "../src/matchers.js";

describe("JSON request matching", () => {
  it("compiles multiple json fields into Imposter JsonPath matchers", () => {
    const issues: CompilationIssue[] = [];
    const result = compileRequestMatchers(
      {
        "json.company.domain": "complete.example",
        "json.company.name": { contains: "Example" },
      },
      { operationId: "match-company", caseId: "complete-company" },
      issues,
    );

    expect(issues).toEqual([]);
    expect(result.requestBody).toEqual({
      allOf: [
        {
          jsonPath: "$.company.domain",
          operator: "EqualTo",
          value: "complete.example",
        },
        {
          jsonPath: "$.company.name",
          operator: "Contains",
          value: "Example",
        },
      ],
    });
  });

  it("uses bracket notation for non-identifier JSON property names", () => {
    const issues: CompilationIssue[] = [];
    const result = compileRequestMatchers(
      { "json.company.employee-count": 42 },
      { operationId: "match-company", caseId: "hyphenated" },
      issues,
    );

    expect(issues).toEqual([]);
    expect(result.requestBody).toEqual({
      jsonPath: "$.company['employee-count']",
      operator: "EqualTo",
      value: 42,
    });
  });
});
