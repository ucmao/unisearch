import assert from 'node:assert/strict';
import test from 'node:test';
import { TiebaCrawler } from '../src/crawler/platforms/tieba';
import { ZhihuCrawler } from '../src/crawler/platforms/zhihu';
import { applyConfig, resetConfig } from '../src/tools/config';

function crawlerHarness(Crawler: typeof TiebaCrawler | typeof ZhihuCrawler): any {
  const crawler = new Crawler() as any;
  crawler.page = {
    click: async () => {
      throw new Error('不应点击登录入口');
    },
    isVisible: async () => false,
  };
  crawler.browserContext = { cookies: async () => [] };
  return crawler;
}

test('贴吧优先使用 BDUSS 会话，不被页面登录元素误判为未登录', async () => {
  const crawler = crawlerHarness(TiebaCrawler);
  crawler.page.isVisible = async (selector: string) => selector.includes('.u_login');
  crawler.browserContext.cookies = async () => [
    { name: 'BDUSS', value: 'session', domain: '.baidu.com' },
  ];

  assert.equal(await crawler.checkLoginState(), 'logged_in');
});

test('知乎优先使用 z_c0 会话，不被页面登录元素误判为未登录', async () => {
  const crawler = crawlerHarness(ZhihuCrawler);
  crawler.page.isVisible = async (selector: string) => selector.includes('.AppHeader-login');
  crawler.browserContext.cookies = async () => [
    { name: 'z_c0', value: 'session', domain: '.zhihu.com' },
  ];

  assert.equal(await crawler.checkLoginState(), 'logged_in');
});

test('贴吧和知乎登录状态不确定时立即继续，不进入人工登录等待', async () => {
  resetConfig();
  applyConfig({ login_type: 'qrcode' });

  for (const Crawler of [TiebaCrawler, ZhihuCrawler]) {
    const crawler = crawlerHarness(Crawler);
    crawler.checkLoginState = async () => 'unknown';
    await crawler.handleLogin();
  }

  resetConfig();
  assert.ok(true);
});
