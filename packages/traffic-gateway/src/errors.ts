export class GatewayError extends Error {
  public constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export function gatewayError(
  code: string,
  statusCode: number,
  message: string,
): GatewayError {
  return new GatewayError(code, statusCode, message);
}
