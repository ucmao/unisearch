import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { connectorOutput } from '../src/connectors/output/connector-output';
import { MemoryOutputSink } from '../src/core/sinks/memory';
import { applyConfig, resetConfig } from '../src/tools/config';
import { TiebaCrawler } from '../src/crawler/platforms/tieba';

/**
 * Tieba's PC site is a Vue app: floors arrive from a signed `/c/f/pb/page_pc`
 * POST and are rendered into a virtual list, so the crawler reads the replies the
 * page fetches for itself. These tests drive the collector with canned payloads
 * instead of a browser, plus one real captured payload to pin the field mapping.
 */
interface StubPage {
  totalPages: number;
  posts: any[];
}

class StubTiebaCrawler extends TiebaCrawler {
  public requestedFloors: number[] = [];
  public requestedSubComments: Array<{ threadId: string; postId: string; limit: number }> = [];

  constructor(
    private readonly pages: StubPage[],
    private readonly subComments: Record<string, any[]> = {},
  ) {
    super();
    this.page = { waitForTimeout: async () => {} } as any;
  }

  protected override async collectThreadPages(_noteUrl: string, maxFloors: number) {
    this.requestedFloors.push(maxFloors);
    return this.pages.map((page) => ({
      title: '标题',
      forum: '测试吧',
      totalPages: page.totalPages,
      authorId: 'user-p1',
      authorName: '昵称-p1',
      createTime: '2026-01-01 09:00',
      posts: page.posts,
    }));
  }

  protected override async fetchSubComments(threadId: string, postId: string, limit: number) {
    this.requestedSubComments.push({ threadId, postId, limit });
    return (this.subComments[postId] || []).slice(0, Math.max(0, limit));
  }

  public collect(threadId: string) {
    return this.getThreadDetail(threadId, '关键词');
  }
}

function floor(id: string, options: { subCount?: number; inline?: any[]; author?: string } = {}) {
  return {
    id,
    parentId: 'thread-1',
    text: `内容-${id}`,
    authorId: options.author || `user-${id}`,
    authorName: `昵称-${id}`,
    time: '2026-01-01 10:00',
    subCount: options.subCount || 0,
    subComments: options.inline || [],
  };
}

const sub = (id: string) => ({ id, text: `楼中楼-${id}`, authorId: 'u', authorName: '甲', time: '2026-01-02 10:00' });

async function runCollect(crawler: StubTiebaCrawler) {
  const sink = new MemoryOutputSink();
  await connectorOutput.open(sink, {
    runId: 'run-tieba', source: 'tieba', startedAt: new Date().toISOString(),
  });
  const record = await crawler.collect('7001');
  await connectorOutput.close({ status: 'completed' });
  return { sink, record };
}

test('floors from every captured payload are collected, deduped by id', async (t) => {
  t.after(() => resetConfig());
  applyConfig({ enable_comments: true, CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 100, CRAWLER_MAX_SLEEP_SEC: 0 });

  // The virtual list re-renders as it scrolls, so payloads can overlap.
  const crawler = new StubTiebaCrawler([
    { totalPages: 3, posts: [floor('p1', { author: 'user-p1' }), floor('p2')] },
    { totalPages: 3, posts: [floor('p2'), floor('p3')] },
    { totalPages: 3, posts: [floor('p4')] },
  ]);

  const { sink, record } = await runCollect(crawler);

  assert.equal(record.total_replay_page, 3);
  assert.equal(record.total_replay_num, 3);
  assert.equal(record.desc, '内容-p1');
  const comments = sink.items.filter((item) => item.kind === 'comment');
  assert.deepEqual(comments.map((item) => item.sourceItemId), ['p2', 'p3', 'p4']);
  assert.equal(sink.items.filter((item) => item.kind === 'post').length, 1);
});

test('the opening post is identified by the thread author, not by position', async (t) => {
  t.after(() => resetConfig());
  applyConfig({ enable_comments: true, CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 100, CRAWLER_MAX_SLEEP_SEC: 0 });

  // `thread.post_id` is the first post of whichever page a payload covers, so a
  // run that starts mid-thread must not mistake a plain floor for the opening post.
  const crawler = new StubTiebaCrawler([
    { totalPages: 9, posts: [floor('p9'), floor('p10')] },
  ]);

  const { sink, record } = await runCollect(crawler);

  assert.equal(record.desc, '');
  assert.equal(record.user_nickname, '昵称-p1');
  const comments = sink.items.filter((item) => item.kind === 'comment');
  assert.deepEqual(comments.map((item) => item.sourceItemId), ['p9', 'p10']);
});

