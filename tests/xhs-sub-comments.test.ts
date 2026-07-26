import assert from 'node:assert/strict';
import test from 'node:test';
import { XiaoHongShuCrawler } from '../src/crawler/platforms/xhs';
import { connectorOutput } from '../src/connectors/output/connector-output';
import { applyConfig, resetConfig } from '../src/tools/config';

/**
 * `/api/sns/web/v2/comment/page` inlines the first reply of every root comment
 * and hands back a cursor to continue from. The crawler used to ignore both:
 * it re-fetched from an empty cursor and never paginated, so a root comment with
 * 29 replies could yield at most 10 and the inline one was stored twice.
 */
interface Harness {
  subRequests: Array<{ root: string; cursor: string; num: string }>;
  emitted: any[];
}

/** One root comment plus however many replies the fake endpoint will serve. */
function drive(
  root: any,
  serve: (cursor: string) => { comments: any[]; cursor: string; has_more: boolean },
  budget: number,
): Promise<Harness> {
  const harness: Harness = { subRequests: [], emitted: [] };
  const original = connectorOutput.emitXhsComment;
  (connectorOutput as any).emitXhsComment = async (row: any) => { harness.emitted.push(row); };

  const crawler = new XiaoHongShuCrawler() as any;
  crawler.page = {};
  crawler.humanDelay = async () => {};
  crawler.apiHost = 'edith.xiaohongshu.com';
  crawler.signer = {
    hasTemplate: () => true,
    request: async ({ path }: { path: string }) => {
      const query = new URLSearchParams(path.split('?')[1] || '');
      harness.subRequests.push({
        root: query.get('root_comment_id') || '',
        cursor: query.get('cursor') || '',
        num: query.get('num') || '',
      });
      const { comments, cursor, has_more } = serve(query.get('cursor') || '');
      return { data: { comments, cursor, has_more } };
    },
  };

  return crawler
    .storeSubComments('note-1', 'token-1', root, budget)
    .then((stored: number) => {
      (connectorOutput as any).emitXhsComment = original;
      return { ...harness, stored } as Harness & { stored: number };
    });
}

const reply = (id: string) => ({ id, create_time: 1, content: id, user_info: { user_id: 'u', nickname: 'n' }, like_count: 0 });

test('a root whose only reply is inlined costs no extra request', async () => {
  const harness = await drive(
    { id: 'root-1', sub_comment_count: '1', sub_comments: [reply('r1')], sub_comment_has_more: false, sub_comment_cursor: 'c1' },
    () => assert.fail('should not call /comment/sub/page'),
    50,
  );
  assert.deepEqual(harness.subRequests, []);
  assert.deepEqual(harness.emitted.map((row) => row.comment_id), ['r1']);
  assert.deepEqual(harness.emitted.map((row) => row.parent_comment_id), ['root-1']);
});

test('remaining replies are followed from the root cursor, not from zero', async () => {
  const pages: Record<string, { comments: any[]; cursor: string; has_more: boolean }> = {
    'cursor-a': { comments: [reply('r2'), reply('r3')], cursor: 'cursor-b', has_more: true },
    'cursor-b': { comments: [reply('r4')], cursor: '', has_more: false },
  };
  const harness = await drive(
    { id: 'root-1', sub_comment_count: '4', sub_comments: [reply('r1')], sub_comment_has_more: true, sub_comment_cursor: 'cursor-a' },
    (cursor) => pages[cursor],
    50,
  );
  // The old code sent cursor='' once and stopped; both of those are regressions.
  assert.deepEqual(harness.subRequests.map((entry) => entry.cursor), ['cursor-a', 'cursor-b']);
  assert.deepEqual(harness.emitted.map((row) => row.comment_id), ['r1', 'r2', 'r3', 'r4']);
});

test('a reply already inlined is not stored twice when it comes back', async () => {
  const harness = await drive(
    { id: 'root-1', sub_comment_count: '2', sub_comments: [reply('r1')], sub_comment_has_more: true, sub_comment_cursor: 'c' },
    () => ({ comments: [reply('r1'), reply('r2')], cursor: '', has_more: false }),
    50,
  );
  assert.deepEqual(harness.emitted.map((row) => row.comment_id), ['r1', 'r2']);
});

test('replies never exceed the note comment budget left over', async () => {
  const harness = await drive(
    { id: 'root-1', sub_comment_count: '99', sub_comments: [reply('r1')], sub_comment_has_more: true, sub_comment_cursor: 'c' },
    () => ({ comments: [reply('r2'), reply('r3'), reply('r4')], cursor: 'c2', has_more: true }),
    3,
  );
  assert.equal(harness.emitted.length, 3);
  // Budget is also what stops the loop, so the endpoint is asked for no more
  // than the remaining allowance rather than a hard-coded 10.
  assert.deepEqual(harness.subRequests.map((entry) => entry.num), ['2']);
});

test('a root with no replies at all is skipped entirely', async () => {
  resetConfig();
  applyConfig({ enable_comments: true });
  const harness = await drive(
    { id: 'root-1', sub_comment_count: '0', sub_comments: [], sub_comment_has_more: false },
    () => assert.fail('should not call /comment/sub/page'),
    50,
  );
  assert.deepEqual(harness.emitted, []);
  resetConfig();
});
