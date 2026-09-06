export type AppErrorKind =
  | "network"
  | "timeout"
  | "cancelled"
  | "server"
  | "incompatible_response"
  | "configuration"
  | "unknown";

export class AppError extends Error {
  /** 服务端 problem 响应里的业务错误码（如 INSTALLATION_CREDENTIAL_INVALID）；没有则 undefined */
  readonly code?: string;

  constructor(
    readonly kind: AppErrorKind,
    message: string,
    readonly retryable: boolean,
    readonly requestId?: string,
    readonly status?: number,
    options?: ErrorOptions & { code?: string },
  ) {
    super(message, options);
    this.name = "AppError";
    this.code = options?.code;
  }
}
