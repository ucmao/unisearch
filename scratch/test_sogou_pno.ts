import axios from 'axios';
import * as cheerio from 'cheerio';

const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

async function testPno() {
  const query = 'DeepSeek';
  for (let page = 1; page <= 3; page++) {
    const url = `https://m.sogou.com/web/searchList.jsp?keyword=${encodeURIComponent(query)}&pno=${page}&p=${page}&page=${page}`;
    const res = await axios.get(url, { headers: MOBILE_HEADERS });
    const $ = cheerio.load(res.data);

    console.log(`\nPage ${page}:`);
    $('.vrResult, .result').slice(0, 2).each((i, el) => {
      const title = $(el).find('h3, a.tit').first().text().trim();
      console.log(`  Item #${i + 1}: ${title.slice(0, 50)}`);
    });
  }
}

testPno();
