import * as cheerio from 'cheerio';
import { AbstractCrawler, connectToElectronChromium, getElectronCrawlerPage } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';
import { reportKeywordSearchCompletion, searchPageBudget } from '../base/connectorHelpers';

export const SEARCH_ENGINE_ITEM_LIMIT = 500;
export const SEARCH_ENGINE_BATCH_SIZE = 100;
const SEARCH_ENGINE_STAGNANT_PAGE_LIMIT = 2;

/**
 * Search result cards frequently contain tracking fragments and parameters.
 * Normalize only known tracking noise so distinct result pages remain distinct.
 */
export function canonicalSearchResultUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|from|source|src|spm|ref|referrer|tracking_id)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

export function searchEnginePageBudget(target: number, expectedPageSize = 10): number {
  // Extra pages compensate for ads, invalid cards and duplicates. The hard
  // ceiling still bounds a malformed or endlessly repeating SERP.
  return searchPageBudget(target, expectedPageSize, 5, 60);
}

async function pauseAfterCompletedBatch(
  platform: string,
  keyword: string,
  collected: number,
  target: number,
  nextBoundary: number,
): Promise<number> {
  if (target <= SEARCH_ENGINE_BATCH_SIZE || collected < nextBoundary || collected >= target) return nextBoundary;
  console.log(`[${platform}] 关键词“${keyword}”已完成 ${collected}/${target} 条，批次间暂停以降低平台压力...`);
  await sleep(1500);
  return nextBoundary + SEARCH_ENGINE_BATCH_SIZE;
}

function reportSearchFinished(platform: string, keyword: string, collected: number, target: number, reason: string): void {
  reportKeywordSearchCompletion(platform, keyword, collected, target, reason);
  console.log(`[${platform}] 关键词“${keyword}”结束：目标 ${target} 条，实际 ${collected} 条；${reason}`);
}

function cleanText(str: string): string {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveRealUrl(encryptedUrl: string): Promise<string> {
  if (!encryptedUrl || !encryptedUrl.startsWith('http')) return encryptedUrl;
  try {
    const res = await systemHttpClient.head(encryptedUrl, { timeout: 3000 });
    return res.headers.location || encryptedUrl;
  } catch (err: any) {
    if (err.response?.headers?.location) {
      return err.response.headers.location;
    }
    return encryptedUrl;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// 1. Baidu Search Crawler (SystemHttpClient + Multi-Page Pagination)
export class BaiduCrawler extends AbstractCrawler {
  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;
    const maxPages = searchEnginePageBudget(maxItems);

    for (const keyword of keywords) {
      console.log(`[BAIDU] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;
      let stagnantPages = 0;
      let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;
      let stopReason = '已达到平台分页预算';
      const seen = new Set<string>();

      for (let page = startPage; page < startPage + maxPages; page++) {
        if (totalRank >= maxItems) break;

        const pn = (page - 1) * 10;
        const url = `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}&pn=${pn}&rn=10&tn=baidu`;
        console.log(`[BAIDU] Fetching page ${page} (pn=${pn})...`);

        try {
          const res = await systemHttpClient.get(url, {
            mode: 'desktop',
            headers: { 'Cookie': 'BDUSS=dummy;' },
            timeout: 8000,
          });

          const $ = cheerio.load(res.data);
          const containers = $('.c-container, .result, div[srcid]');

          if (containers.length === 0) {
            console.log(`[BAIDU] No items found on page ${page}. Stopping pagination.`);
            stopReason = `第 ${page} 页没有返回搜索结果`;
            break;
          }

          const drafts: Array<{
            title: string; encryptedUrl: string; snippet: string; publisher: string;
            publishTime: string; images: string[];
          }> = [];
          for (let i = 0; i < containers.length; i++) {
            const $item = $(containers[i]);
            const $titleLink = $item.find('h3 a').first();
            const encryptedUrl = $titleLink.attr('href') || '';
            const title = cleanText($titleLink.text());

            if (!title || !encryptedUrl) continue;

            let snippet = cleanText(
              $item.find('.c-abstract, .content-right, .c-span-last, .c-font-normal, [class*="content-"]').first().text() ||
              $item.find('p').first().text()
            );
            if (!snippet) {
              snippet = cleanText($item.text().replace(title, '')).slice(0, 150);
            }

            const publisher = cleanText($item.find('.c-showurl, .c-color-gray, [class*="showurl"]').first().text()) || '百度搜索';
            const timeMatch = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec($item.text());

            const images: string[] = [];
            $item.find('img').each((_, imgEl) => {
              const src = $(imgEl).attr('src');
              if (src && src.startsWith('http')) images.push(src);
            });

            drafts.push({
              title,
              encryptedUrl,
              snippet,
              publisher,
              publishTime: timeMatch ? timeMatch[1] : '',
              images,
            });
          }

          const resolvedDrafts = await mapWithConcurrency(drafts, 4, async (draft) => ({
            ...draft,
            realUrl: await resolveRealUrl(draft.encryptedUrl),
          }));
          let pageAdded = 0;
          for (const draft of resolvedDrafts) {
            if (totalRank >= maxItems) break;
            const dedupeKey = canonicalSearchResultUrl(draft.realUrl || draft.encryptedUrl);
            if (!dedupeKey || seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            totalRank++;
            pageAdded++;
            await connectorOutput.emitSearchEngineResult({
              search_engine: 'baidu',
              title: draft.title,
              url: draft.encryptedUrl,
              real_url: draft.realUrl,
              snippet: draft.snippet,
              publisher: draft.publisher,
              publish_time: draft.publishTime,
              images: draft.images,
              search_rank: totalRank,
              source_keyword: keyword,
            });

            console.log(`[BAIDU] [P${page} #${totalRank}/${maxItems}] ${draft.title} -> ${draft.realUrl}`);
          }

          stagnantPages = pageAdded === 0 ? stagnantPages + 1 : 0;
          if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) {
            stopReason = `连续 ${stagnantPages} 页没有新增有效链接`;
            break;
          }
          nextBatchBoundary = await pauseAfterCompletedBatch('BAIDU', keyword, totalRank, maxItems, nextBatchBoundary);
          if (totalRank < maxItems) await sleep(500);
        } catch (err: any) {
          console.error(`[BAIDU] Search failed on page ${page} for "${keyword}": ${err.message}`);
          stopReason = `第 ${page} 页请求失败：${err.message}`;
          break;
        }
      }
      if (totalRank >= maxItems) stopReason = '已达到用户设置的目标数量';
      reportSearchFinished('百度', keyword, totalRank, maxItems, stopReason);
    }
  }

  public async start(): Promise<void> {
    console.log('[BAIDU] Starting Baidu pure HTTP crawler with SystemHttpClient...');
    await this.search();
    console.log('[BAIDU] Baidu crawler finished.');
  }
}

