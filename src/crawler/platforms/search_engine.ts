import * as cheerio from 'cheerio';
import { AbstractCrawler } from '../base/BaseCrawler';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { systemHttpClient } from '../base/SystemHttpClient';

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

// 1. Baidu Search Crawler (SystemHttpClient + Multi-Page Pagination)
export class BaiduCrawler extends AbstractCrawler {
  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;
    const maxPages = Math.ceil(maxItems / 10);

    for (const keyword of keywords) {
      console.log(`[BAIDU] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;

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
            break;
          }

          let pageCount = 0;
          for (let i = 0; i < containers.length; i++) {
            if (totalRank >= maxItems) break;

            const $item = $(containers[i]);
            const $titleLink = $item.find('h3 a').first();
            const encryptedUrl = $titleLink.attr('href') || '';
            const title = cleanText($titleLink.text());

            if (!title || !encryptedUrl) continue;

            totalRank++;
            pageCount++;
            const realUrl = await resolveRealUrl(encryptedUrl);

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

            await connectorOutput.emitSearchEngineResult({
              search_engine: 'baidu',
              title,
              url: encryptedUrl,
              real_url: realUrl,
              snippet,
              publisher,
              publish_time: timeMatch ? timeMatch[1] : '',
              images,
              search_rank: totalRank,
              source_keyword: keyword,
            });

            console.log(`[BAIDU] [P${page} #${totalRank}/${maxItems}] ${title} -> ${realUrl}`);
          }

          if (pageCount === 0) break;
          await sleep(1000);
        } catch (err: any) {
          console.error(`[BAIDU] Search failed on page ${page} for "${keyword}": ${err.message}`);
          break;
        }
      }
    }
  }

  public async start(): Promise<void> {
    console.log('[BAIDU] Starting Baidu pure HTTP crawler with SystemHttpClient...');
    await this.search();
    console.log('[BAIDU] Baidu crawler finished.');
  }
}

// 2. Bing China Search Crawler (SystemHttpClient + Multi-Page Pagination)
export class BingCrawler extends AbstractCrawler {
  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;
    const maxPages = Math.ceil(maxItems / 10);

    for (const keyword of keywords) {
      console.log(`[BING] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;

      for (let page = startPage; page < startPage + maxPages; page++) {
        if (totalRank >= maxItems) break;

        const first = (page - 1) * 10 + 1;
        const url = `https://cn.bing.com/search?q=${encodeURIComponent(keyword)}&first=${first}`;
        console.log(`[BING] Fetching page ${page} (first=${first})...`);

        try {
          const res = await systemHttpClient.get(url, { mode: 'desktop', timeout: 8000 });
          const $ = cheerio.load(res.data);
          const containers = $('li.b_algo, #b_results > li.b_algo, .b_algo');

          if (containers.length === 0) {
            console.log(`[BING] No items found on page ${page}. Stopping pagination.`);
            break;
          }

          let pageCount = 0;
          for (let i = 0; i < containers.length; i++) {
            if (totalRank >= maxItems) break;

            const $item = $(containers[i]);
            const $titleLink = $item.find('h2 a').first();
            const pageUrl = $titleLink.attr('href') || '';
            const title = cleanText($titleLink.text());

            if (!title || !pageUrl) continue;

            totalRank++;
            pageCount++;

            let snippet = cleanText(
              $item.find('.b_algoSlug, .b_caption, p, [class*="b_lineclamp"]').first().text()
            );
            if (!snippet) {
              snippet = cleanText($item.text().replace(title, '')).slice(0, 150);
            }

            const publisher = cleanText($item.find('cite, .news-attribution').first().text()) || '必应中国';
            const timeMatch = /(\d{4}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日|\d+\s*(?:小时|分钟|天)前)/.exec($item.text());

            const images: string[] = [];
            $item.find('img').each((_, imgEl) => {
              const src = $(imgEl).attr('src');
              if (src && src.startsWith('http')) images.push(src);
            });

            await connectorOutput.emitSearchEngineResult({
              search_engine: 'bing',
              title,
              url: pageUrl,
              real_url: pageUrl,
              snippet,
              publisher,
              publish_time: timeMatch ? timeMatch[1] : '',
              images,
              search_rank: totalRank,
              source_keyword: keyword,
            });

            console.log(`[BING] [P${page} #${totalRank}/${maxItems}] ${title} -> ${pageUrl}`);
          }

          if (pageCount === 0) break;
          await sleep(1000);
        } catch (err: any) {
          console.error(`[BING] Search failed on page ${page} for "${keyword}": ${err.message}`);
          break;
        }
      }
    }
  }

  public async start(): Promise<void> {
    console.log('[BING] Starting Bing China pure HTTP crawler with SystemHttpClient...');
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
    const maxPages = Math.ceil(maxItems / 10);

    for (const keyword of keywords) {
      console.log(`[360] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;

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
            break;
          }

          let pageCount = 0;
          for (let i = 0; i < containers.length; i++) {
            if (totalRank >= maxItems) break;

            const $item = $(containers[i]);
            const $titleLink = $item.find('h3.res-title a, h3 a').first();
            const encryptedUrl = $titleLink.attr('href') || '';
            const title = cleanText($titleLink.text());

            if (!title || !encryptedUrl) continue;

            totalRank++;
            pageCount++;
            const realUrl = await resolveRealUrl(encryptedUrl);

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

            await connectorOutput.emitSearchEngineResult({
              search_engine: 'so360',
              title,
              url: encryptedUrl,
              real_url: realUrl,
              snippet,
              publisher,
              publish_time: timeMatch ? timeMatch[1] : '',
              images,
              search_rank: totalRank,
              source_keyword: keyword,
            });

            console.log(`[360] [P${page} #${totalRank}/${maxItems}] ${title} -> ${realUrl}`);
          }

          if (pageCount === 0) break;
          await sleep(1000);
        } catch (err: any) {
          console.error(`[360] Search failed on page ${page} for "${keyword}": ${err.message}`);
          break;
        }
      }
    }
  }

  public async start(): Promise<void> {
    console.log('[360] Starting 360 Search pure HTTP crawler with SystemHttpClient...');
    await this.search();
    console.log('[360] 360 Search crawler finished.');
  }
}

// 4. Sogou Search Crawler (SystemHttpClient + Multi-Page Pagination + Mobile Fallback)
export class SogouCrawler extends AbstractCrawler {
  public async search(): Promise<void> {
    const keywords = (activeConfig.KEYWORDS || '').split(',').map((k) => k.trim()).filter(Boolean);
    const maxItems = activeConfig.CRAWLER_MAX_NOTES_COUNT || 15;
    const startPage = activeConfig.START_PAGE || 1;
    const maxPages = Math.ceil(maxItems / 10);

    for (const keyword of keywords) {
      console.log(`[SOGOU] Searching keyword: "${keyword}" (max items: ${maxItems}, start page: ${startPage})...`);
      let totalRank = 0;

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
          break;
        }

        for (const item of pageItems) {
          if (totalRank >= maxItems) break;
          totalRank++;

          const realUrl = await resolveRealUrl(item.url);
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

        await sleep(1200);
      }
    }
  }

  public async start(): Promise<void> {
    console.log('[SOGOU] Starting Sogou Search pure HTTP crawler with SystemHttpClient...');
    await this.search();
    console.log('[SOGOU] Sogou Search crawler finished.');
  }
}
