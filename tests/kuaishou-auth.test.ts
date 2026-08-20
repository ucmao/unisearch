import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExplicitKuaishouAuthFailure,
  summarizeKuaishouGraphqlFailure,
} from '../src/crawler/platforms/kuaishouAuth';
import { KuaishouCrawler } from '../src/crawler/platforms/kuaishou';

test('快手搜索的空数据或非成功 result 不会被误判为登录失效', () => {
  assert.equal(isExplicitKuaishouAuthFailure({ data: { visionSearchPhoto: null } }), false);
  assert.equal(isExplicitKuaishouAuthFailure({ data: { visionSearchPhoto: { result: 2 } } }), false);
  assert.equal(isExplicitKuaishouAuthFailure({ data: { visionSearchPhoto: { result: 50 } } }), false);
});

test('快手接口明确返回认证错误时识别为登录失效', () => {
  assert.equal(isExplicitKuaishouAuthFailure({ __httpStatus: 401 }), true);
  assert.equal(isExplicitKuaishouAuthFailure({ errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] }), true);
  assert.equal(isExplicitKuaishouAuthFailure({ errors: [{ message: '当前登录已失效，请重新登录' }] }), true);
});

test('快手用于风控的 HTTP 403 不会被当作登录失效', () => {
  assert.equal(isExplicitKuaishouAuthFailure({ __httpStatus: 403 }), false);
});

test('快手接口异常摘要保留实际 payload，便于区分风控和接口变更', () => {
  const summary = summarizeKuaishouGraphqlFailure(
    { data: { visionSearchPhoto: { result: 2, pcursor: 'no_more' } } },
    'visionSearchPhoto',
  );
  assert.match(summary, /"result":2/);
  assert.match(summary, /pcursor/);
});

test('快手 HTTP 错误摘要保留响应正文', () => {
  const summary = summarizeKuaishouGraphqlFailure(
    { __httpStatus: 400, __responseBody: { errors: [{ message: 'unknown field' }] } },
    'visionProfilePhotoList',
  );
  assert.match(summary, /HTTP 400/);
  assert.match(summary, /unknown field/);
});

test('快手 HTTP 包装响应中的明确认证错误仍可识别', () => {
  assert.equal(isExplicitKuaishouAuthFailure({
    __httpStatus: 400,
    __responseBody: { errors: [{ extensions: { code: 'UNAUTHENTICATED' } }] },
  }), true);
});

test('快手签名被拒时保留 result=50 且不做无效重试', async () => {
  const crawler = new KuaishouCrawler() as any;
  let attempts = 0;
  crawler.ensureRestSigningEnvironment = async () => {};
  crawler.page = { evaluate: async () => { attempts++; return { result: 50, error_msg: 'invalid signature' }; } };
  crawler.hasManualVerification = async () => false;
  crawler.hasExplicitLoginPrompt = async () => false;

  await assert.rejects(
    () => crawler.restV2('/rest/v/profile/feed', { user_id: 'u' }, '测试快手主页接口'),
    /result=50.*invalid signature/,
  );
  assert.equal(attempts, 1);
});
