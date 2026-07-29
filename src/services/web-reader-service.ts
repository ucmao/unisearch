import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as cheerio from 'cheerio';
import { systemHttpClient } from '../crawler/base/SystemHttpClient';
import { ConnectorRuntimeError } from '../core/contracts/errors';

const DEFAULT_MAX_CONTENT_BYTES = 5 * 1024 * 1024;

export interface WebReaderHttpResponse {
  data: unknown;
  status?: number;
  headers?: Record<string, unknown>;
  request?: { res?: { responseUrl?: string } };
  config?: { url?: string };
}

export interface WebReaderHttpClient {
  get(url: string, options?: Record<string, unknown>): Promise<WebReaderHttpResponse>;
}

export interface WebReaderOptions {
  timeoutMs?: number;
  maxContentBytes?: number;
  signal?: AbortSignal;
}

export interface WebReaderParsedArticle {
  content_id: string;
  title: string;
  summary: string;
  description: string;
  content_url: string;
  creator_name: string;
  site_name: string;
  published_at?: string | number;
  images: string[];
  source_keyword?: string;
}

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    || parts[0] === 0;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(host);
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || (version === 4 && isPrivateIpv4(host))
    || (version === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')));
}

export async function normalizePublicWebUrl(value: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `无效的网页 URL：${value}`, false, { cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `网页阅读器仅支持 HTTP 或 HTTPS：${value}`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `网页阅读器不允许访问本机或私有网络：${value}`);
  }
  if (!isIP(url.hostname)) {
    try {
      const addresses = await lookup(url.hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(({ address }) => isPrivateHost(address))) {
        throw new ConnectorRuntimeError('INVALID_INPUT', `网页域名解析到了本机或私有网络：${value}`);
      }
    } catch (error) {
      if (error instanceof ConnectorRuntimeError) throw error;
      throw new ConnectorRuntimeError('NETWORK_ERROR', `无法解析网页域名：${url.hostname}`, true, { cause: error });
    }
  }
  url.hash = '';
  return url.toString();
}

function resolveUrl(relativeUrl: string, baseUrl: string): string {
  if (!relativeUrl) return '';
  try { return new URL(relativeUrl, baseUrl).toString(); } catch { return ''; }
}

export class WebReaderService {
  constructor(private readonly client: WebReaderHttpClient = systemHttpClient) {}

