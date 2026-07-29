import * as cheerio from 'cheerio';
import { systemHttpClient } from '../../crawler/base/SystemHttpClient';

export type LiveSearchProvider = 'baidu' | 'bing' | 'sogou' | 'so360' | 'toutiao';

/**
 * Evidence exists only for the lifetime of one live-answer request. It is never
 * converted to a RawItem, CanonicalDocument, crawl run, or knowledge chunk.
 */
export interface SearchEvidence {
  id: string;
  title: string;
  source: LiveSearchProvider;
  sourceUrl: string;
  excerpt: string;
  publisher?: string;
  publishedAt?: string;
  fetchedAt: string;
}

/** The deliberately small citation record that may be persisted with a chat message. */
export interface LiveSourceCitation {
  id: string;
  title: string;
  source: LiveSearchProvider;
  sourceUrl: string;
  fetchedAt: string;
}

interface LiveSearchHttpClient {
  get(url: string, options?: Record<string, unknown>): Promise<{ data: unknown }>;
}

interface EvidenceDraft extends Omit<SearchEvidence, 'id' | 'fetchedAt'> {}

function cleanText(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHttpUrl(value: string, baseUrl: string): string {
  const candidate = value.startsWith('//')
    ? `https:${value}`
    : value.startsWith('/')
      ? new URL(value, baseUrl).toString()
      : value;
  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function resultTime(value: string): string | undefined {
  return /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec(value)?.[1];
}

export function parseBaiduSearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  $('.c-container, .result, div[srcid]').each((_, element) => {
    if (results.length >= limit) return false;
    const item = $(element);
    const link = item.find('h3 a').first();
    const title = cleanText(link.text());
    const sourceUrl = safeHttpUrl(link.attr('href') || '', 'https://www.baidu.com/');
    if (!title || !sourceUrl) return;
    const excerpt = cleanText(
      item.find('.c-abstract, .content-right, .c-span-last, .c-font-normal, [class*="content-"]').first().text()
        || item.find('p').first().text()
        || item.text().replace(title, ''),
    ).slice(0, 600);
    if (!excerpt) return;
    const fullText = cleanText(item.text());
    results.push({
      title,
      source: 'baidu',
      sourceUrl,
      excerpt,
      publisher: cleanText(item.find('.c-showurl, .c-color-gray, [class*="showurl"]').first().text()) || '百度搜索',
      publishedAt: resultTime(fullText),
    });
  });
  return results;
}

export function parseBingSearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  $('li.b_algo, #b_results > li.b_algo, .b_algo').each((_, element) => {
    if (results.length >= limit) return false;
    const item = $(element);
    const link = item.find('h2 a').first();
    const title = cleanText(link.text());
    const sourceUrl = safeHttpUrl(link.attr('href') || '', 'https://cn.bing.com/');
    if (!title || !sourceUrl) return;
    const excerpt = cleanText(
      item.find('.b_algoSlug, .b_caption, p, [class*="b_lineclamp"]').first().text()
        || item.text().replace(title, ''),
    ).slice(0, 600);
    if (!excerpt) return;
    const fullText = cleanText(item.text());
    results.push({
      title,
      source: 'bing',
      sourceUrl,
      excerpt,
      publisher: cleanText(item.find('cite, .news-attribution').first().text()) || '必应中国',
      publishedAt: resultTime(fullText),
    });
  });
  return results;
}

export function parseSogouSearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  $('.vrwrap, .rb, div.results > div').each((_, element) => {
    if (results.length >= limit) return false;
    const item = $(element);
    const link = item.find('h3.vr-title a, h3.pt a, h3 a').first();
    const title = cleanText(link.text());
    const sourceUrl = safeHttpUrl(link.attr('href') || '', 'https://www.sogou.com/');
    if (!title || !sourceUrl) return;
    const excerpt = cleanText(
      item.find('.star-wiki, .space-txt, .str_pack_wrp, .ft, .txt-box, p').first().text()
        || item.text().replace(title, ''),
    ).slice(0, 600);
    if (!excerpt) return;
    const fullText = cleanText(item.text());
    results.push({
      title,
      source: 'sogou',
      sourceUrl,
      excerpt,
      publisher: cleanText(item.find('.cite, .citeurl, .fb').first().text()) || '搜狗搜索',
      publishedAt: resultTime(fullText),
    });
  });
  return results;
}

export function parseSo360SearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  $('li.res-list').each((_, element) => {
    if (results.length >= limit) return false;
    const item = $(element);
    const link = item.find('h3.res-title a, h3 a').first();
    const title = cleanText(link.text());
    const sourceUrl = safeHttpUrl(link.attr('href') || '', 'https://www.so.com/');
    if (!title || !sourceUrl) return;
    const excerpt = cleanText(
      item.find('.res-desc, .res-rich, p.res-desc').first().text()
        || item.text().replace(title, ''),
    ).slice(0, 600);
    if (!excerpt) return;
    const fullText = cleanText(item.text());
    results.push({
      title,
      source: 'so360',
      sourceUrl,
      excerpt,
      publisher: cleanText(item.find('.res-site, .res-link').first().text()) || '360搜索',
      publishedAt: resultTime(fullText),
    });
  });
  return results;
}

