function crawlerPlatformToken(platform = process.platform): string {
  if (platform === 'win32') return 'Windows NT 10.0; Win64; x64';
  if (platform === 'linux') return 'X11; Linux x86_64';
  return 'Macintosh; Intel Mac OS X 10_15_7';
}

export function buildCrawlerUserAgent(
  chromeVersion = process.versions.chrome || '148.0.0.0',
  platform = process.platform,
): string {
  return `Mozilla/5.0 (${crawlerPlatformToken(platform)}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}

// Never pin this to an old Chrome release. A UA that disagrees with Electron's Chromium client
// hints is a strong automation signal and Kuaishou rejects sensitive operations while allowing
// ordinary account calls.
export const CRAWLER_USER_AGENT = buildCrawlerUserAgent();
export const CRAWLER_LOCALE = 'zh-CN';
export const CRAWLER_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9';
export const CRAWLER_TIMEZONE = 'Asia/Shanghai';
