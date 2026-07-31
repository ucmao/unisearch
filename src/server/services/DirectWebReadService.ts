import { ConnectorRuntimeError } from '../../core/contracts/errors';
import {
  webReaderService,
  type WebReaderOptions,
  type WebReaderParsedArticle,
} from '../../services/web-reader-service';

interface DirectWebReader {
  read(url: string, options?: WebReaderOptions): Promise<WebReaderParsedArticle>;
  readWithBrowser?(url: string, options?: WebReaderOptions): Promise<WebReaderParsedArticle>;
}

export interface DirectWebReadFailure {
  url: string;
  reason: string;
}

export interface DirectWebReadResult {
  articles: WebReaderParsedArticle[];
  failures: DirectWebReadFailure[];
}

export interface DirectWebSourceCitation {
  id: string;
  title: string;
  source: 'web_reader';
  sourceUrl: string;
  fetchedAt: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

export class DirectWebReadService {
  constructor(private readonly reader: DirectWebReader = webReaderService) {}

  private async readOne(url: string, options: WebReaderOptions): Promise<WebReaderParsedArticle> {
    let httpArticle: WebReaderParsedArticle | null = null;
    let httpError: unknown;
    try {
      httpArticle = await this.reader.read(url, options);
      if (httpArticle.description.trim().length >= 80 || !this.reader.readWithBrowser) return httpArticle;
    } catch (error) {
      if (error instanceof ConnectorRuntimeError && error.code === 'INVALID_INPUT') throw error;
      httpError = error;
      if (!this.reader.readWithBrowser) throw error;
    }

    try {
      const browserArticle = await this.reader.readWithBrowser!(url, options);
      if (browserArticle.description.trim()) return browserArticle;
    } catch (browserError) {
      if (!httpArticle) throw httpError || browserError;
    }

    if (httpArticle) return httpArticle;
    throw httpError || new Error('网页没有返回可读取的正文');
  }

  async read(urls: string[], options: WebReaderOptions = {}): Promise<DirectWebReadResult> {
    const targets = Array.from(new Set(urls.map((url) => url.trim()).filter(Boolean))).slice(0, 3);
    const settled = await Promise.allSettled(targets.map((url) => this.readOne(url, options)));
    const articles: WebReaderParsedArticle[] = [];
    const failures: DirectWebReadFailure[] = [];

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') articles.push(result.value);
      else failures.push({ url: targets[index], reason: errorMessage(result.reason) });
    });

    if (!articles.length) {
      throw new Error(failures.map((failure) => `${failure.url}：${failure.reason}`).join('；') || '没有可读取的网页');
    }
    return { articles, failures };
  }
}

export function directWebSourceCitations(articles: WebReaderParsedArticle[]): DirectWebSourceCitation[] {
  const fetchedAt = new Date().toISOString();
  return articles.map((article, index) => ({
    id: `S${index + 1}`,
    title: article.title || article.content_url,
    source: 'web_reader',
    sourceUrl: article.content_url,
    fetchedAt,
  }));
}

export const directWebReadService = new DirectWebReadService();
