export type TrafficGeneratorErrorCode =
  | "invalid-config"
  | "cancelled"
  | "batch-timeout"
  | "response-too-large";

export class TrafficGeneratorError extends Error {
  public constructor(
    public readonly code: TrafficGeneratorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TrafficGeneratorError";
  }
}

export function trafficError(
  code: TrafficGeneratorErrorCode,
  message: string,
): TrafficGeneratorError {
  return new TrafficGeneratorError(code, message);
}
