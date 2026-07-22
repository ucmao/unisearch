import axios from 'axios';
import * as cheerio from 'cheerio';

async function inspectSogouPage1() {
  const client = axios.create({
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  });

  const homeRes = await client.get('https://www.sogou.com/');
  const setCookies = homeRes.headers['set-cookie'] || [];
  const cookies = setCookies.map((c: string) => c.split(';')[0]);
  if (!cookies.some((c) => c.startsWith('SUV='))) {
    cookies.push(`SUV=${Date.now() * 1000 + Math.floor(Math.random() * 1000)}`);
  }

  const res = await client.get('https://www.sogou.com/web?query=DeepSeek', {
    headers: {
      'Cookie': cookies.join('; '),
      'Referer': 'https://www.sogou.com/',
    },
  });

  const $ = cheerio.load(res.data);
  console.log('Divs containing page or p:');
  $('*').each((i, el) => {
    const id = $(el).attr('id') || '';
    const cls = $(el).attr('class') || '';
    if (id.includes('page') || cls.includes('page') || id.includes('p-') || cls.includes('pagination')) {
      console.log(`Tag: ${el.tagName}, ID: ${id}, Class: ${cls}, Text: ${$(el).text().trim().slice(0, 50)}`);
    }
  });
}

inspectSogouPage1();
