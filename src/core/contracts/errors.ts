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
  // Order matters, and so does specificity. These patterns are matched against a
  // free-text message, so anything that also occurs in ordinary page copy (a bare
  // "验证" or "登录") must require a qualifier — otherwise a message that merely
  // quotes the page gets filed under the wrong code.
  if (/Cannot find module|MODULE_NOT_FOUND|找不到模块/i.test(message)) {
    return new ConnectorRuntimeError('UNSUPPORTED_CAPABILITY', message, false, { cause: error });
  }
  if (/Unsupported connector|invalid (?:input|configuration)|无效(?:输入|配置)/i.test(message)) {
    return new ConnectorRuntimeError('INVALID_INPUT', message, false, { cause: error });
  }
  if (/SQLITE_|database (?:is|disk)|数据库/i.test(message)) {
    return new ConnectorRuntimeError('STORAGE_ERROR', message, false, { cause: error });
  }
  if (/captcha|图形验证|安全验证|滑块|verification (?:required|failed)/i.test(message)) {
    return new ConnectorRuntimeError('MANUAL_VERIFICATION_REQUIRED', message, false, { cause: error });
  }
  if (/风控|anti.?bot|blocked by/i.test(message)) {
    return new ConnectorRuntimeError('ANTI_BOT_BLOCKED', message, false, { cause: error });
  }
  if (/rate.?limit|429|限流|请求频繁|操作频繁/i.test(message)) return new ConnectorRuntimeError('RATE_LIMITED', message, true, { cause: error });
  if (/登录(?:已)?(?:失效|过期|超时)|未登录|需要登录|请重新登录|unauthorized|401|未授权/i.test(message)) {
    return new ConnectorRuntimeError('AUTH_REQUIRED', message, false, { cause: error });
  }
  if (/network|ECONN|ENOTFOUND|ETIMEDOUT|网络/i.test(message)) return new ConnectorRuntimeError('NETWORK_ERROR', message, true, { cause: error });
  if (/timeout|超时/i.test(message)) return new ConnectorRuntimeError('TIMEOUT', message, true, { cause: error });
  return new ConnectorRuntimeError('UNKNOWN', message, false, { cause: error });
}
