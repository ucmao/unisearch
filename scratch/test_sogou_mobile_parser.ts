import axios from 'axios';
import * as cheerio from 'cheerio';

const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

function cleanText(str: string): string {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function testSogouMobileParser() {
  const query = 'DeepSeek 联网搜索原理';
  for (let page = 1; page <= 3; page++) {
    const url = `https://m.sogou.com/web/searchList.jsp?keyword=${encodeURIComponent(query)}&page=${page}`;
    try {
      const res = await axios.get(url, { headers: MOBILE_HEADERS, timeout: 5000 });
      const $ = cheerio.load(res.data);

      console.log(`\n=================== 搜狗移动端 第 ${page} 页 ===================`);
      const items: any[] = [];

      $('.vrResult, .result, div[class*="result"]').each((_, el) => {
        const $item = $(el);
        const $titleLink = $item.find('h3 a, a.tit, a[class*="title"]').first();
        const title = cleanText($titleLink.text() || $item.find('h3').text());
        const href = $titleLink.attr('href') || $item.find('a').attr('href') || '';

        if (!title) return;

        const snippet = cleanText($item.find('.summary, .desc, p, div[class*="summary"]').first().text());
        const publisher = cleanText($item.find('.site, .cite, .citeurl, span[class*="site"]').first().text()) || '搜狗搜索';

        items.push({ title, href, snippet, publisher });
      });

      console.log(`第 ${page} 页提取有效数据 ${items.length} 条：`);
      items.slice(0, 3).forEach((item, idx) => {
        console.log(`  [#${idx + 1}] 标题: ${item.title}`);
        console.log(`       链接: ${item.href}`);
        console.log(`       摘要: ${item.snippet.slice(0, 60)}...`);
      });
    } catch (err: any) {
      console.error(`Page ${page} failed: ${err.message}`);
    }
  }
}

testSogouMobileParser();