function firstHttpUrl(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return '';
}

export function parseToutiaoSearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  $('script[data-druid-card-data-id][type="application/json"]').each((_, element) => {
    if (results.length >= limit) return false;
    let parsed: any;
    try {
      parsed = JSON.parse($(element).contents().text());
    } catch {
      return;
    }
    const data = parsed?.data;
    if (!data || typeof data !== 'object') return;
    const display = data.display && typeof data.display === 'object' ? data.display : {};
    const info = display.info && typeof display.info === 'object' ? display.info : {};
    const title = cleanText(data.title || display.title?.text || data.emphasized?.title);
    const sourceUrl = firstHttpUrl(
      data.article_url, info.url, data.url, data.share_url,
      data.ttsearch_msite_url, data.source_url, data.open_url,
    );
    const excerpt = cleanText(
      data.abstract || display.summary?.text || data.emphasized?.summary || data.hot_board_summary,
    ).slice(0, 600);
    if (!title || !sourceUrl || !excerpt) return;

    let publishedAt = cleanText(data.datetime);
    if (!publishedAt) {
      const timestamp = Number(data.publish_time || data.create_time || data.behot_time || data.display_time);
      if (Number.isFinite(timestamp) && timestamp > 1e9) publishedAt = new Date(timestamp * 1000).toISOString();
    }
    results.push({
      title,
      source: 'toutiao',
      sourceUrl,
      excerpt,
      publisher: cleanText(data.media_name || data.source || info.site_name || info.domain) || '头条搜索',
      publishedAt: publishedAt || undefined,
    });
  });
  return results;
}

function roundRobin(groups: EvidenceDraft[][]): EvidenceDraft[] {
  const result: EvidenceDraft[] = [];
  const maxLength = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < maxLength; index++) {
    for (const group of groups) if (group[index]) result.push(group[index]);
  }
  return result;
}

function deduplicate(drafts: EvidenceDraft[]): EvidenceDraft[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  return drafts.filter((draft) => {
    const urlKey = draft.sourceUrl.replace(/[#?].*$/, '').replace(/\/$/, '').toLocaleLowerCase();
    const titleKey = draft.title.replace(/\s+/g, '').toLocaleLowerCase();
    if (seenUrls.has(urlKey) || seenTitles.has(titleKey)) return false;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    return true;
  });
}

export function toLiveSourceCitations(evidence: SearchEvidence[]): LiveSourceCitation[] {
  return evidence.map(({ id, title, source, sourceUrl, fetchedAt }) => ({
    id, title, source, sourceUrl, fetchedAt,
  }));
}

export class LiveSearchService {
  constructor(private readonly client: LiveSearchHttpClient = systemHttpClient) {}

  async search(
    rawQuery: string,
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<SearchEvidence[]> {
    const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!query) return [];
    const perProvider = 4;
    const requestOptions = {
      mode: 'desktop',
      timeout: 4_000,
      maxRetries: 1,
      signal: options.signal,
    };
    const suv = `SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`;
    const requests = [
      this.client.get(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=0&rn=10&tn=baidu`, {
        ...requestOptions,
        headers: { Cookie: 'BDUSS=dummy;' },
      }).then((response) => parseBaiduSearchHtml(response.data, perProvider)),
      this.client.get(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&first=1`, requestOptions)
        .then((response) => parseBingSearchHtml(response.data, perProvider)),
      this.client.get(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, {
        ...requestOptions,
        headers: { Cookie: suv },
        referer: 'https://www.sogou.com/',
      }).then((response) => parseSogouSearchHtml(response.data, perProvider)),
      this.client.get(`https://www.so.com/s?q=${encodeURIComponent(query)}&pn=1`, requestOptions)
        .then((response) => parseSo360SearchHtml(response.data, perProvider)),
      this.client.get(`https://so.toutiao.com/search?keyword=${encodeURIComponent(query)}&pd=synthesis&dvpf=pc`, {
        ...requestOptions,
        referer: 'https://so.toutiao.com/',
        autoCookie: false,
      }).then((response) => parseToutiaoSearchHtml(response.data, perProvider)),
    ];
    const settled = await Promise.allSettled(requests);
    options.signal?.throwIfAborted();
    const groups = settled.map((result) => result.status === 'fulfilled' ? result.value : []);
    const fetchedAt = new Date().toISOString();
    return deduplicate(roundRobin(groups))
      .slice(0, Math.max(1, Math.min(12, options.limit || 8)))
      .map((draft, index) => ({ ...draft, id: `S${index + 1}`, fetchedAt }));
  }
}

export const liveSearchService = new LiveSearchService();