// 2. Bing China Search Crawler (Hybrid: HTTP First + Playwright Fallback)
export interface BingSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publisher: string;
  publish_time: string;
  images: string[];
}

export class BingCrawler extends AbstractCrawler {
  private async searchViaHttp(keyword: string, maxItems: number, startPage: number): Promise<BingSearchResultItem[]> {
    const maxPages = searchEnginePageBudget(maxItems);
    const results: BingSearchResultItem[] = [];
    const seen = new Set<string>();
    let stagnantPages = 0;
    let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;

    for (let page = startPage; page < startPage + maxPages; page++) {
      if (results.length >= maxItems) break;

      const first = (page - 1) * 10 + 1;
      const url = `https://cn.bing.com/search?q=${encodeURIComponent(keyword)}&first=${first}`;
      console.log(`[BING] [HTTP] Fetching page ${page} (first=${first})...`);

      try {
        const res = await systemHttpClient.get(url, { mode: 'desktop', timeout: 8000 });
        const $ = cheerio.load(res.data);
        const containers = $('li.b_algo, #b_results > li.b_algo, .b_algo');

        if (containers.length === 0) {
          console.log(`[BING] [HTTP] No items found on page ${page}.`);
          break;
        }

        let pageCount = 0;
        for (let i = 0; i < containers.length; i++) {
          if (results.length >= maxItems) break;

          const $item = $(containers[i]);
          const $titleLink = $item.find('h2 a').first();
          const pageUrl = $titleLink.attr('href') || '';
          const title = cleanText($titleLink.text());

          if (!title || !pageUrl) continue;
          const dedupeKey = canonicalSearchResultUrl(pageUrl);
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          pageCount++;

          let snippet = cleanText(
            $item.find('.b_algoSlug, .b_caption, p, [class*="b_lineclamp"]').first().text()
          );
          if (!snippet) {
            snippet = cleanText($item.text().replace(title, '')).slice(0, 150);
          }

          const publisher = cleanText($item.find('cite, .news-attribution').first().text()) || '必应搜索';
          const timeMatch = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec($item.text());

          const images: string[] = [];
          $item.find('img').each((_, imgEl) => {
            const src = $(imgEl).attr('src');
            if (src && src.startsWith('http')) images.push(src);
          });

          results.push({
            title,
            url: pageUrl,
            snippet,
            publisher,
            publish_time: timeMatch ? timeMatch[1] : '',
            images,
          });
        }

        stagnantPages = pageCount === 0 ? stagnantPages + 1 : 0;
        if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) break;
        nextBatchBoundary = await pauseAfterCompletedBatch('BING', keyword, results.length, maxItems, nextBatchBoundary);
        await sleep(800);
      } catch (err: any) {
        console.error(`[BING] [HTTP] Page ${page} failed: ${err.message}`);
        break;
      }
    }

