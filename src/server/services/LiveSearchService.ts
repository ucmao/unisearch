import * as cheerio from 'cheerio';
import { systemHttpClient } from '../../crawler/base/SystemHttpClient';
import { canonicalSearchResultUrl } from '../../crawler/platforms/search_engine';
import { webReaderService, type WebReaderParsedArticle } from '../../services/web-reader-service';
import { listLiveSearchConnectorIds } from '../../connectors/registry';

export type LiveSearchProvider = 'baidu' | 'bing' | 'sogou' | 'so360' | 'toutiao' | 'quark' | 'chinaso';

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

interface LiveWebReader {
  read(url: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<WebReaderParsedArticle>;
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
      publisher: cleanText(item.find('cite, .news-attribution').first().text()) || '必应搜索',
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

export function parseQuarkSearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  const seen = new Set<string>();

  // 1. JSON Hydration feeds
  $('script[type="application/json"], script[id^="s-data-"]').each((_, el) => {
    if (results.length >= limit) return false;
    try {
      const jsonText = $(el).html() || $(el).text();
      if (!jsonText) return;
      const parsed = JSON.parse(jsonText);
      const feed = parsed?.data?.initialData?.feed;
      if (Array.isArray(feed)) {
        for (const item of feed) {
          if (results.length >= limit) break;
          const title = cleanText(item.title || '');
          let sourceUrl = item.url || '';
          if (!title || !sourceUrl || sourceUrl.startsWith('javascript:') || sourceUrl.includes('adclick')) continue;
          if (sourceUrl.startsWith('//')) sourceUrl = `https:${sourceUrl}`;
          const dedupeKey = canonicalSearchResultUrl(sourceUrl);
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          results.push({
            title,
            source: 'quark',
            sourceUrl,
            excerpt: cleanText(item.summary || item.desc || title).slice(0, 600),
            publisher: cleanText(item.webname || item.source || '神马搜索'),
            publishedAt: item.time ? resultTime(item.time) : undefined,
          });
        }
      }
    } catch {}
  });

  // 2. DOM cards
  $('article, .article-item, .result, .sc, div[data-s-index], .card, .qk-card, [data-cmp="ca"], .y-feed-item').each((_, element) => {
    if (results.length >= limit) return false;
    const card = $(element);
    const link = card.find('h2 a, h3 a, a.title, .c-header a, a[data-openpageurl], a[data-u], a[data-log], a').first();
    const title = cleanText(card.find('.qk-title-text, .qk-title, h2, h3, .title, .y-feed-title, .c-title').first().text()) || cleanText(link.text());
    let sourceUrl = link.attr('data-openpageurl') || link.attr('data-u') || link.attr('href') || card.attr('data-openpageurl') || card.attr('data-u') || '';
    if (!title || !sourceUrl || sourceUrl.startsWith('javascript:') || sourceUrl === '#' || sourceUrl.includes('adclick') || sourceUrl.includes('log.m.sm.cn')) return;
    if (sourceUrl.startsWith('//')) sourceUrl = `https:${sourceUrl}`;

    const dedupeKey = canonicalSearchResultUrl(sourceUrl);
    if (!dedupeKey || seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const excerpt = cleanText(
      card.find('.c-abstract, .c-line-clamp, .c-content, .desc, .abs, .y-feed-desc, .y-feed-abstract, p').first().text()
        || card.text().replace(title, ''),
    ).slice(0, 600);
    if (!excerpt) return;

    const publisher = cleanText(
      card.find('.c-footer, .c-source, .c-showurl, .source, .author, .webname, .host, .list-source').first().text()
    ).split(/[\s·|]/)[0] || '神马搜索';

    const fullText = cleanText(card.text());
    results.push({
      title,
      source: 'quark',
      sourceUrl,
      excerpt,
      publisher,
      publishedAt: resultTime(fullText),
    });
  });
  return results;
}

export function parseChinaSoSearchHtml(html: unknown, limit = 4): EvidenceDraft[] {
  const $ = cheerio.load(String(html || ''));
  const results: EvidenceDraft[] = [];
  $('.search-list .list, .list-wrapper .list, .reItem, li.reItem, .natural-word, .natural-news-group, .natural-image, article, .item').each((_, element) => {
    if (results.length >= limit) return false;
    const item = $(element);
    const link = item.find('h2 a, h3 a, a.title, .list-title a, a[target="_blank"], a').first();
    const title = cleanText(link.text());
    let sourceUrl = link.attr('href') || '';
    if (!title || !sourceUrl || sourceUrl.startsWith('javascript:') || sourceUrl === '#') return;
    if (sourceUrl.includes('/newssearch/all/')) return;
    if (sourceUrl.startsWith('//')) sourceUrl = `https:${sourceUrl}`;

    const excerpt = cleanText(
      item.find('.desc, .list-content, .content, .summary, p, .c-abstract').first().text()
        || item.text().replace(title, ''),
    ).slice(0, 600);
    if (!excerpt) return;

    const publisher = cleanText(
      item.find('.source, .list-source, .pub-name, .news-source, .author').first().text()
    ) || '中国搜索';

    const fullText = cleanText(item.text());
    results.push({
      title,
      source: 'chinaso',
      sourceUrl,
      excerpt,
      publisher,
      publishedAt: resultTime(fullText),
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

export function cleanSearchQuery(rawQuery: string): string {
  const trimmed = rawQuery.replace(/\s+/g, ' ').trim();
  if (!trimmed || trimmed.length <= 15) return trimmed;
  // 剥离常见的长口语引导句式
  const cleaned = trimmed
    .replace(/^(?:请(?:问|你)?|你(?:能|可以)?(?:不?能|帮我)?|麻烦(?:你|帮我)?)\s*/gi, '')
    .replace(/(?:深入|深度)?(?:调研|研究|核验|查证|检索|搜索|查一下|看下)(?:一下)?\s*/gi, '')
    .replace(/(?:这家|这个|关于)\s*(?:公司|企业|机构|产品|项目)?(?:\s*的资料|\s*资料)?\s*/gi, '')
    .replace(/(?:到底|究竟)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || trimmed;
}

export function extractCoreQueryTerms(query: string): string[] {
  const terms = query
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  const stopWords = new Set(['调研', '研究', '核验', '查证', '搜索', '查询', '公司', '企业', '机构', '产品', '关于', '以及', '还是', '是不是', '是否']);
  return terms.filter((term) => !stopWords.has(term.toLowerCase()));
}

export function filterRelevantSearchResults(drafts: EvidenceDraft[], rawQuery: string): EvidenceDraft[] {
  const terms = extractCoreQueryTerms(rawQuery);
  if (!terms.length) return drafts;

  // 针对明显的垃圾/工具网站进行模式过滤
  const noiseUrlPattern = /(?:currency|exchange-rate|converter|forex|wise\.com\/.*convert|ip138|tool\.chinaz)/i;

  const scored = drafts.map((draft) => {
    if (noiseUrlPattern.test(draft.sourceUrl)) {
      return { draft, score: -10 };
    }
    const text = `${draft.title} ${draft.excerpt}`.toLowerCase();
    let matches = 0;
    for (const term of terms) {
      if (text.includes(term.toLowerCase())) {
        matches++;
      }
    }
    return { draft, score: matches };
  });

  const relevant = scored.filter((item) => item.score > 0).map((item) => item.draft);
  // 如果全部过滤掉，则回退为除去硬性噪声 URL 后的条目，保证鲁棒性
  if (!relevant.length) {
    return drafts.filter((draft) => !noiseUrlPattern.test(draft.sourceUrl));
  }
  return relevant;
}

export function toLiveSourceCitations(evidence: SearchEvidence[]): LiveSourceCitation[] {
  return evidence.map(({ id, title, source, sourceUrl, fetchedAt }) => ({
    id, title, source, sourceUrl, fetchedAt,
  }));
}

export class LiveSearchService {
  constructor(
    private readonly client: LiveSearchHttpClient = systemHttpClient,
    private readonly reader: LiveWebReader = webReaderService,
  ) {}

  async search(
    rawQuery: string,
    options: {
      limit?: number;
      signal?: AbortSignal;
      readMode?: 'snippet' | 'auto' | 'full';
      maxReadItems?: number;
    } = {},
  ): Promise<SearchEvidence[]> {
    const rawTrimmed = rawQuery.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!rawTrimmed) return [];
    const query = cleanSearchQuery(rawTrimmed).slice(0, 300) || rawTrimmed;
    const perProvider = 4;
    const requestOptions = {
      mode: 'desktop',
      timeout: 4_000,
      maxRetries: 1,
      signal: options.signal,
    };
    const suv = `SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`;
    const requests: Array<{ provider: LiveSearchProvider; execute: () => Promise<EvidenceDraft[]> }> = [
      { provider: 'baidu', execute: () => this.client.get(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=0&rn=10&tn=baidu`, {
        ...requestOptions,
        headers: { Cookie: 'BDUSS=dummy;' },
      }).then((response) => parseBaiduSearchHtml(response.data, perProvider)) },
      { provider: 'bing', execute: () => this.client.get(`https://cn.bing.com/search?q=${encodeURIComponent(query)}&first=1`, requestOptions)
        .then((response) => parseBingSearchHtml(response.data, perProvider)) },
      { provider: 'sogou', execute: () => this.client.get(`https://www.sogou.com/web?query=${encodeURIComponent(query)}`, {
        ...requestOptions,
        headers: { Cookie: suv },
        referer: 'https://www.sogou.com/',
      }).then((response) => parseSogouSearchHtml(response.data, perProvider)) },
      { provider: 'so360', execute: () => this.client.get(`https://www.so.com/s?q=${encodeURIComponent(query)}&pn=1`, requestOptions)
        .then((response) => parseSo360SearchHtml(response.data, perProvider)) },
      { provider: 'toutiao', execute: () => this.client.get(`https://so.toutiao.com/search?keyword=${encodeURIComponent(query)}&pd=synthesis&dvpf=pc`, {
        ...requestOptions,
        referer: 'https://so.toutiao.com/',
        autoCookie: false,
      }).then((response) => parseToutiaoSearchHtml(response.data, perProvider)) },
      { provider: 'quark', execute: () => this.client.get(`https://m.sm.cn/s?q=${encodeURIComponent(query)}&page=1&layout=html`, {
        ...requestOptions,
        mode: 'mobile',
        referer: 'https://m.sm.cn/',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 Quark/6.5.0.1234',
        },
      }).then((response) => parseQuarkSearchHtml(response.data, perProvider)) },
      { provider: 'chinaso', execute: () => this.client.get(`https://www.chinaso.com/newssearch/all/allResults?q=${encodeURIComponent(query)}&pn=1`, {
        ...requestOptions,
        referer: 'https://www.chinaso.com/',
      }).then((response) => parseChinaSoSearchHtml(response.data, perProvider)) },
    ];
    const enabledProviders = new Set(listLiveSearchConnectorIds());
    const settled = await Promise.allSettled(
      requests.filter(({ provider }) => enabledProviders.has(provider)).map(({ execute }) => execute()),
    );
    options.signal?.throwIfAborted();
    const groups = settled.map((result) => result.status === 'fulfilled' ? result.value : []);
    const fetchedAt = new Date().toISOString();
    const deduped = deduplicate(roundRobin(groups));
    const filtered = filterRelevantSearchResults(deduped, rawTrimmed);
    const evidence = filtered
      .slice(0, Math.max(1, Math.min(12, options.limit || 8)))
      .map((draft, index) => ({ ...draft, id: `S${index + 1}`, fetchedAt }));
    if (!options.readMode || options.readMode === 'snippet') return evidence;

    const readCount = Math.max(1, Math.min(
      evidence.length,
      options.maxReadItems || (options.readMode === 'full' ? 5 : 3),
    ));
    const enriched = await Promise.allSettled(evidence.slice(0, readCount).map(async (item) => {
      const article = await this.reader.read(item.sourceUrl, {
        timeoutMs: 3_500,
        signal: options.signal,
      });
      return {
        ...item,
        title: article.title || item.title,
        sourceUrl: article.content_url || item.sourceUrl,
        excerpt: article.description.slice(0, 5_000) || item.excerpt,
        publisher: article.creator_name || article.site_name || item.publisher,
        publishedAt: article.published_at ? String(article.published_at) : item.publishedAt,
      };
    }));
    options.signal?.throwIfAborted();
    return evidence.map((item, index) => {
      const result = enriched[index];
      return result?.status === 'fulfilled' ? result.value : item;
    });
  }
}

export const liveSearchService = new LiveSearchService();
