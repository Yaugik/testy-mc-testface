import type { RunStatus } from "@testy/shared-types";

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  CREATED: ["VALIDATING", "CANCELLING"],
  VALIDATING: ["ALLOCATING", "FAILED", "CANCELLING"],
  ALLOCATING: ["COMPILING", "FAILED", "CANCELLING"],
  COMPILING: ["CONFIGURING", "FAILED", "CANCELLING"],
  CONFIGURING: ["RUNNING", "FAILED", "CANCELLING"],
  RUNNING: ["OBSERVING", "FAILED", "CANCELLING"],
  OBSERVING: ["ASSERTING", "FAILED", "CANCELLING"],
  ASSERTING: ["PASSED", "FAILED", "CANCELLING"],
  PASSED: ["CLEANUP"],
  FAILED: ["CLEANUP"],
  CANCELLING: ["CANCELLED"],
  CANCELLED: ["CLEANUP"],
  CLEANUP: ["PASSED", "FAILED", "CANCELLED"],
};

export class RunStateMachine {
  private currentStatus: RunStatus;

  public constructor(initialStatus: RunStatus = "CREATED") {
    this.currentStatus = initialStatus;
  }

  public get status(): RunStatus {
    return this.currentStatus;
  }

  public canTransition(next: RunStatus): boolean {
    return transitions[this.currentStatus].includes(next);
  }

  public transition(next: RunStatus): RunStatus {
    if (!this.canTransition(next)) {
      throw new Error(`Invalid run status transition '${this.currentStatus}' -> '${next}'.`);
    }
    this.currentStatus = next;
    return next;
  }
}
