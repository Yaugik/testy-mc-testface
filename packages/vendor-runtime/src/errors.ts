export class RuntimeStartError extends Error {
  public readonly containerId: string | undefined;
  public readonly runtimeLogs: string | undefined;

  public constructor(
    message: string,
    options: { readonly containerId?: string; readonly runtimeLogs?: string; readonly cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "RuntimeStartError";
    this.containerId = options.containerId;
    this.runtimeLogs = options.runtimeLogs;
  }
}