  async read(rawUrl: string, options: WebReaderOptions = {}): Promise<WebReaderParsedArticle> {
    let url = await normalizePublicWebUrl(rawUrl);
    options.signal?.throwIfAborted();
    const maxContentBytes = Math.max(64 * 1024, Math.min(options.maxContentBytes || DEFAULT_MAX_CONTENT_BYTES, 10 * 1024 * 1024));
    let response: WebReaderHttpResponse | null = null;
    for (let redirect = 0; redirect <= 5; redirect++) {
      response = await this.client.get(url, {
        mode: 'desktop',
        timeout: Math.max(1_000, Math.min(options.timeoutMs || 15_000, 30_000)),
        maxRetries: 1,
        maxRedirects: 0,
        validateStatus: (status: number) => status >= 200 && status < 400,
        maxContentLength: maxContentBytes,
        maxBodyLength: maxContentBytes,
        responseType: 'text',
        signal: options.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9',
          'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      });
      const status = Number(response.status || 200);
      const location = String(response.headers?.location || '');
      if (status < 300 || status >= 400 || !location) break;
      if (redirect === 5) throw new ConnectorRuntimeError('NETWORK_ERROR', `网页重定向次数过多：${rawUrl}`, true);
      url = await normalizePublicWebUrl(new URL(location, url).toString());
      options.signal?.throwIfAborted();
    }
    if (!response) throw new ConnectorRuntimeError('NETWORK_ERROR', `网页请求没有返回响应：${url}`, true);
    options.signal?.throwIfAborted();
    const contentType = String(response.headers?.['content-type'] || 'text/html').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new ConnectorRuntimeError('INVALID_INPUT', `目标不是 HTML 网页：${contentType || 'unknown'}`);
    }
    const finalUrl = await normalizePublicWebUrl(response.request?.res?.responseUrl || response.config?.url || url);
    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    if (!html.trim()) throw new ConnectorRuntimeError('PAGE_STRUCTURE_CHANGED', `网页返回了空内容：${finalUrl}`, true);
    if (Buffer.byteLength(html, 'utf8') > maxContentBytes) {
      throw new ConnectorRuntimeError('INVALID_INPUT', `网页内容超过 ${maxContentBytes} 字节限制`);
    }
    return this.parse(html, finalUrl);
  }

  parse(html: string, url: string): WebReaderParsedArticle {
    const $ = cheerio.load(html);
    $('script, style, noscript, iframe, svg, header, footer, nav, form, aside, button, input, .ad, .ads, .advertisement, #comments, .comments, .header, .footer, .sidebar, .menu, .nav').remove();

    const title = cleanText(
      $('meta[property="og:title"]').attr('content')
      || $('meta[name="twitter:title"]').attr('content')
      || $('meta[name="title"]').attr('content')
      || $('h1').first().text()
      || $('title').text(),
    );
    const siteName = cleanText(
      $('meta[property="og:site_name"]').attr('content')
      || $('meta[name="application-name"]').attr('content'),
    );
    let author = cleanText(
      $('meta[name="author"]').attr('content')
      || $('meta[name="publisher"]').attr('content')
      || $('meta[property="article:author"]').attr('content')
      || siteName,
    );
    if (!author) author = new URL(url).hostname.replace(/^www\./, '');

    const rawPublishedAt = cleanText(
      $('meta[property="article:published_time"]').attr('content')
      || $('meta[name="pubdate"]').attr('content')
      || $('meta[name="publishdate"]').attr('content')
      || $('meta[name="publication_date"]').attr('content')
      || $('time').first().attr('datetime')
      || $('time').first().text(),
    );
    const fallbackDate = /(\d{4}[-/年]\d{1,2}[-/月]\d{1,2}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?)/.exec($.text())?.[1];
    const publishedAt = rawPublishedAt || fallbackDate;
    const metaDescription = cleanText(
      $('meta[property="og:description"]').attr('content')
      || $('meta[name="description"]').attr('content')
      || $('meta[name="twitter:description"]').attr('content'),
    );

    const candidates = [
      'article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content',
      '.content', '.main-content', '#article-content', '#content', '.art_content', '.txt_content',
      '.detail-content', '.body-content',
    ];
    let container: cheerio.Cheerio<any> | null = null;
    for (const selector of candidates) {
      const found = $(selector);
      if (found.length) { container = found.first(); break; }
    }
    container ||= $('body');
    const paragraphs: string[] = [];
    container.find('p, h2, h3, h4, h5, section, blockquote, li').each((_, element) => {
      const text = cleanText($(element).text());
      if (text.length > 15 && !paragraphs.includes(text)) paragraphs.push(text);
    });
    let description = paragraphs.join('\n\n');
    if (description.length < 50) description = cleanText(container.text());
    const summary = metaDescription || description.slice(0, 300);

    const images = new Set<string>();
    const addImage = (value?: string) => {
      const resolved = resolveUrl(value || '', url);
      if (/^https?:\/\//i.test(resolved)) images.add(resolved);
    };
    addImage($('meta[property="og:image"]').attr('content'));
    container.find('img').each((_, element) => addImage($(element).attr('src') || $(element).attr('data-src')));

    return {
      content_id: url,
      title: title || '未知标题网页',
      summary: summary || title,
      description: description || summary || title,
      content_url: url,
      creator_name: author,
      site_name: siteName,
      ...(publishedAt ? { published_at: publishedAt } : {}),
      images: [...images].slice(0, 10),
    };
  }
}

export const webReaderService = new WebReaderService();
