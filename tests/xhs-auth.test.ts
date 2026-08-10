import assert from 'node:assert/strict';
import test from 'node:test';
import { XiaoHongShuCrawler } from '../src/crawler/platforms/xhs';
import { applyConfig, resetConfig } from '../src/tools/config';

function crawlerHarness(): any {
  const crawler = new XiaoHongShuCrawler() as any;
  crawler.page = {
    waitForTimeout: async () => {},
    reload: async () => {},
  };
  crawler.browserContext = {};
  return crawler;
}

test('小红书登录状态不确定时不会主动点击登录', async () => {
  resetConfig();
  applyConfig({ login_type: 'qrcode' });
  const crawler = crawlerHarness();
  const states = ['unknown', 'unauthenticated', 'verification', 'authenticated', 'authenticated'];
  let clicks = 0;
  let verifications = 0;
  crawler.inspectLoginState = async () => states.shift() || 'authenticated';
  crawler.clickExplicitLoginControl = async () => {
    clicks++;
    return true;
  };
  crawler.waitForManualVerification = async () => {
    verifications++;
  };

  await crawler.handleLogin();

  assert.equal(clicks, 1, '只有明确未登录状态才允许点击一次登录控件');
  assert.equal(verifications, 1, '安全验证必须进入独立等待流程');
  resetConfig();
});

test('已有持久化认证 Cookie 时不会用手工 Cookie 覆盖会话', async () => {
  resetConfig();
  applyConfig({ login_type: 'cookie', cookies: 'web_session=stale-value; a1=stale-device' });
  const crawler = crawlerHarness();
  let addedCookies = 0;
  let reloads = 0;
  crawler.browserContext = {
    addCookies: async () => { addedCookies++; },
    newCDPSession: async () => ({ send: async () => { addedCookies++; } }),
  };
  crawler.page.reload = async () => { reloads++; };
  crawler.authCookieNames = async () => ['web_session', 'a1'];
  crawler.inspectLoginState = async () => 'authenticated';

  await crawler.handleLogin();

  assert.equal(addedCookies, 0);
  assert.equal(reloads, 0);
  resetConfig();
});

test('认证 Cookie 通过页面 CDP 会话从小红书分区读取', async () => {
  resetConfig();
  const crawler = crawlerHarness();
  const calls: Array<{ method: string; urls: string[] }> = [];
  crawler.page = {};
  crawler.browserContext = {
    newCDPSession: async () => ({
      send: async (method: string, params: { urls: string[] }) => {
        calls.push({ method, urls: params.urls });
        return {
          cookies: [
            { name: 'web_session', value: 'secret' },
            { name: 'id_token', value: 'secret' },
            { name: 'unrelated', value: 'ignored' },
          ],
        };
      },
    }),
  };

  const names = await crawler.authCookieNames();

  assert.deepEqual(names, ['web_session', 'id_token']);
  assert.equal(calls[0].method, 'Network.getCookies');
  assert.ok(calls[0].urls.some((url) => url.includes('xiaohongshu.com')));
  resetConfig();
});

test('明确登录控件优先于残留 Cookie，避免把失效会话当成已登录', async () => {
  const crawler = crawlerHarness();
  crawler.hasManualVerification = async () => false;
  crawler.hasAccountProfileEvidence = async () => false;
  crawler.authCookieNames = async () => ['web_session'];
  crawler.hasExplicitLoginPrompt = async () => true;
  crawler.page.url = () => 'https://www.xiaohongshu.com/explore';

  assert.equal(await crawler.inspectLoginState(), 'unauthenticated');
});

test('安全验证优先于其他登录证据并暂停正常登录流程', async () => {
  const crawler = crawlerHarness();
  crawler.hasManualVerification = async () => true;
  crawler.hasAccountProfileEvidence = async () => true;
  crawler.authCookieNames = async () => ['web_session'];
  crawler.hasExplicitLoginPrompt = async () => false;

  assert.equal(await crawler.inspectLoginState(), 'verification');
});
