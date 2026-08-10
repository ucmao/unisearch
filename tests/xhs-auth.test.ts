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
  crawler.hasVisibleLoginDialog = async () => false;
  crawler.hasAccountProfileEvidence = async () => false;
  crawler.authCookieNames = async () => ['web_session'];
  crawler.hasExplicitLoginPrompt = async () => true;
  crawler.page.url = () => 'https://www.xiaohongshu.com/explore';

  assert.equal(await crawler.inspectLoginState(), 'unauthenticated');
});

test('安全验证优先于其他登录证据并暂停正常登录流程', async () => {
  const crawler = crawlerHarness();
  crawler.hasManualVerification = async () => true;
  crawler.hasVisibleLoginDialog = async () => true;
  crawler.hasAccountProfileEvidence = async () => true;
  crawler.authCookieNames = async () => ['web_session'];
  crawler.hasExplicitLoginPrompt = async () => false;

  assert.equal(await crawler.inspectLoginState(), 'verification');
});

test('普通登录二维码弹窗优先于背景中的个人主页和 Cookie', async () => {
  const crawler = crawlerHarness();
  crawler.hasManualVerification = async () => false;
  crawler.hasVisibleLoginDialog = async () => true;
  crawler.hasAccountProfileEvidence = async () => true;
  crawler.authCookieNames = async () => ['web_session'];
  crawler.hasExplicitLoginPrompt = async () => false;

  assert.equal(await crawler.inspectLoginState(), 'unauthenticated');
});

test('搜索前发现登录弹窗时立即进入认证流程，不等待搜索框超时', async () => {
  const crawler = crawlerHarness();
  const searchInput = { fill: async () => {} };
  let attempts = 0;
  let loginRuns = 0;
  crawler.openSearchInput = async () => { attempts++; return searchInput; };
  crawler.inspectLoginState = async () => 'unauthenticated';
  crawler.handleLogin = async () => { loginRuns++; };
  crawler.page.url = () => 'https://www.xiaohongshu.com/explore';

  assert.equal(await crawler.openSearchInputWithAuthRecovery(), searchInput);
  assert.equal(loginRuns, 1);
  assert.equal(attempts, 1);
});

test('小红书搜索只接收请求体关键词与页码匹配的响应', () => {
  const crawler = crawlerHarness();
  const response = (keyword: string, page = 1) => ({
    url: () => 'https://edith.xiaohongshu.com/api/sns/web/v2/search/notes',
    request: () => ({
      method: () => 'POST',
      postDataJSON: () => ({ keyword, page }),
    }),
  });

  assert.equal(crawler.isSearchResponseForKeyword(response('宝可梦'), '宝可梦', 1), true);
  assert.equal(crawler.isSearchResponseForKeyword(response('肚子里有蛔虫的症状'), '宝可梦', 1), false);
  assert.equal(crawler.isSearchResponseForKeyword(response('宝可梦', 2), '宝可梦', 1), false);
});
