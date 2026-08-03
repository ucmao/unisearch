import assert from 'node:assert/strict';
import test from 'node:test';
import { BilibiliCrawler } from '../src/crawler/platforms/bili';
import { KuaishouCrawler } from '../src/crawler/platforms/kuaishou';
import { XiaoHongShuCrawler } from '../src/crawler/platforms/xhs';
import { WeiboCrawler } from '../src/crawler/platforms/weibo';
import { applyConfig, resetConfig } from '../src/tools/config';

test('Bilibili creator archive follows page.count when max_items is zero', async () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 0 });
  const crawler = new BilibiliCrawler() as any;
  crawler.humanDelay = async () => {};
  crawler.signer = {
    get: async (_url: string, params: { pn: number }) => ({
      list: { vlist: params.pn === 1
        ? Array.from({ length: 30 }, (_, index) => ({ bvid: `BV${index}`, title: `v${index}` }))
        : Array.from({ length: 5 }, (_, index) => ({ bvid: `BV${30 + index}`, title: `v${30 + index}` })) },
      page: { count: 35 },
    }),
  };
  const videos = await crawler.creatorVideosViaApi('1');
  assert.equal(videos.length, 35);
  resetConfig();
});

test('Kuaishou creator archive follows pcursor to no_more without a positive ceiling', async () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 0 });
  const crawler = new KuaishouCrawler() as any;
  crawler.humanDelay = async () => {};
  crawler.graphql = async (_operation: string, _field: string, _query: string, variables: any) => {
    const ids = variables.pcursor ? ['3', '4'] : ['1', '2'];
    return {
      pcursor: variables.pcursor ? 'no_more' : 'next',
      feeds: ids.map((id) => ({ author: { id: 'u', name: 'n' }, photo: { id, caption: id } })),
    };
  };
  const videos = await crawler.listCreatorWorksViaGraphql('u');
  assert.deepEqual(videos.map((item: any) => item.video_id), ['1', '2', '3', '4']);
  resetConfig();
});

test('Xiaohongshu creator archive follows cursor until has_more is false', async () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 0 });
  const crawler = new XiaoHongShuCrawler() as any;
  crawler.humanDelay = async () => {};
  crawler.signer = {
    hasTemplate: () => true,
    request: async ({ path }: { path: string }) => {
      const cursor = new URL(`https://x.invalid${path}`).searchParams.get('cursor');
      return cursor
        ? { data: { notes: [{ note_id: 'n3', xsec_token: 't3' }], has_more: false, cursor: '' } }
        : { data: { notes: [{ note_id: 'n1' }, { note_id: 'n2' }], has_more: true, cursor: 'next' } };
    },
  };
  const notes = await crawler.listCreatorNotesViaApi('u', '', 'pc_user');
  assert.deepEqual(notes.map((item: any) => item.id), ['n1', 'n2', 'n3']);
  resetConfig();
});

test('Weibo creator archive follows since_id and deduplicates cards', async () => {
  resetConfig();
  applyConfig({ crawler_max_notes_count: 0 });
  const crawler = new WeiboCrawler() as any;
  crawler.humanDelay = async () => {};
  crawler.page = {
    goto: async () => {},
    evaluate: async (_fn: unknown, url: string) => {
      const since = new URL(url).searchParams.get('since_id');
      return since
        ? { ok: 1, data: { cardlistInfo: { total: 3, since_id: '0' }, cards: [
          { mblog: { id: '2', text: 'duplicate' } }, { mblog: { id: '3', text: 'three' } },
        ] } }
        : { ok: 1, data: { cardlistInfo: { total: 3, since_id: 'next' }, cards: [
          { mblog: { id: '1', text: 'one' } }, { mblog: { id: '2', text: 'two' } },
        ] } };
    },
  };
  const statuses = await crawler.collectCreatorStatuses('u');
  assert.deepEqual(statuses.map((item: any) => item.idstr), ['1', '2', '3']);
  resetConfig();
});
