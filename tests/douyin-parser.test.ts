import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeHttpChunkedText, extractDouyinAwemeId, parseDouyinSearchBody } from '../src/crawler/platforms/douyin';

test('extracts Douyin aweme IDs from current result URL forms', () => {
  assert.equal(extractDouyinAwemeId('https://www.douyin.com/video/7341234567890123456'), '7341234567890123456');
  assert.equal(extractDouyinAwemeId('https://www.douyin.com/note/7341234567890123456?modal_id=1'), '7341234567890123456');
  assert.equal(extractDouyinAwemeId('/search/item/?aweme_id=7341234567890123456'), '7341234567890123456');
  assert.equal(extractDouyinAwemeId('https://www.douyin.com/user/123'), '');
});

test('parses search JSON with CDP HTTP chunk framing', () => {
  const payload = { status_code: 0, data: [{ aweme_info: { aweme_id: '7341234567890123456' } }] };
  assert.deepEqual(parseDouyinSearchBody(`af7b\r\n${JSON.stringify(payload)}\r\n0\r\n\r\n`), payload);
  assert.equal(parseDouyinSearchBody('not-json'), null);
});

test('decodes multiple HTTP chunks by byte length before parsing Chinese JSON', () => {
  const payload = { status_code: 0, data: [{ aweme_info: { aweme_id: '7341234567890123456', desc: '易拓教育搜索结果' } }] };
  const json = JSON.stringify(payload);
  const parts = [json.slice(0, 31), json.slice(31, 67), json.slice(67)];
  const framed = parts.map((part) => `${Buffer.byteLength(part, 'utf8').toString(16)}\r\n${part}\r\n`).join('') + '0\r\n\r\n';
  assert.equal(decodeHttpChunkedText(framed), json);
  assert.deepEqual(parseDouyinSearchBody(framed), payload);
});

test('parses search JSON with space-separated HTTP chunk prefix', () => {
  const payload = { status_code: 0, data: [{ aweme_info: { aweme_id: '7664121043821234567' } }] };
  assert.deepEqual(parseDouyinSearchBody(`1b5e4 ${JSON.stringify(payload)}`), payload);
});

