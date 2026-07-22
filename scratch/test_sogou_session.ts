import axios from 'axios';
import * as cheerio from 'cheerio';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function testSogouWithSession() {
  const client = axios.create({
    timeout: 8000,
    maxRedirects: 5,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });

  let cookieHeader = '';

  try {
    // Step 1: Visit home page to obtain initial cookies (SUV / ABTEST etc.)
    console.log('[Step 1] Visiting Sogou homepage to get session cookies...');
    const homeRes = await client.get('https://www.sogou.com/');
    const setCookies = homeRes.headers['set-cookie'] || [];
    const cookies: string[] = setCookies.map((c: string) => c.split(';')[0]);

    // Generate a fallback SUV cookie if not present (SUV = timestamp * 1000 + random)
    const hasSUV = cookies.some((c) => c.startsWith('SUV='));
    if (!hasSUV) {
      const suv = `SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`;
      cookies.push(suv);
    }
    cookieHeader = cookies.join('; ');
    console.log(`[Cookies Obtained]: ${cookieHeader}`);

    await sleep(1000);

    // Step 2: Fetch Page 1, 2, 3
    const query = 'DeepSeek 联网搜索原理';
    for (let page = 1; page <= 3; page++) {
      console.log(`\n------------------ Fetching Page ${page} ------------------`);
      const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${page}`;

      const pageRes = await client.get(url, {
        headers: {
          'Cookie': cookieHeader,
          'Referer': page === 1 ? 'https://www.sogou.com/' : `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${page - 1}`,
        },
      });

      const finalUrl = pageRes.request?.res?.responseUrl || url;
      if (finalUrl.includes('antispider')) {
        console.log(`  ❌ Page ${page} hit anti-spider page! URL: ${finalUrl}`);
        break;
      }

      // Update cookies if set-cookie returned
      if (pageRes.headers['set-cookie']) {
        const newSetCookies = pageRes.headers['set-cookie'].map((c: string) => c.split(';')[0]);
        const updatedList = Array.from(new Set([...cookieHeader.split('; '), ...newSetCookies]));
        cookieHeader = updatedList.join('; ');
      }

      const $ = cheerio.load(pageRes.data);
      const containers = $('.vrwrap, .rb, div.results > div');
      console.log(`  ✅ Page ${page} Success! Total items found: ${containers.length}`);

      containers.each((i, el) => {
        const title = $(el).find('h3.vr-title a, h3.pt a, h3 a').first().text().trim();
        if (title) {
          console.log(`    [Item ${i + 1}] ${title}`);
        }
      });

      await sleep(1500);
    }
  } catch (err: any) {
    console.error('Test error:', err.message);
  }
}

testSogouWithSession();
