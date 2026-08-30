export type AppErrorKind =
  | "network"
  | "timeout"
  | "cancelled"
  | "server"
  | "incompatible_response"
  | "configuration"
  | "unknown";

export class AppError extends Error {
  constructor(
    readonly kind: AppErrorKind,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}
