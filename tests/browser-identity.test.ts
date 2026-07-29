import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCrawlerUserAgent } from '../src/tools/browserIdentity';

test('crawler user agent follows the actual Chromium version', () => {
  const ua = buildCrawlerUserAgent('148.0.7778.280', 'darwin');
  assert.match(ua, /Chrome\/148\.0\.7778\.280/);
  assert.doesNotMatch(ua, /Electron|UniSearch/);
});

test('crawler user agent uses an OS token consistent with the runtime platform', () => {
  assert.match(buildCrawlerUserAgent('148.0.0.0', 'win32'), /Windows NT 10\.0/);
  assert.match(buildCrawlerUserAgent('148.0.0.0', 'linux'), /X11; Linux x86_64/);
});
