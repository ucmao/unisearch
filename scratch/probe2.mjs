import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().includes('kuaishou.com')) || ctx.pages().at(-1);
console.log('URL:', page.url());
const info = await page.evaluate(() => ({
  title: document.title,
  bodyText: (document.body?.innerText || '').slice(0, 600),
  hasInitState: typeof window.INIT_STATE !== 'undefined',
  commentNodes: document.querySelectorAll('[class*="comment"]').length,
  dataCommentId: document.querySelectorAll('[data-comment-id]').length,
}));
console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: './scratch/ks-page.png' }).catch((e) => console.log('screenshot failed', e.message));
process.exit(0);
