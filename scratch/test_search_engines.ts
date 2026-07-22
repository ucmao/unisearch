import { systemHttpClient } from '../src/crawler/base/SystemHttpClient';
import * as cheerio from 'cheerio';

interface SearchResultItem {
  engine: string;
  page: number;
  title: string;
  url: string;
  snippet: string;
  publisher?: string;
}

function cleanText(str: string): string {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function testEngine(engineName: string, query: string, maxItems: number = 15): Promise<SearchResultItem[]> {
  const results: SearchResultItem[] = [];
  const startPage = 1;
  const maxPages = Math.ceil(maxItems / 10);

  for (let page = startPage; page < startPage + maxPages; page++) {
    if (results.length >= maxItems) break;

    let pageItems: SearchResultItem[] = [];

    if (engineName === 'bing') {
      const first = (page - 1) * 10 + 1;
      const url = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&first=${first}`;
      try {
        const res = await systemHttpClient.get(url, { mode: 'desktop', timeout: 5000 });
        const $ = cheerio.load(res.data);
        $('li.b_algo, #b_results > li.b_algo, .b_algo').each((_, el) => {
          const $item = $(el);
          const $titleLink = $item.find('h2 a').first();
          const pageUrl = $titleLink.attr('href') || '';
          const title = cleanText($titleLink.text());
          if (!title || !pageUrl) return;
          const snippet = cleanText($item.find('.b_algoSlug, .b_caption, p').first().text()) || cleanText($item.text().replace(title, '')).slice(0, 150);
          pageItems.push({ engine: 'Bing中国', page, title, url: pageUrl, snippet });
        });
      } catch {}
    } else if (engineName === 'baidu') {
      const pn = (page - 1) * 10;
      const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${pn}&rn=10&tn=baidu`;
      try {
        const res = await systemHttpClient.get(url, { mode: 'desktop', headers: { 'Cookie': 'BDUSS=dummy;' }, timeout: 5000 });
        const $ = cheerio.load(res.data);
        $('.c-container, .result, div[srcid]').each((_, el) => {
          const $item = $(el);
          const $titleLink = $item.find('h3 a').first();
          const encryptedUrl = $titleLink.attr('href') || '';
          const title = cleanText($titleLink.text());
          if (!title || !encryptedUrl) return;
          const snippet = cleanText($item.find('.c-abstract, .content-right, .c-span-last').first().text()) || cleanText($item.text().replace(title, '')).slice(0, 150);
          pageItems.push({ engine: '百度搜索', page, title, url: encryptedUrl, snippet });
        });
      } catch {}
    } else if (engineName === 'so360') {
      const url = `https://www.so.com/s?q=${encodeURIComponent(query)}&pn=${page}`;
      try {
        const res = await systemHttpClient.get(url, { mode: 'desktop', timeout: 5000 });
        const $ = cheerio.load(res.data);
        $('li.res-list').each((_, el) => {
          const $item = $(el);
          const $titleLink = $item.find('h3.res-title a, h3 a').first();
          const encryptedUrl = $titleLink.attr('href') || '';
          const title = cleanText($titleLink.text());
          if (!title || !encryptedUrl) return;
          const snippet = cleanText($item.find('.res-desc, .res-rich').first().text()) || cleanText($item.text().replace(title, '')).slice(0, 150);
          pageItems.push({ engine: '360搜索', page, title, url: encryptedUrl, snippet });
        });
      } catch {}
    } else if (engineName === 'sogou') {
      try {
        const pcUrl = `https://www.sogou.com/web?query=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
        const suv = `SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`;
        const referer = page === 1 ? 'https://www.sogou.com/' : `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${page - 1}`;
        const res = await systemHttpClient.get(pcUrl, { mode: 'desktop', headers: { 'Cookie': suv }, referer, timeout: 5000 });
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
            const snippet = cleanText($item.find('.star-wiki, .space-txt, .str_pack_wrp, .ft').first().text()) || cleanText($item.text().replace(title, '')).slice(0, 150);
            pageItems.push({ engine: '搜狗搜索', page, title, url: rawLink, snippet });
          });
        }
      } catch {}

      if (pageItems.length === 0) {
        try {
          const mobileUrl = `https://m.sogou.com/web/searchList.jsp?keyword=${encodeURIComponent(query)}&page=${page}`;
          const res = await systemHttpClient.get(mobileUrl, { mode: 'mobile', timeout: 5000 });
          const $ = cheerio.load(res.data);
          $('.vrResult, .result, div[class*="result"]').each((_, el) => {
            const $item = $(el);
            const $titleLink = $item.find('h3 a, a.tit').first();
            let rawLink = $titleLink.attr('href') || '';
            const title = cleanText($titleLink.text() || $item.find('h3').text());
            if (!title) return;
            const snippet = cleanText($item.find('.summary, .desc, p').first().text());
            pageItems.push({ engine: '搜狗搜索', page, title, url: rawLink, snippet });
          });
        } catch {}
      }
    }

    if (pageItems.length === 0) break;
    results.push(...pageItems);
  }

  return results.slice(0, maxItems);
}

async function runSystemHttpClientTest() {
  const query = 'DeepSeek 联网搜索原理';
  console.log(`\n================ SystemHttpClient 系统层网络客户端全平台验证 (查询词: "${query}") ================\n`);

  const [bing, baidu, s360, sogou] = await Promise.all([
    testEngine('bing', query, 15),
    testEngine('baidu', query, 15),
    testEngine('so360', query, 15),
    testEngine('sogou', query, 15),
  ]);

  const printSummary = (name: string, list: SearchResultItem[]) => {
    const p1 = list.filter((i) => i.page === 1).length;
    const p2 = list.filter((i) => i.page === 2).length;
    console.log(`------------------ ${name} (获取总数: ${list.length} | 第 1 页: ${p1} | 第 2 页: ${p2}) ------------------`);
    if (list.length > 0) console.log(`  示例: "${list[0].title}"`);
  };

  printSummary('Bing 中国', bing);
  printSummary('百度搜索', baidu);
  printSummary('360 搜索', s360);
  printSummary('搜狗搜索', sogou);
}

runSystemHttpClientTest();
