// Probe: does m.weibo.cn search work anonymously, and what does it return?
const KW = process.argv[2] || '人工智能';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

const containerid = `100103type=1&q=${KW}`;
const url = `https://m.weibo.cn/api/container/getIndex?containerid=${encodeURIComponent(containerid)}&page_type=searchall&page=1`;

// Step 1: warm up to collect the anonymous visitor cookies (_T_WM etc.)
const jar = new Map();
const collect = (r) => {
  for (const raw of (r.headers.getSetCookie?.() || [])) {
    const [k, v] = raw.split(';')[0].split('=');
    if (k && v !== undefined) jar.set(k.trim(), v.trim());
  }
};
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

const warm = await fetch(`https://m.weibo.cn/search?containerid=${encodeURIComponent(containerid)}`, {
  headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
});
collect(warm);
console.log('warmup status:', warm.status, 'cookies:', cookieHeader() || '(none)');

console.log('GET', url);
const res = await fetch(url, {
  headers: {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': `https://m.weibo.cn/search?containerid=${encodeURIComponent(containerid)}`,
    'X-Requested-With': 'XMLHttpRequest',
    'MWeibo-Pwa': '1',
    ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
  },
});
collect(res);

console.log('status:', res.status);
console.log('set-cookie:', res.headers.get('set-cookie'));
const body = await res.text();
console.log('len:', body.length);

let json;
try { json = JSON.parse(body); } catch { console.log('NOT JSON:', body.slice(0, 600)); process.exit(1); }

console.log('ok:', json.ok, 'msg:', json.msg);
const cards = json?.data?.cards || [];
console.log('cards:', cards.length, 'card_types:', [...new Set(cards.map((c) => c.card_type))]);

// card_type 9 = single mblog; card_type 11 = group wrapping card_group
const mblogs = [];
for (const c of cards) {
  if (c.mblog) mblogs.push(c.mblog);
  for (const g of c.card_group || []) if (g.mblog) mblogs.push(g.mblog);
}
console.log('mblogs:', mblogs.length);
if (mblogs[0]) {
  const m = mblogs[0];
  console.log('--- first mblog field probe ---');
  console.log(JSON.stringify({
    id: m.id, mid: m.mid, bid: m.bid,
    created_at: m.created_at,
    isLongText: m.isLongText,
    text_len: (m.text || '').length,
    text_head: (m.text || '').slice(0, 120),
    user: { id: m.user?.id, screen_name: m.user?.screen_name },
    reposts_count: m.reposts_count, comments_count: m.comments_count, attitudes_count: m.attitudes_count,
    has_retweet: !!m.retweeted_status,
    pic_num: m.pic_num,
  }, null, 2));
  console.log('all keys:', Object.keys(m).join(', '));
}
