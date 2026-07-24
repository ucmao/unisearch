export type ConnectorErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'ANTI_BOT_BLOCKED'
  | 'MANUAL_VERIFICATION_REQUIRED'
  | 'PAGE_STRUCTURE_CHANGED'
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_CAPABILITY'
  | 'STORAGE_ERROR'
  | 'PROCESS_CRASHED'
  | 'CANCELLED'
  | 'UNKNOWN';

export class ConnectorRuntimeError extends Error {
  constructor(
    public readonly code: ConnectorErrorCode,
    message: string,
    public readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConnectorRuntimeError';
  }
}

export function classifyConnectorError(error: unknown): ConnectorRuntimeError {
  if (error instanceof ConnectorRuntimeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|超时/i.test(message)) return new ConnectorRuntimeError('TIMEOUT', message, true, { cause: error });
  if (/login|auth|登录|未授权/i.test(message)) return new ConnectorRuntimeError('AUTH_REQUIRED', message, false, { cause: error });
  if (/rate.?limit|429|限流|频繁/i.test(message)) return new ConnectorRuntimeError('RATE_LIMITED', message, true, { cause: error });
  if (/captcha|verification|验证/i.test(message)) {
    return new ConnectorRuntimeError('MANUAL_VERIFICATION_REQUIRED', message, false, { cause: error });
  }
  if (/network|ECONN|ENOTFOUND|网络/i.test(message)) return new ConnectorRuntimeError('NETWORK_ERROR', message, true, { cause: error });
  return new ConnectorRuntimeError('UNKNOWN', message, false, { cause: error });
}