    return results;
  }

  private async searchViaBrowser(keyword: string, maxItems: number, startPage: number): Promise<BingSearchResultItem[]> {
    console.log(`[BING] [Browser Fallback] Initializing Playwright browser page for keyword "${keyword}"...`);
    const results: BingSearchResultItem[] = [];
    const seen = new Set<string>();
    let stagnantPages = 0;
    let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;

    try {
      const playwright = require('playwright');
      const browserContext = await connectToElectronChromium(playwright);
      const page = await getElectronCrawlerPage(browserContext, 'bing');

      const maxPages = searchEnginePageBudget(maxItems);
      for (let p = startPage; p < startPage + maxPages; p++) {
        if (results.length >= maxItems) break;

        const first = (p - 1) * 10 + 1;
        const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(keyword)}&first=${first}`;
        console.log(`[BING] [Browser Fallback] Navigating to page ${p}: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('li.b_algo, #b_results > li.b_algo, .b_algo', { timeout: 6000 }).catch(() => {});

        const pageContent = await page.content();
        const $ = cheerio.load(pageContent);
        const containers = $('li.b_algo, #b_results > li.b_algo, .b_algo');

        if (containers.length === 0) {
          console.log(`[BING] [Browser Fallback] No items found on page ${p}.`);
          break;
        }

        let pageCount = 0;
        for (let i = 0; i < containers.length; i++) {
          if (results.length >= maxItems) break;

          const $item = $(containers[i]);
          const $titleLink = $item.find('h2 a').first();
          const pageUrl = $titleLink.attr('href') || '';
          const title = cleanText($titleLink.text());

          if (!title || !pageUrl) continue;
          const dedupeKey = canonicalSearchResultUrl(pageUrl);
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          pageCount++;

          let snippet = cleanText(
            $item.find('.b_algoSlug, .b_caption, p, [class*="b_lineclamp"]').first().text()
          );
          if (!snippet) {
            snippet = cleanText($item.text().replace(title, '')).slice(0, 150);
          }

          const publisher = cleanText($item.find('cite, .news-attribution').first().text()) || '必应搜索';
          const timeMatch = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec($item.text());

          const images: string[] = [];
          $item.find('img').each((_, imgEl) => {
            const src = $(imgEl).attr('src');
            if (src && src.startsWith('http')) images.push(src);
          });

          results.push({
            title,
            url: pageUrl,
            snippet,
            publisher,
            publish_time: timeMatch ? timeMatch[1] : '',
            images,
          });
        }

        stagnantPages = pageCount === 0 ? stagnantPages + 1 : 0;
        if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) break;
        nextBatchBoundary = await pauseAfterCompletedBatch('BING', keyword, results.length, maxItems, nextBatchBoundary);
        await this.humanDelay(page, 2);
      }
    } catch (err: any) {
      console.error(`[BING] [Browser Fallback] Search failed: ${err.message}`);
    }

    return results;
  }

  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;

    for (const keyword of keywords) {
      console.log(`[BING] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);

      const items = await this.executeHybrid(
        () => this.searchViaHttp(keyword, maxItems, startPage),
        () => this.searchViaBrowser(keyword, maxItems, startPage)
      );

      let rank = 0;
      for (const item of items) {
        rank++;
        await connectorOutput.emitSearchEngineResult({
          search_engine: 'bing',
          title: item.title,
          url: item.url,
          real_url: item.url,
          snippet: item.snippet,
          publisher: item.publisher,
          publish_time: item.publish_time,
          images: item.images,
          search_rank: rank,
          source_keyword: keyword,
        });

        console.log(`[BING] [#${rank}/${maxItems}] ${item.title} -> ${item.url}`);
      }
      reportSearchFinished('必应', keyword, rank, maxItems,
        rank >= maxItems ? '已达到用户设置的目标数量' : '平台已无更多有效结果或分页请求提前结束');
    }
  }

  public async start(): Promise<void> {
    console.log('[BING] Starting Bing China hybrid crawler (HTTP + Playwright fallback)...');
    await this.search();
    console.log('[BING] Bing China crawler finished.');
  }
}

