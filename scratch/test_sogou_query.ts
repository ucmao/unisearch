import axios from 'axios';

async function checkSogouHtml() {
  const res = await axios.get('https://www.sogou.com/web?query=Python&page=2', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    },
  });
  console.log('Status:', res.status);
  console.log('Final URL:', res.request?.res?.responseUrl || res.config.url);
  console.log('HTML Snippet:\n', res.data.slice(0, 800));
}

checkSogouHtml();