test('the collector is asked for one more floor than the comment budget', async (t) => {
  t.after(() => resetConfig());
  applyConfig({ enable_comments: true, CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 20, CRAWLER_MAX_SLEEP_SEC: 0 });

  const crawler = new StubTiebaCrawler([{ totalPages: 1, posts: [floor('p1', { author: 'user-p1' })] }]);
  await runCollect(crawler);

  // The opening post is not a comment, so it must not eat one of the 20 slots.
  assert.deepEqual(crawler.requestedFloors, [21]);
});

test('inline replies are free; only the overflow costs a request', async (t) => {
  t.after(() => resetConfig());
  applyConfig({ enable_comments: true, CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 20, CRAWLER_MAX_SLEEP_SEC: 0 });

  const crawler = new StubTiebaCrawler(
    [{
      totalPages: 1,
      posts: [
        floor('p1', { author: 'user-p1' }),
        // Fully covered by what the payload already carried.
        floor('p2', { subCount: 2, inline: [sub('s1'), sub('s2')] }),
        // Two inline out of six: the rest are fetched.
        floor('p3', { subCount: 6, inline: [sub('s3'), sub('s4')] }),
      ],
    }],
    { p3: [sub('s3'), sub('s5'), sub('s6')] },
  );

  const { sink } = await runCollect(crawler);

  // 20 budget − 4 already stored (p2, s1, s2, p3) − 2 replies already in hand = 14.
  assert.deepEqual(crawler.requestedSubComments, [{ threadId: '7001', postId: 'p3', limit: 14 }]);
  const comments = sink.items.filter((item) => item.kind === 'comment');
  // s3 came back from the endpoint as well and must not be stored twice.
  assert.deepEqual(comments.map((item) => item.sourceItemId), ['p2', 's1', 's2', 'p3', 's3', 's4', 's5', 's6']);
  assert.deepEqual(
    comments.filter((item) => item.sourceItemId!.startsWith('s')).map((item) => item.parentId),
    ['p2', 'p2', 'p3', 'p3', 'p3', 'p3'],
  );
});

test('floors and their replies draw on one shared budget', async (t) => {
  t.after(() => resetConfig());
  applyConfig({ enable_comments: true, CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 3, CRAWLER_MAX_SLEEP_SEC: 0 });

  const crawler = new StubTiebaCrawler([{
    totalPages: 1,
    posts: [
      floor('p1', { author: 'user-p1' }),
      floor('p2', { subCount: 5, inline: [sub('s1'), sub('s2'), sub('s3'), sub('s4')] }),
      floor('p3'),
    ],
  }]);

  const { sink } = await runCollect(crawler);

  const comments = sink.items.filter((item) => item.kind === 'comment');
  assert.deepEqual(comments.map((item) => item.sourceItemId), ['p2', 's1', 's2']);
});

test('a run that captures nothing reports failure instead of an empty thread', async (t) => {
  t.after(() => resetConfig());
  applyConfig({ enable_comments: true, CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 10, CRAWLER_MAX_SLEEP_SEC: 0 });

  const crawler = new StubTiebaCrawler([]);
  const { sink, record } = await runCollect(crawler);

  assert.equal(record, null);
  assert.equal(sink.items.length, 0);
});

test('a real /c/f/pb/page_pc payload maps onto the collector shape', () => {
  const payload = JSON.parse(readFileSync(
    path.join(__dirname, 'fixtures', 'tieba-pb-page-pc.json'), 'utf8',
  ));
  const page = (new TiebaCrawler() as any).normalizeThreadPayload(payload);

  assert.equal(page.title, '这里是水楼贴');
  assert.equal(page.forum, 'steam');
  assert.equal(page.totalPages, 67);
  // The thread author, not `thread.post_id`, is what marks the opening post.
  assert.equal(page.authorId, '6695916064');
  assert.equal(page.authorName, '提不起劲大王');

  assert.deepEqual(page.posts.map((post: any) => post.id),
    ['153739356267', '153287855308', '153286710455']);
  // Rich-text runs: only type 0 carries text, emoticons and images do not.
  assert.equal(page.posts[1].text, '呆久了经验蹭蹭涨');
  // Author names come from user_list, falling back to name when name_show is blank.
  assert.equal(page.posts[0].authorName, '暗香浮月明');
  assert.equal(page.posts[2].authorName, '绪韫09U');

  // Replies ride along in sub_post_list; the count says how many are still missing.
  assert.equal(page.posts[0].subCount, 3);
  assert.deepEqual(page.posts[0].subComments.map((item: any) => item.id),
    ['153739356552', '153739356824']);
  assert.equal(page.posts[0].subComments[1].authorName, '提不起劲大王');
  assert.deepEqual(page.posts[1].subComments, []);
  assert.equal(page.posts[2].subCount, 8);
  assert.equal(page.posts[2].subComments.length, 1);
});