// 3. 360 Search Crawler (SystemHttpClient + Multi-Page Pagination)
export class So360Crawler extends AbstractCrawler {
  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;
    const maxPages = searchEnginePageBudget(maxItems);

    for (const keyword of keywords) {
      console.log(`[360] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;
      let stagnantPages = 0;
      let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;
      let stopReason = '已达到平台分页预算';
      const seen = new Set<string>();

      for (let page = startPage; page < startPage + maxPages; page++) {
        if (totalRank >= maxItems) break;

        const url = `https://www.so.com/s?q=${encodeURIComponent(keyword)}&pn=${page}`;
        console.log(`[360] Fetching page ${page} (pn=${page})...`);

        try {
          const res = await systemHttpClient.get(url, { mode: 'desktop', timeout: 8000 });
          const $ = cheerio.load(res.data);
          const containers = $('li.res-list');

          if (containers.length === 0) {
            console.log(`[360] No items found on page ${page}. Stopping pagination.`);
            stopReason = `第 ${page} 页没有返回搜索结果`;
            break;
          }

          const drafts: Array<{
            title: string; encryptedUrl: string; snippet: string; publisher: string;
            publishTime: string; images: string[];
          }> = [];
          for (let i = 0; i < containers.length; i++) {
            const $item = $(containers[i]);
            const $titleLink = $item.find('h3.res-title a, h3 a').first();
            const encryptedUrl = $titleLink.attr('href') || '';
            const title = cleanText($titleLink.text());

            if (!title || !encryptedUrl) continue;

            let snippet = cleanText(
              $item.find('.res-desc, .res-rich, p.res-desc').first().text()
            );
            if (!snippet) {
              snippet = cleanText($item.text().replace(title, '')).slice(0, 150);
            }

            const publisher = cleanText($item.find('.res-site, .res-link').first().text()) || '360搜索';
            const timeMatch = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec($item.text());

            const images: string[] = [];
            $item.find('img').each((_, imgEl) => {
              const src = $(imgEl).attr('src');
              if (src && src.startsWith('http')) images.push(src);
            });

            drafts.push({
              title,
              encryptedUrl,
              snippet,
              publisher,
              publishTime: timeMatch ? timeMatch[1] : '',
              images,
            });
          }

          const resolvedDrafts = await mapWithConcurrency(drafts, 4, async (draft) => ({
            ...draft,
            realUrl: await resolveRealUrl(draft.encryptedUrl),
          }));
          let pageAdded = 0;
          for (const draft of resolvedDrafts) {
            if (totalRank >= maxItems) break;
            const dedupeKey = canonicalSearchResultUrl(draft.realUrl || draft.encryptedUrl);
            if (!dedupeKey || seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            totalRank++;
            pageAdded++;
            await connectorOutput.emitSearchEngineResult({
              search_engine: 'so360',
              title: draft.title,
              url: draft.encryptedUrl,
              real_url: draft.realUrl,
              snippet: draft.snippet,
              publisher: draft.publisher,
              publish_time: draft.publishTime,
              images: draft.images,
              search_rank: totalRank,
              source_keyword: keyword,
            });

            console.log(`[360] [P${page} #${totalRank}/${maxItems}] ${draft.title} -> ${draft.realUrl}`);
          }

          stagnantPages = pageAdded === 0 ? stagnantPages + 1 : 0;
          if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) {
            stopReason = `连续 ${stagnantPages} 页没有新增有效链接`;
            break;
          }
          nextBatchBoundary = await pauseAfterCompletedBatch('360', keyword, totalRank, maxItems, nextBatchBoundary);
          if (totalRank < maxItems) await sleep(500);
        } catch (err: any) {
          console.error(`[360] Search failed on page ${page} for "${keyword}": ${err.message}`);
          stopReason = `第 ${page} 页请求失败：${err.message}`;
          break;
        }
      }
      if (totalRank >= maxItems) stopReason = '已达到用户设置的目标数量';
      reportSearchFinished('360 搜索', keyword, totalRank, maxItems, stopReason);
    }
  }

  public async start(): Promise<void> {
    console.log('[360] Starting 360 Search pure HTTP crawler with SystemHttpClient...');
    await this.search();
    console.log('[360] 360 Search crawler finished.');
  }
}

// 4. Toutiao Search Crawler (Hybrid: HTTP First + Playwright Fallback)
export interface ToutiaoSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publisher: string;
  publish_time: string;
  images: string[];
}

