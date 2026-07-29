import { isIP } from 'node:net';
import * as cheerio from 'cheerio';
import { AbstractCrawler } from '../base/BaseCrawler';
import { systemHttpClient } from '../base/SystemHttpClient';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { ConnectorRuntimeError } from '../../core/contracts/errors';

const REQUEST_INTERVAL_MS = 1_000;
const MAX_FEED_BYTES = 5 * 1024 * 1024;

export type RssNewsSource = 'balanced' | 'bbc_world' | 'bbc_top' | 'bbc_business' | 'bbc_technology' | 'npr_top' | 'aljazeera_all';
export type RssNewsPeriod = '24h' | '7d' | '30d' | 'all';

export interface RssNewsFeedDefinition {
  id: Exclude<RssNewsSource, 'balanced'>;
  name: string;
  url: string;
}

export const RSS_NEWS_FEEDS: Record<Exclude<RssNewsSource, 'balanced'>, RssNewsFeedDefinition> = {
  bbc_world: { id: 'bbc_world', name: 'BBC News · World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  bbc_top: { id: 'bbc_top', name: 'BBC News · Top Stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  bbc_business: { id: 'bbc_business', name: 'BBC News · Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml' },
  bbc_technology: { id: 'bbc_technology', name: 'BBC News · Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  npr_top: { id: 'npr_top', name: 'NPR · News', url: 'https://feeds.npr.org/1001/rss.xml' },
  aljazeera_all: { id: 'aljazeera_all', name: 'Al Jazeera · All', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
};

const BALANCED_SOURCE_IDS: Array<Exclude<RssNewsSource, 'balanced'>> = ['bbc_world', 'npr_top', 'aljazeera_all'];

interface RssHttpClient {
  get(url: string, options?: Record<string, unknown>): Promise<{ data: unknown }>;
}

export interface RssNewsItem {
  content_id: string;
  guid?: string;
  title: string;
  summary: string;
  description: string;
  creator_name: string;
  author?: string;
  content_url?: string;
  feed_url: string;
  feed_title: string;
  categories: string[];
  published_at?: string;
  updated_at?: string;
  language?: string;
  source_keyword?: string;
  rank?: number;
  citations: Array<{ title: string; url: string; source: string }>;
}

function cleanText(value: unknown): string {
  const source = String(value || '').trim();
  if (!source) return '';
  return cheerio.load(`<body>${source}</body>`).text().replace(/\s+/g, ' ').trim();
}

function directChildText(element: cheerio.Cheerio<any>, names: string[]): string {
  for (const name of names) {
    const text = element.children().filter((_, child) => (child as any).name?.toLowerCase() === name.toLowerCase()).first().text();
    if (cleanText(text)) return cleanText(text);
  }
  return '';
}

function isoDate(value: string): string | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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

export function normalizeRssFeedTarget(value: string): string {
  const target = value.trim();
  let url: URL;
  try {
    url = new URL(target);
  } catch (error) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `无效的 RSS/Atom URL：${target}`, false, { cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `RSS/Atom URL 仅支持 HTTP 或 HTTPS：${target}`);
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = isIP(hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || (ipVersion === 4 && isPrivateIpv4(hostname))
    || (ipVersion === 6 && (hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || hostname.startsWith('fe80:')))) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `RSS/Atom URL 不允许访问本机或私有网络：${target}`);
  }
  url.hash = '';
  return url.toString();
}

function parseRssItems($: cheerio.CheerioAPI, feedUrl: string, publisherHint: string): RssNewsItem[] {
  const channel = $('rss > channel, rdf\\:RDF').first();
  const feedTitle = directChildText(channel, ['title']) || publisherHint || new URL(feedUrl).hostname;
  const language = directChildText(channel, ['language', 'dc:language']);
  const items: RssNewsItem[] = [];
  channel.find('item').each((index, node) => {
    const item = $(node);
    const title = directChildText(item, ['title']);
    const guid = directChildText(item, ['guid', 'dc:identifier']);
    const link = safeHttpUrl(directChildText(item, ['link']));
    const summary = directChildText(item, ['description', 'summary', 'content:encoded']);
    const author = directChildText(item, ['dc:creator', 'author']);
    const publishedAt = isoDate(directChildText(item, ['pubDate', 'dc:date', 'published']));
    const updatedAt = isoDate(directChildText(item, ['updated', 'atom:updated']));
    const categories = item.children().filter((_, child) => ['category', 'dc:subject'].includes((child as any).name?.toLowerCase()))
      .map((_, category) => cleanText($(category).text())).get().filter(Boolean);
    const contentId = guid || link || `${feedUrl}#item-${index + 1}-${title}`;
    if (!title && !summary) return;
    items.push({
      content_id: contentId,
      ...(guid ? { guid } : {}),
      title: title || summary.slice(0, 120),
      summary,
      description: summary,
      creator_name: publisherHint || feedTitle,
      ...(author ? { author } : {}),
      ...(link ? { content_url: link } : {}),
      feed_url: feedUrl,
      feed_title: feedTitle,
      categories,
      ...(publishedAt ? { published_at: publishedAt } : {}),
      ...(updatedAt ? { updated_at: updatedAt } : {}),
      ...(language ? { language } : {}),
      citations: link ? [{ title: title || feedTitle, url: link, source: publisherHint || feedTitle }] : [],
    });
  });
  return items;
}

function parseAtomItems($: cheerio.CheerioAPI, feedUrl: string, publisherHint: string): RssNewsItem[] {
  const feed = $('feed').first();
  const feedTitle = directChildText(feed, ['title']) || publisherHint || new URL(feedUrl).hostname;
  const language = cleanText(feed.attr('xml:lang'));
  const items: RssNewsItem[] = [];
  feed.children('entry').each((index, node) => {
    const item = $(node);
    const title = directChildText(item, ['title']);
    const guid = directChildText(item, ['id']);
    const linkValue = item.children('link').filter((_, link) => !$(link).attr('rel') || $(link).attr('rel') === 'alternate').first().attr('href') || '';
    const link = safeHttpUrl(linkValue);
    const summary = directChildText(item, ['summary', 'content']);
    const author = cleanText(item.children('author').first().children('name').first().text());
    const publishedAt = isoDate(directChildText(item, ['published', 'issued', 'created']));
    const updatedAt = isoDate(directChildText(item, ['updated', 'modified']));
    const categories = item.children('category').map((_, category) => cleanText($(category).attr('term') || $(category).text())).get().filter(Boolean);
    const contentId = guid || link || `${feedUrl}#entry-${index + 1}-${title}`;
    if (!title && !summary) return;
    items.push({
      content_id: contentId,
      ...(guid ? { guid } : {}),
      title: title || summary.slice(0, 120),
      summary,
      description: summary,
      creator_name: publisherHint || feedTitle,
      ...(author ? { author } : {}),
      ...(link ? { content_url: link } : {}),
      feed_url: feedUrl,
      feed_title: feedTitle,
      categories,
      ...(publishedAt ? { published_at: publishedAt } : {}),
      ...(updatedAt ? { updated_at: updatedAt } : {}),
      ...(language ? { language } : {}),
      citations: link ? [{ title: title || feedTitle, url: link, source: publisherHint || feedTitle }] : [],
    });
  });
  return items;
}

export function parseRssNewsFeed(xml: unknown, feedUrl: string, publisherHint = ''): RssNewsItem[] {
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml || '');
  const $ = cheerio.load(source, { xmlMode: true });
  if ($('rss > channel, rdf\\:RDF').length) return parseRssItems($, feedUrl, publisherHint);
  if ($('feed').length) return parseAtomItems($, feedUrl, publisherHint);
  throw new ConnectorRuntimeError('PAGE_STRUCTURE_CHANGED', '目标内容不是可识别的 RSS、RDF 或 Atom Feed');
}

