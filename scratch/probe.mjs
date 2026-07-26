import { chromium } from 'playwright';
const VIDEO = '3x2yhp3bewtcjh6';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => !p.url().startsWith('http://127.0.0.1')) || ctx.pages().at(-1);
console.log('using page:', page.url().slice(0, 60));

const captured = [];
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/graphql')) {
    try {
      const b = JSON.parse(req.postData() || '{}');
      captured.push({ op: b.operationName, variables: b.variables, query: b.query, referer: req.headers()['referer'] });
    } catch {}
  }
});

await page.goto(`https://www.kuaishou.com/short-video/${VIDEO}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await page.mouse.wheel(0, 1500).catch(() => {});
await page.waitForTimeout(5000);

console.log('\n=== all /graphql ops the page issued ===');
for (const c of captured) console.log(' -', c.op, '| vars:', JSON.stringify(c.variables), '| referer:', c.referer);

const cmt = captured.filter((c) => /comment/i.test(c.op || '') || /comment/i.test(c.query || ''));
console.log('\n=== comment ops: full query ===');
for (const c of cmt) { console.log('OP:', c.op, 'VARS:', JSON.stringify(c.variables)); console.log(c.query); console.log('---'); }
if (!cmt.length) console.log('(none captured)');
process.exit(0);