/** Toutiao paginates through `page_num` (0-based) and requires the `search_id` minted by page 0. */
interface ToutiaoPageResult {
  items: ToutiaoSearchResultItem[];
  searchId: string;
}

const TOUTIAO_RESULTS_PER_PAGE = 10;

function toutiaoPageUrl(keyword: string, pageNum: number, searchId: string): string {
  const base = `https://so.toutiao.com/search?keyword=${encodeURIComponent(keyword)}&pd=synthesis&dvpf=pc`;
  if (pageNum <= 0) return base;
  return `${base}&source=pagination&action_type=pagination&page_num=${pageNum}` +
    `&search_id=${encodeURIComponent(searchId)}&from=search_tab&cur_tab_title=search_tab`;
}

function firstHttpUrl(...candidates: any[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^https?:\/\//.test(candidate)) return candidate;
  }
  return '';
}

/**
 * Toutiao renders each result card twice: once as SSR markup, and once as a
 * `<script type="application/json">` payload used to hydrate it. The markup is
 * emotion-generated and frequently degrades to an empty `undefined-default`
 * placeholder, so the JSON payload is the only reliable source. Web results
 * (external sites) nest their fields under `display`, while Toutiao-hosted
 * articles and 微头条 expose them at the top level — hence the field fallbacks.
 */
function parseToutiaoPage(html: string): ToutiaoPageResult {
  const $ = cheerio.load(html);
  const items: ToutiaoSearchResultItem[] = [];

  $('script[data-druid-card-data-id][type="application/json"]').each((_, el) => {
    let parsed: any;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return;
    }

    const data = parsed?.data;
    if (!data || typeof data !== 'object') return;

    const display = data.display && typeof data.display === 'object' ? data.display : {};
    const info = display.info && typeof display.info === 'object' ? display.info : {};

    const title = cleanText(data.title || display.title?.text || data.emphasized?.title || '');
    const url = firstHttpUrl(
      data.article_url, info.url, data.url, data.share_url,
      data.ttsearch_msite_url, data.source_url, data.open_url
    );
    if (!title || !url) return;

    const snippet = cleanText(
      data.abstract || display.summary?.text || data.emphasized?.summary || data.hot_board_summary || ''
    );
    const publisher = cleanText(data.media_name || data.source || info.site_name || info.domain || '') || '头条搜索';

    let publishTime = cleanText(data.datetime || '');
    if (!publishTime) {
      const ts = Number(data.publish_time || data.create_time || data.behot_time || data.display_time);
      if (Number.isFinite(ts) && ts > 1e9) {
        publishTime = new Date(ts * 1000).toISOString().slice(0, 19).replace('T', ' ');
      }
    }

    const images: string[] = [];
    for (const candidate of [data.large_image_url, data.middle_image_url, data.image_url, ...(Array.isArray(info.images) ? info.images : [])]) {
      const img = firstHttpUrl(candidate);
      if (img) images.push(img);
    }
    for (const entry of Array.isArray(data.image_list) ? data.image_list : []) {
      const img = firstHttpUrl(entry?.url);
      if (img) images.push(img);
    }

    items.push({
      title,
      url,
      snippet,
      publisher,
      publish_time: publishTime,
      // Cards can carry a dozen near-identical thumbnails; keep the payload small.
      images: [...new Set(images)].slice(0, 5),
    });
  });

  const searchIdMatch = /"searchId"\s*:\s*"([0-9A-Za-z]+)"/.exec(html);
  return { items, searchId: searchIdMatch ? searchIdMatch[1] : '' };
}

export class ToutiaoCrawler extends AbstractCrawler {
  private async fetchPage(keyword: string, pageNum: number, searchId: string): Promise<ToutiaoPageResult> {
    const res = await systemHttpClient.get(toutiaoPageUrl(keyword, pageNum, searchId), {
      mode: 'desktop',
      referer: 'https://so.toutiao.com/',
      timeout: 8000,
      // Toutiao's own session cookies make it report `has_more: 0` from the third
      // page onwards, capping every keyword at ~15 results. Staying cookie-less
      // keeps pagination alive for the full ~14 pages the SERP advertises.
      autoCookie: false,
    });
    return parseToutiaoPage(res.data);
  }

