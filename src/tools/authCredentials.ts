interface CredentialSession {
  clearData(): Promise<void>;
  clearAuthCache(): Promise<void>;
  cookies: {
    get(filter: Record<string, never>): Promise<Array<unknown>>;
  };
}

export async function clearCrawlerCredentialSessions(
  platformIds: Iterable<string>,
  sessionFromPartition: (partition: string) => CredentialSession,
  beforeClear: (platform: string) => void = () => {},
): Promise<void> {
  const failures: string[] = [];
  for (const platformId of platformIds) {
    try {
      beforeClear(platformId);
      const session = sessionFromPartition(`persist:unisearch-crawler-${platformId}`);
      await session.clearData();
      await session.clearAuthCache();
      const remainingCookies = await session.cookies.get({});
      if (remainingCookies.length > 0) {
        throw new Error(`仍存在 ${remainingCookies.length} 个 Cookie`);
      }
    } catch (error: any) {
      failures.push(`${platformId}: ${error?.message || '未知错误'}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`以下浏览器会话未能清空：${failures.join('；')}`);
  }
}
