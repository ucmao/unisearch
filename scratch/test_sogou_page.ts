import axios from 'axios';
import * as cheerio from 'cheerio';

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://www.sogou.com/',
};

async function testSogouUrls() {
  const query = 'DeepSeek';
  const urls = [
    `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=2`,
    `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=2&ie=utf8`,
    `https://www.sogou.com/web?query=${encodeURIComponent(query)}&p=40230447&dp=1&page=2`,
    `https://www.sogou.com/sogou?query=${encodeURIComponent(query)}&page=2`,
    `https://www.sogou.com/web?query=${encodeURIComponent(query)}&pn=2`,
  ];

  for (const url of urls) {
    console.log(`\nTesting URL: ${url}`);
    try {
      const res = await axios.get(url, { headers: COMMON_HEADERS, timeout: 5000 });
      const html = res.data;
      const $ = cheerio.load(html);

      const items = $('.vrwrap, .rb, div.results > div, ul.news-list > li');
      console.log(`  Items count: ${items.length}, HTML length: ${html.length}`);

      if (items.length > 0) {
        const firstTitle = $(items[0]).find('h3').text().trim();
        console.log(`  First item title: "${firstTitle}"`);
      } else {
        // check anti-spider or captcha
        if (html.includes('antispider') || html.includes('验证码')) {
          console.log(`  ⚠️ Anti-spider / Captcha triggered!`);
        } else {
          console.log(`  No items matched. Class check: ${html.slice(0, 300)}`);
        }
      }
    } catch (err: any) {
      console.error(`  Error: ${err.message}`);
    }
  }
}

testSogouUrls();