  private async searchViaHttp(keyword: string, maxItems: number, startPage: number): Promise<ToutiaoSearchResultItem[]> {
    const maxPages = searchEnginePageBudget(maxItems, TOUTIAO_RESULTS_PER_PAGE);
    const results: ToutiaoSearchResultItem[] = [];
    const seen = new Set<string>();
    let stagnantPages = 0;
    let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;
    let searchId = '';

    // Pagination needs the search_id minted by page 0, so a non-default start
    // page still has to fetch it first (its results are then skipped).
    const firstPageNum = Math.max(0, startPage - 1);
    if (firstPageNum > 0) {
      console.log(`[TOUTIAO] [HTTP] Priming search_id from page 1 before jumping to page ${startPage}...`);
      try {
        searchId = (await this.fetchPage(keyword, 0, '')).searchId;
        await sleep(1000);
      } catch (err: any) {
        console.error(`[TOUTIAO] [HTTP] Failed to prime search_id: ${err.message}`);
        return results;
      }
      if (!searchId) {
        console.error('[TOUTIAO] [HTTP] Could not obtain a search_id; aborting.');
        return results;
      }
    }

    for (let page = startPage; page < startPage + maxPages; page++) {
      if (results.length >= maxItems) break;

      const pageNum = page - 1;
      console.log(`[TOUTIAO] [HTTP] Fetching page ${page} (page_num=${pageNum})...`);

      try {
        let parsed = await this.fetchPage(keyword, pageNum, searchId);
        if (!searchId) searchId = parsed.searchId;

        // Toutiao intermittently answers with a bootstrap shell that carries no
        // hydration payloads at all — including on the very first request, which
        // still mints a usable search_id. One re-request through the pagination
        // form reliably recovers the page, so an empty body is retried rather
        // than treated as the end of the result set.
        if (parsed.items.length === 0 && searchId) {
          console.log(`[TOUTIAO] [HTTP] Page ${page} returned no payload; retrying via pagination form...`);
          await sleep(900);
          parsed = await this.fetchPage(keyword, pageNum, searchId);
        }

        if (parsed.items.length === 0) {
          console.log(`[TOUTIAO] [HTTP] Page ${page} is empty after retry. Stopping pagination.`);
          break;
        }

        let pageCount = 0;
        for (const item of parsed.items) {
          if (results.length >= maxItems) break;
          const dedupeKey = canonicalSearchResultUrl(item.url);
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          results.push(item);
          pageCount++;
        }

        stagnantPages = pageCount === 0 ? stagnantPages + 1 : 0;
        if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) {
          console.log(`[TOUTIAO] [HTTP] ${stagnantPages} consecutive pages only repeated earlier results. Stopping pagination.`);
          break;
        }
        nextBatchBoundary = await pauseAfterCompletedBatch('TOUTIAO', keyword, results.length, maxItems, nextBatchBoundary);
        await sleep(1000);
      } catch (err: any) {
        console.error(`[TOUTIAO] [HTTP] Page ${page} failed: ${err.message}`);
        break;
      }
    }

