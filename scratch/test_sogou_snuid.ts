import axios from 'axios';
import * as cheerio from 'cheerio';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function testSogouChain() {
  const client = axios.create({
    timeout: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9',
    },
  });

  try {
    const query = 'DeepSeek 联网搜索原理';
    let cookieMap: Record<string, string> = {};

    // Helper to merge cookies
    const mergeCookies = (setCookies?: string[]) => {
      if (!setCookies) return;
      setCookies.forEach((header) => {
        const parts = header.split(';')[0].split('=');
        if (parts.length >= 2) {
          cookieMap[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
      });
    };

    // Ensure SUV cookie exists
    cookieMap['SUV'] = `${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`;

    for (let page = 1; page <= 3; page++) {
      const cookieString = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
      const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}${page > 1 ? `&page=${page}` : ''}`;
      console.log(`\n------------------ Fetching Sogou Page ${page} ------------------`);

      const res = await client.get(url, {
        headers: {
          'Cookie': cookieString,
          'Referer': page === 1 ? 'https://www.sogou.com/' : `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${page - 1}`,
        },
      });

      mergeCookies(res.headers['set-cookie']);

      const finalUrl = res.request?.res?.responseUrl || res.config.url;
      if (finalUrl.includes('antispider')) {
        console.log(`❌ Page ${page} hit antispider captcha page!`);
        break;
      }

      const $ = cheerio.load(res.data);
      const items = $('.vrwrap, .rb, div.results > div');
      console.log(`✅ Page ${page} Success! Items count: ${items.length}`);

      items.slice(0, 3).each((i, el) => {
        const title = $(el).find('h3.vr-title a, h3.pt a, h3 a').first().text().trim();
        console.log(`   [#${i + 1}] ${title}`);
      });

      await sleep(1500);
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testSogouChain();
