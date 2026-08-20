const AUTH_ERROR_TEXT = /(?:未登录|登录(?:已)?失效|请先登录|重新登录|login\s+required|not\s+logged\s+in|unauthenticated|unauthorized|authentication\s+(?:failed|required))/i;

/**
 * Only treat an API response as an expired session when Kuaishou says so explicitly.
 * A missing payload or result !== 1 is also used for throttling, fingerprint rejection and
 * rolling GraphQL changes, so it must not be promoted to a login error on its own.
 */
export function isExplicitKuaishouAuthFailure(body: any): boolean {
  // 403 is deliberately excluded: Kuaishou also uses it for fingerprint and risk-control blocks.
  if (body?.__httpStatus === 401) return true;

  const responseBody = body?.__responseBody;
  const errors = Array.isArray(body?.errors)
    ? body.errors
    : Array.isArray(responseBody?.errors) ? responseBody.errors : [];
  return errors.some((error: any) => {
    const code = String(error?.extensions?.code || error?.code || '');
    const message = String(error?.message || error?.msg || '');
    return /^(?:UNAUTHENTICATED|UNAUTHORIZED|AUTH_REQUIRED|LOGIN_REQUIRED)$/i.test(code)
      || AUTH_ERROR_TEXT.test(message);
  });
}

export function summarizeKuaishouGraphqlFailure(body: any, resultField: string): string {
  if (body?.__transportError) return String(body.__transportError);
  if (body?.__httpStatus) {
    const response = body.__responseBody;
    const detail = response == null || response === ''
      ? ''
      : `，响应：${(typeof response === 'string' ? response : JSON.stringify(response)).slice(0, 300)}`;
    return `HTTP ${body.__httpStatus}${detail}`;
  }
  if (Array.isArray(body?.errors) && body.errors.length) {
    const first = body.errors[0] || {};
    return `GraphQL ${String(first.extensions?.code || first.code || 'error')}: ${String(first.message || first.msg || '未知错误')}`;
  }
  const payload = body?.data?.[resultField];
  return `接口返回非预期数据（${JSON.stringify(payload ?? null).slice(0, 240)}）`;
}
