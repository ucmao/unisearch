import axios from 'axios';
import * as cheerio from 'cheerio';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

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

async function fetchSogouPage(keyword: string, page: number): Promise<{ title: string; url: string; snippet: string; publisher: string }[]> {
  // Strategy 1: Attempt PC Search
  try {
    const pcUrl = `https://www.sogou.com/web?query=${encodeURIComponent(keyword)}${page > 1 ? `&page=${page}` : ''}`;
    const res = await axios.get(pcUrl, {
      headers: {
        ...COMMON_HEADERS,
        'Cookie': `SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`,
        'Referer': page === 1 ? 'https://www.sogou.com/' : `https://www.sogou.com/web?query=${encodeURIComponent(keyword)}&page=${page - 1}`,
      },
      timeout: 5000,
    });

    const finalUrl = res.request?.res?.responseUrl || res.config.url;
    if (!finalUrl.includes('antispider')) {
      const $ = cheerio.load(res.data);
      const items: any[] = [];
      $('.vrwrap, .rb, div.results > div').each((_, el) => {
        const $item = $(el);
        const $titleLink = $item.find('h3.vr-title a, h3.pt a, h3 a').first();
        let rawLink = $titleLink.attr('href') || '';
        const title = cleanText($titleLink.text());
        if (!title || !rawLink) return;
        if (rawLink.startsWith('/')) rawLink = `https://www.sogou.com${rawLink}`;

        const snippet = cleanText($item.find('.star-wiki, .space-txt, .str_pack_wrp, .ft, .txt-box, p').first().text()) || cleanText($item.text().replace(title, '')).slice(0, 150);
        const publisher = cleanText($item.find('.cite, .citeurl, .fb').first().text()) || '搜狗搜索';
        items.push({ title, url: rawLink, snippet, publisher });
      });

      if (items.length > 0) {
        console.log(`[SOGOU] [PC] Page ${page} success (${items.length} items)`);
        return items;
      }
    }
  } catch (err: any) {
    console.log(`[SOGOU] [PC] Page ${page} failed: ${err.message}`);
  }

  // Strategy 2: Mobile Fallback
  console.log(`[SOGOU] [Mobile Fallback] Fetching Page ${page}...`);
  try {
    const mobileUrl = `https://m.sogou.com/web/searchList.jsp?keyword=${encodeURIComponent(keyword)}&page=${page}`;
    const res = await axios.get(mobileUrl, { headers: MOBILE_HEADERS, timeout: 5000 });
    const $ = cheerio.load(res.data);
    const items: any[] = [];

    $('.vrResult, .result, div[class*="result"]').each((_, el) => {
      const $item = $(el);
      const $titleLink = $item.find('h3 a, a.tit, a[class*="title"]').first();
      let rawLink = $titleLink.attr('href') || $item.find('a').attr('href') || '';
      const title = cleanText($titleLink.text() || $item.find('h3').text());
      if (!title) return;

      const snippet = cleanText($item.find('.summary, .desc, p, div[class*="summary"]').first().text());
      const publisher = cleanText($item.find('.site, .cite, .citeurl').first().text()) || '搜狗搜索';
      items.push({ title, url: rawLink, snippet, publisher });
    });

    console.log(`[SOGOU] [Mobile Fallback] Page ${page} success (${items.length} items)`);
    return items;
  } catch (err: any) {
    console.error(`[SOGOU] [Mobile Fallback] Page ${page} failed: ${err.message}`);
    return [];
  }
}

async function testFallback() {
  const keyword = 'DeepSeek 联网搜索原理';
  for (let page = 1; page <= 3; page++) {
    const results = await fetchSogouPage(keyword, page);
    console.log(`Page ${page} extracted ${results.length} items:`);
    if (results.length > 0) {
      console.log(`  First item: "${results[0].title}"`);
    }
  }
}

testFallback();