function periodCutoff(period: RssNewsPeriod, now: Date): number | undefined {
  const duration = period === '24h' ? 86_400_000 : period === '7d' ? 7 * 86_400_000 : period === '30d' ? 30 * 86_400_000 : undefined;
  return duration ? now.getTime() - duration : undefined;
}

export function filterRssNewsItems(
  items: RssNewsItem[],
  options: { keywords?: string[]; period?: RssNewsPeriod; maxItems?: number; now?: Date } = {},
): RssNewsItem[] {
  const keywords = (options.keywords || []).map((value) => value.trim().toLowerCase()).filter(Boolean);
  const cutoff = periodCutoff(options.period || '7d', options.now || new Date());
  const maxItems = Math.max(1, Math.min(100, options.maxItems || 20));
  const deduplicated = new Map<string, RssNewsItem>();
  for (const item of items) {
    const timestamp = item.published_at || item.updated_at;
    if (cutoff && timestamp && Date.parse(timestamp) < cutoff) continue;
    const haystack = `${item.title} ${item.summary} ${item.categories.join(' ')}`.toLowerCase();
    const matchedKeyword = keywords.find((keyword) => haystack.includes(keyword));
    if (keywords.length && !matchedKeyword) continue;
    const key = item.content_url || item.guid || item.content_id;
    if (!deduplicated.has(key)) deduplicated.set(key, {
      ...item,
      ...(matchedKeyword ? { source_keyword: matchedKeyword } : {}),
    });
  }
  return [...deduplicated.values()]
    .sort((left, right) => Date.parse(right.published_at || right.updated_at || '') - Date.parse(left.published_at || left.updated_at || ''))
    .slice(0, maxItems)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export class RssNewsCrawler extends AbstractCrawler {
  private lastRequestAt = 0;

  constructor(
    private readonly client: RssHttpClient = systemHttpClient,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    super();
  }

  private async fetchFeed(feedUrl: string): Promise<unknown> {
    const normalizedUrl = normalizeRssFeedTarget(feedUrl);
    const remaining = REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (this.lastRequestAt && remaining > 0) await this.wait(remaining);
    this.lastRequestAt = Date.now();
    const response = await this.client.get(normalizedUrl, {
      autoCookie: false,
      maxRetries: 2,
      retryDelayMs: 2_000,
      timeout: 20_000,
      maxContentLength: MAX_FEED_BYTES,
      maxBodyLength: MAX_FEED_BYTES,
      headers: {
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9',
        'User-Agent': 'UniSearch/1.0 (local RSS and Atom feed reader)',
      },
      beforeRedirect: (options: { hostname?: string; href?: string }) => {
        normalizeRssFeedTarget(options.href || `https://${options.hostname || ''}/`);
      },
    });
    return response.data;
  }

  private runtimeOptions(): { keywords: string[]; period: RssNewsPeriod; maxItems: number } {
    return {
      keywords: String(activeConfig.KEYWORDS || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean),
      period: (activeConfig.RSS_NEWS_PERIOD || '7d') as RssNewsPeriod,
      maxItems: Math.max(1, Math.min(100, Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20))),
    };
  }

  public async search(): Promise<void> {
    const source = (activeConfig.RSS_NEWS_SOURCE || 'balanced') as RssNewsSource;
    const sourceIds = source === 'balanced' ? BALANCED_SOURCE_IDS : [source];
    const collected: RssNewsItem[] = [];
    const failures: string[] = [];
    for (const sourceId of sourceIds) {
      const definition = RSS_NEWS_FEEDS[sourceId];
      if (!definition) throw new ConnectorRuntimeError('INVALID_INPUT', `未知 RSS 新闻源：${sourceId}`);
      try {
        collected.push(...parseRssNewsFeed(await this.fetchFeed(definition.url), definition.url, definition.name));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${definition.name}: ${message}`);
        console.warn(`[RSS_NEWS] ${definition.name} failed: ${message}`);
      }
    }
    if (!collected.length && failures.length) {
      throw new ConnectorRuntimeError('NETWORK_ERROR', `所有 RSS 新闻源均读取失败：${failures.join('；')}`, true);
    }
    const items = filterRssNewsItems(collected, this.runtimeOptions());
    for (const item of items) await connectorOutput.emitRssNewsItem(item);
    console.log(`[RSS_NEWS] Emitted ${items.length} items from ${sourceIds.length} feed(s).`);
  }

  private async fetchCustomFeeds(): Promise<void> {
    const rawTargets = Array.isArray(activeConfig.RSS_NEWS_SPECIFIED_ID_LIST)
      ? activeConfig.RSS_NEWS_SPECIFIED_ID_LIST
      : String(activeConfig.RSS_NEWS_SPECIFIED_ID_LIST || '').split(/[,，\n]+/);
    const feedUrls = Array.from(new Set(rawTargets.map((value: unknown) => normalizeRssFeedTarget(String(value)))));
    if (!feedUrls.length) throw new ConnectorRuntimeError('INVALID_INPUT', '请提供至少一个公开 RSS 或 Atom URL');
    const collected: RssNewsItem[] = [];
    for (const feedUrl of feedUrls) collected.push(...parseRssNewsFeed(await this.fetchFeed(feedUrl), feedUrl));
    const items = filterRssNewsItems(collected, this.runtimeOptions());
    for (const item of items) await connectorOutput.emitRssNewsItem(item);
    console.log(`[RSS_NEWS] Emitted ${items.length} items from ${feedUrls.length} custom feed(s).`);
  }

  public async start(): Promise<void> {
    if (activeConfig.CRAWLER_TYPE === 'detail') await this.fetchCustomFeeds();
    else await this.search();
  }
}
