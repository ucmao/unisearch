import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { webReaderService, type WebReaderParsedArticle } from '../../services/web-reader-service';

function extractUrls(input: string): string[] {
  if (!input) return [];
  const matches = input.match(/https?:\/\/[^\s,，;；"'()<>[\]{}]+/g) || [];
  return [...new Set(matches.map((url) => url.trim().replace(/[.，;；!！?？。)\\]]+$/, '')).filter((url) => /^https?:\/\/\w+/i.test(url)))];
}

export type { WebReaderParsedArticle } from '../../services/web-reader-service';

export class WebReaderCrawler extends AbstractCrawler {
  public async start(): Promise<void> { await this.search(); }

  public async search(): Promise<void> {
    const rawInputs = activeConfig.SPECIFIED_IDS || activeConfig.KEYWORDS || activeConfig.TARGET_URLS || '';
    const urls = extractUrls(rawInputs);
    if (!urls.length) {
      console.warn('[WebReader] No valid HTTP/HTTPS URLs found in input.');
      return;
    }
    console.log(`[WebReader] Starting hybrid content extraction for ${urls.length} target URL(s)...`);
    let nextIndex = 0;
    const concurrency = Math.max(1, Math.min(Number(activeConfig.WEB_READER_CONCURRENCY || 2), urls.length));
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (nextIndex < urls.length) {
        const index = nextIndex++;
        const url = urls[index];
        console.log(`[WebReader] [${index + 1}/${urls.length}] Fetching & parsing: ${url}`);
        try {
          const articles = await this.executeHybrid<WebReaderParsedArticle>(
            async () => {
              const article = await webReaderService.read(url, {
                timeoutMs: Number(activeConfig.WEB_READER_TIMEOUT_MS || 15_000),
              });
              if (!article.description || article.description.trim().length < 50) {
                throw new Error('HTTP 模式抓取正文过短 (可能为 JS 渲染页面)，触发 Playwright 浏览器兜底');
              }
              return [article];
            },
            async () => {
              const article = await webReaderService.readWithBrowser(url, {
                timeoutMs: Number(activeConfig.WEB_READER_TIMEOUT_MS || 25_000),
              });
              return article ? [article] : [];
            }
          );

          for (const article of articles) {
            await connectorOutput.emitWebReaderResult({ ...article });
            console.log(`[WebReader] Successfully extracted: "${article.title}" (${article.description.length} chars)`);
          }
        } catch (error: any) {
          console.error(`[WebReader] Failed to process URL "${url}": ${error.message}`);
        }
      }
    }));
    console.log('[WebReader] Content extraction completed.');
  }

  public parseWebPage(url: string): Promise<WebReaderParsedArticle> {
    return webReaderService.read(url);
  }
}