    return results;
  }

  private async searchViaBrowser(keyword: string, maxItems: number, startPage: number): Promise<ToutiaoSearchResultItem[]> {
    console.log(`[TOUTIAO] [Browser Fallback] Initializing Playwright browser page for keyword "${keyword}"...`);
    const results: ToutiaoSearchResultItem[] = [];
    const seen = new Set<string>();
    let stagnantPages = 0;
    let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;
    let searchId = '';

    try {
      const playwright = require('playwright');
      const browserContext = await connectToElectronChromium(playwright);
      const page = await getElectronCrawlerPage(browserContext, 'toutiao');

      // Same as the HTTP path: pagination is keyed on page 0's search_id.
      if (startPage > 1) {
        console.log(`[TOUTIAO] [Browser Fallback] Priming search_id from page 1 before jumping to page ${startPage}...`);
        await page.goto(toutiaoPageUrl(keyword, 0, ''), { waitUntil: 'domcontentloaded', timeout: 25000 });
        searchId = parseToutiaoPage(await page.content()).searchId;
        if (!searchId) {
          console.error('[TOUTIAO] [Browser Fallback] Could not obtain a search_id; aborting.');
          return results;
        }
        await this.humanDelay(page, 2);
      }

      const maxPages = searchEnginePageBudget(maxItems, TOUTIAO_RESULTS_PER_PAGE);
      for (let p = startPage; p < startPage + maxPages; p++) {
        if (results.length >= maxItems) break;

        const pageNum = p - 1;
        const searchUrl = toutiaoPageUrl(keyword, pageNum, searchId);
        console.log(`[TOUTIAO] [Browser Fallback] Navigating to page ${p}: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForSelector('.result-content', { timeout: 6000 }).catch(() => {});

        const parsed = parseToutiaoPage(await page.content());
        if (!searchId) searchId = parsed.searchId;

        let pageCount = 0;
        for (const item of parsed.items) {
          if (results.length >= maxItems) break;
          const dedupeKey = canonicalSearchResultUrl(item.url);
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          results.push(item);
          pageCount++;
        }

        stagnantPages = pageCount === 0 ? stagnantPages + 1 : 0;
        if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) {
          console.log(`[TOUTIAO] [Browser Fallback] ${stagnantPages} consecutive pages returned no new items.`);
          break;
        }
        nextBatchBoundary = await pauseAfterCompletedBatch('TOUTIAO', keyword, results.length, maxItems, nextBatchBoundary);
        await this.humanDelay(page, 2);
      }
    } catch (err: any) {
      console.error(`[TOUTIAO] [Browser Fallback] Search failed: ${err.message}`);
    }

    return results;
  }

  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;

    for (const keyword of keywords) {
      console.log(`[TOUTIAO] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);

      const items = await this.executeHybrid(
        () => this.searchViaHttp(keyword, maxItems, startPage),
        () => this.searchViaBrowser(keyword, maxItems, startPage)
      );

      let rank = 0;
      for (const item of items) {
        rank++;
        await connectorOutput.emitSearchEngineResult({
          search_engine: 'toutiao',
          title: item.title,
          url: item.url,
          real_url: item.url,
          snippet: item.snippet,
          publisher: item.publisher,
          publish_time: item.publish_time,
          images: item.images,
          search_rank: rank,
          source_keyword: keyword,
        });

        console.log(`[TOUTIAO] [#${rank}/${maxItems}] ${item.title} -> ${item.url}`);
      }
      reportSearchFinished('头条搜索', keyword, rank, maxItems,
        rank >= maxItems ? '已达到用户设置的目标数量' : '平台已无更多有效结果或分页请求提前结束');
    }
  }

  public async start(): Promise<void> {
    console.log('[TOUTIAO] Starting Toutiao Search hybrid crawler (HTTP + Playwright fallback)...');
    await this.search();
    console.log('[TOUTIAO] Toutiao Search crawler finished.');
  }
}

// 5. Sogou Search Crawler (SystemHttpClient + Multi-Page Pagination + Mobile Fallback)
export class SogouCrawler extends AbstractCrawler {
  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;
    const maxPages = searchEnginePageBudget(maxItems);

