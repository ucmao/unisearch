import axios from 'axios';
import * as cheerio from 'cheerio';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function testSogouPagination() {
  const query = 'DeepSeek 联网搜索原理';
  console.log(`\n================ 搜狗搜索 多页翻页深度测试 (查询词: "${query}") ================\n`);

  // Create an axios instance with Cookie jar support (extracting Set-Cookie from response)
  let cookies: string[] = [];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://www.sogou.com/',
  };

  for (let page = 1; page <= 3; page++) {
    console.log(`[搜狗] 正在抓取第 ${page} 页...`);
    const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${page}`;

    try {
      const res = await axios.get(url, {
        headers: {
          ...headers,
          'Cookie': cookies.join('; '),
        },
        timeout: 6000,
      });

      // Save Set-Cookie
      if (res.headers['set-cookie']) {
        const newCookies = res.headers['set-cookie'].map((c) => c.split(';')[0]);
        cookies = Array.from(new Set([...cookies, ...newCookies]));
      }

      const $ = cheerio.load(res.data);
      const items = $('.vrwrap, .rb, div.results > div');
      console.log(`  第 ${page} 页抓取成功！获取到 ${items.length} 条记录。`);

      if (items.length > 0) {
        const firstTitle = $(items[0]).find('h3.vr-title a, h3.pt a, h3 a').first().text().trim();
        const lastTitle = $(items[items.length - 1]).find('h3.vr-title a, h3.pt a, h3 a').first().text().trim();
        console.log(`  第一条标题: "${firstTitle}"`);
        console.log(`  最后一条标题: "${lastTitle}"`);
      }

      await sleep(1500); // 1.5s delay between pages to avoid anti-spider triggers
    } catch (err: any) {
      console.error(`  第 ${page} 页抓取失败: ${err.message}`);
    }
  }
}

testSogouPagination();
