import assert from 'node:assert/strict';
import test from 'node:test';
import { clearCrawlerCredentialSessions } from '../src/tools/authCredentials';

test('session cleanup clears every partition and verifies that cookies are gone', async () => {
  const calls: string[] = [];
  const closed: string[] = [];
  await clearCrawlerCredentialSessions(
    ['douyin'],
    (partition) => ({
      clearData: async () => { calls.push(`data:${partition}`); },
      clearAuthCache: async () => { calls.push(`auth:${partition}`); },
      cookies: { get: async () => [] },
    }),
    (platform) => { closed.push(platform); },
  );

  assert.deepEqual(closed, ['douyin']);
  assert.deepEqual(calls, [
    'data:persist:unisearch-crawler-douyin',
    'auth:persist:unisearch-crawler-douyin',
  ]);
});

test('session cleanup reports partition failures instead of returning false success', async () => {
  await assert.rejects(
    clearCrawlerCredentialSessions(['xhs'], () => ({
      clearData: async () => { throw new Error('disk busy'); },
      clearAuthCache: async () => {},
      cookies: { get: async () => [] },
    })),
    /xhs: disk busy/,
  );

  await assert.rejects(
    clearCrawlerCredentialSessions(['weibo'], () => ({
      clearData: async () => {},
      clearAuthCache: async () => {},
      cookies: { get: async () => [{}] },
    })),
    /仍存在 1 个 Cookie/,
  );
});