    for (const keyword of keywords) {
      console.log(`[SOGOU] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;
      let stagnantPages = 0;
      let nextBatchBoundary = SEARCH_ENGINE_BATCH_SIZE;
      let stopReason = '已达到平台分页预算';
      const seen = new Set<string>();

      for (let page = startPage; page < startPage + maxPages; page++) {
        if (totalRank >= maxItems) break;

        console.log(`[SOGOU] Fetching page ${page}...`);
        let pageItems: { title: string; url: string; snippet: string; publisher: string; images: string[]; time: string }[] = [];

        // Strategy A: Try PC Search via SystemHttpClient
        try {
          const pcUrl = `https://www.sogou.com/web?query=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
          const suv = `SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`;
          const referer = page === 1 ? 'https://www.sogou.com/' : `https://www.sogou.com/web?query=${encodeURIComponent(keyword)}&page=${page - 1}`;

          const res = await systemHttpClient.get(pcUrl, {
            mode: 'desktop',
            headers: { 'Cookie': suv },
            referer,
            timeout: 6000,
          });

          const finalUrl = res.request?.res?.responseUrl || res.config.url || '';
          if (!finalUrl.includes('antispider')) {
            const $ = cheerio.load(res.data);
            $('.vrwrap, .rb, div.results > div').each((_, el) => {
              const $item = $(el);
              const $titleLink = $item.find('h3.vr-title a, h3.pt a, h3 a').first();
              let rawLink = $titleLink.attr('href') || '';
              const title = cleanText($titleLink.text());
              if (!title || !rawLink) return;
              if (rawLink.startsWith('/')) rawLink = `https://www.sogou.com${rawLink}`;

              let snippet = cleanText(
                $item.find('.star-wiki, .space-txt, .str_pack_wrp, .ft, .txt-box, p').first().text()
              );
              if (!snippet) snippet = cleanText($item.text().replace(title, '')).slice(0, 150);

              const publisher = cleanText($item.find('.cite, .citeurl, .fb').first().text()) || '搜狗搜索';
              const timeMatch = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec($item.text());

              const images: string[] = [];
              $item.find('img').each((_, imgEl) => {
                const imgSrc = $(imgEl).attr('src');
                if (imgSrc) {
                  if (imgSrc.startsWith('http')) images.push(imgSrc);
                  else if (imgSrc.startsWith('//')) images.push('https:' + imgSrc);
                }
              });

              pageItems.push({
                title,
                url: rawLink,
                snippet,
                publisher,
                images,
                time: timeMatch ? timeMatch[1] : '',
              });
            });
          }
        } catch (err: any) {
          console.log(`[SOGOU] [PC] Page ${page} failed: ${err.message}`);
        }

        // Strategy B: Fallback to Mobile Search via SystemHttpClient
        if (pageItems.length === 0) {
          console.log(`[SOGOU] [Mobile Fallback] Fetching Page ${page}...`);
          try {
            const mobileUrl = `https://m.sogou.com/web/searchList.jsp?keyword=${encodeURIComponent(keyword)}&page=${page}`;
            const res = await systemHttpClient.get(mobileUrl, { mode: 'mobile', timeout: 6000 });
            const $ = cheerio.load(res.data);

            $('.vrResult, .result, div[class*="result"]').each((_, el) => {
              const $item = $(el);
              const $titleLink = $item.find('h3 a, a.tit, a[class*="title"]').first();
              let rawLink = $titleLink.attr('href') || $item.find('a').attr('href') || '';
              const title = cleanText($titleLink.text() || $item.find('h3').text());
              if (!title) return;

              const snippet = cleanText($item.find('.summary, .desc, p, div[class*="summary"]').first().text());
              const publisher = cleanText($item.find('.site, .cite, .citeurl').first().text()) || '搜狗搜索';

              const images: string[] = [];
              $item.find('img').each((_, imgEl) => {
                const imgSrc = $(imgEl).attr('src');
                if (imgSrc) {
                  if (imgSrc.startsWith('http')) images.push(imgSrc);
                  else if (imgSrc.startsWith('//')) images.push('https:' + imgSrc);
                }
              });

              pageItems.push({
                title,
                url: rawLink,
                snippet,
                publisher,
                images,
                time: '',
              });
            });
          } catch (err: any) {
            console.error(`[SOGOU] [Mobile Fallback] Page ${page} failed: ${err.message}`);
          }
        }

        if (pageItems.length === 0) {
          console.log(`[SOGOU] No items found on page ${page}. Stopping pagination.`);
          stopReason = `第 ${page} 页没有返回搜索结果`;
          break;
        }

        // Resolve the whole page before applying the remaining target. Cutting
        // the raw cards first lets duplicates consume the final slots and can
        // falsely report a stagnant page while later cards are still unique.
        const currentPageItems = pageItems;
        const resolvedItems = await mapWithConcurrency(currentPageItems, 4, async (item) => ({
          item,
          realUrl: await resolveRealUrl(item.url),
        }));
        let pageAdded = 0;
        for (const { item, realUrl } of resolvedItems) {
          if (totalRank >= maxItems) break;
          const dedupeKey = canonicalSearchResultUrl(realUrl || item.url);
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          totalRank++;
          pageAdded++;
          await connectorOutput.emitSearchEngineResult({
            search_engine: 'sogou',
            title: item.title,
            url: item.url,
            real_url: realUrl,
            snippet: item.snippet,
            publisher: item.publisher,
            publish_time: item.time,
            images: item.images,
            search_rank: totalRank,
            source_keyword: keyword,
          });

          console.log(`[SOGOU] [P${page} #${totalRank}/${maxItems}] ${item.title} -> ${realUrl}`);
        }

        stagnantPages = pageAdded === 0 ? stagnantPages + 1 : 0;
        if (stagnantPages >= SEARCH_ENGINE_STAGNANT_PAGE_LIMIT) {
          stopReason = `连续 ${stagnantPages} 页没有新增有效链接`;
          break;
        }
        nextBatchBoundary = await pauseAfterCompletedBatch('SOGOU', keyword, totalRank, maxItems, nextBatchBoundary);
        if (totalRank < maxItems) await sleep(600);
      }
      if (totalRank >= maxItems) stopReason = '已达到用户设置的目标数量';
      reportSearchFinished('搜狗搜索', keyword, totalRank, maxItems, stopReason);
    }
  }

  public async start(): Promise<void> {
    console.log('[SOGOU] Starting Sogou Search pure HTTP crawler with SystemHttpClient...');
    await this.search();
    console.log('[SOGOU] Sogou Search crawler finished.');
  }
}
