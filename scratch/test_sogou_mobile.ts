import axios from 'axios';
import * as cheerio from 'cheerio';

const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

async function testSogouMobile() {
  const query = 'DeepSeek 联网搜索原理';
  console.log(`\n================ 搜狗移动端接口多页采集测试 (查询词: "${query}") ================\n`);

  for (let page = 1; page <= 3; page++) {
    const url = `https://m.sogou.com/web/searchList.jsp?keyword=${encodeURIComponent(query)}&page=${page}`;
    try {
      const res = await axios.get(url, { headers: MOBILE_HEADERS, timeout: 5000 });
      const $ = cheerio.load(res.data);

      const items = $('.results > div, .result, .vrwrap, div[class*="result"]');
      console.log(`[页码 ${page}] URL: ${url} | 提取结果数量: ${items.length}`);

      items.slice(0, 3).each((i, el) => {
        const title = cleanText($(el).find('h3, .title, a').first().text());
        if (title) {
          console.log(`   #${i + 1} 标题: "${title}"`);
        }
      });
    } catch (err: any) {
      console.error(`[页码 ${page}] 失败: ${err.message}`);
    }
  }
}

function cleanText(str: string): string {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

testSogouMobile();
