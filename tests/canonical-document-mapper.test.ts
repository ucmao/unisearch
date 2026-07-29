import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { mapRawItemToCanonicalDocument, CONNECTOR_MAPPING_MATRIX } from '../src/connectors/mappers/canonical-document-mapper';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { listConnectorManifests } from '../src/connectors/registry';
import { parseRawItem, type RawItemKind } from '../src/core/contracts/raw-item';

function raw(source: string, kind: RawItemKind, payload: Record<string, any>) {
  const id = String(payload.content_id || payload.id || `${source}-fixture`);
  return parseRawItem({
    schemaVersion: 1,
    id: `${source}:${kind}:${id}`,
    source,
    kind,
    sourceItemId: id,
    sourceUrl: payload.content_url || payload.url,
    fetchedAt: '2026-07-27T00:00:00.000Z',
    hints: {
      title: payload.title || payload.question || '测试标题',
      text: payload.description || payload.desc || payload.answer || payload.snippet || '测试正文',
      author: payload.creator_name || payload.company_name || payload.publisher,
      publishedAt: payload.published_at,
      mediaUrls: payload.media_urls,
    },
    payload,
    metadata: {},
  });
}

test('all 27 registered connectors have an executable v2 mapping', () => {
  const manifests = listConnectorManifests();
  assert.equal(manifests.length, 27);
  assert.deepEqual(Object.keys(CONNECTOR_MAPPING_MATRIX).sort(), manifests.map((item) => item.id).sort());
  for (const manifest of manifests) {
    const document = mapRawItemToCanonicalDocument(raw(manifest.id, 'post', {
      content_id: `${manifest.id}-1`, title: `${manifest.name}测试`, description: '标准正文',
    }));
    assert.equal(document.schemaVersion, 2);
    assert.equal(document.platform, manifest.id);
    assert.equal(document.title, `${manifest.name}测试`);
  }
});

test('social mapper normalizes aliases without manufacturing missing metrics', () => {
  const fixturePath = path.resolve(import.meta.dirname, 'fixtures/connectors/xhs-note.json');
  const item = buildRawItem('emitXhsNote', JSON.parse(readFileSync(fixturePath, 'utf8')));
  const document = mapRawItemToCanonicalDocument(item, 'run-xhs');

  assert.equal(document.subject.name, '示例作者');
  assert.equal(document.subject.type, 'creator');
  assert.equal(document.summary, '脱敏后的小红书内容样本');
  assert.deepEqual(document.metrics, { likes: 12, comments: 3 });
  assert.equal(document.metrics.views, undefined);
  assert.equal(document.assets[0].kind, 'image');
  assert.equal(document.assets[0].role, 'content');
  assert.equal(document.provenance.runId, 'run-xhs');
});

test('Bilibili mapper preserves platform-specific metrics', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitBilibiliVideo', {
    video_id: 'BV-fixture', title: '视频', desc: '视频正文', nickname: 'UP主',
    video_play_count: '1.2万', video_favorite_count: '80', video_coin_count: '50',
    video_danmaku: '30', video_comment: '20', video_cover_url: 'https://example.com/cover.jpg',
  }));
  assert.deepEqual(document.metrics, { saves: 80, comments: 20, views: 12_000, coins: 50, danmaku: 30 });
  assert.equal(document.assets[0].role, 'cover');
  assert.equal(document.assets[0].url, 'https://example.com/cover.jpg');
});

test('comment mapper preserves its own identity and parent relation', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitKuaishouComment', {
    comment_id: 'comment-1', video_id: 'video-1', content: '一级评论', nickname: '评论者',
    like_count: 7, sub_comment_count: 2, create_time: 1_700_000_000,
  }));
  assert.equal(document.kind, 'comment');
  assert.equal(document.sourceItemId, 'comment-1');
  assert.equal(document.parentSourceItemId, 'video-1');
  assert.deepEqual(document.metrics, { likes: 7, replies: 2 });
});

test('search mapper maps snippet, publisher, rank and assets', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitSearchEngineResult', {
    search_engine: 'bing', content_id: 'search-1', title: '网页标题', snippet: '网页搜索摘要',
    publisher: 'example.com', real_url: 'https://example.com/page', search_rank: 4,
    source_keyword: '统一搜索', images: ['https://example.com/result.jpg'],
  }));
  assert.equal(document.kind, 'search_result');
  assert.equal(document.summary, '网页搜索摘要');
  assert.equal(document.subject.type, 'publisher');
  assert.equal(document.subject.name, 'example.com');
  assert.equal(document.rank, 4);
  assert.deepEqual(document.metrics, {});
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0].role, 'thumbnail');
});

test('AI HOT mapper preserves attribution, source metrics and citations', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitAiHotItem', {
    content_id: 'hot-1',
    title: 'AI 模型动态',
    summary: '多个来源正在讨论该事件。',
    creator_name: '示例媒体',
    content_url: 'https://aihot.virxact.com/items/hot-1',
    original_url: 'https://example.com/original',
    category: 'ai-models',
    score: 98,
    source_count: 4,
    signal_count: 7,
    content_mode: 'hot_topics',
    citations: [{ title: '原文', url: 'https://example.com/original', source: '示例媒体' }],
  }));
  assert.equal(document.kind, 'article');
  assert.equal(document.subject.type, 'publisher');
  assert.equal(document.subject.name, '示例媒体');
  assert.deepEqual(document.metrics, { score: 98, sourceCount: 4, signalCount: 7 });
  assert.equal(document.attributes.category, 'ai-models');
  assert.equal(document.attributes.contentMode, 'hot_topics');
  assert.equal(document.attributes.originalUrl, 'https://example.com/original');
  assert.deepEqual(document.citations, [{ title: '原文', url: 'https://example.com/original', source: '示例媒体' }]);
});

test('mapper preserves a cover supplied only through RawItem hints', () => {
  const raw = buildRawItem('emitDouyinAweme', {
    aweme_id: 'cover-only-1', title: '封面测试', desc: '正文',
  });
  const document = mapRawItemToCanonicalDocument({
    ...raw,
    hints: { ...raw.hints, mediaUrls: undefined, coverUrl: 'https://example.com/only-cover.jpg' },
  });
  assert.equal(document.assets.length, 1);
  assert.equal(document.assets[0].kind, 'image');
  assert.equal(document.assets[0].role, 'cover');
});

test('AI mapper keeps final answer canonical and citations structured', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitQwenResult', {
    content_id: 'qa-1', question: '什么是统一契约？', answer: '统一契约让所有消费者读取相同语义。',
    reasoning_content: '内部推理草稿', citations: [{ title: '架构文档', url: 'https://example.com/architecture' }],
    url: 'https://example.com/chat/1', time: 1_700_000_000,
  }));
  assert.equal(document.title, '什么是统一契约？');
  assert.equal(document.markdown, '统一契约让所有消费者读取相同语义。');
  assert.doesNotMatch(document.markdown, /内部推理/);
  assert.equal(document.attributes.reasoningContent, '内部推理草稿');
  assert.deepEqual(document.citations, [{ title: '架构文档', url: 'https://example.com/architecture' }]);
  assert.equal(document.subject.name, '通义千问');
});

test('job mapper creates deterministic summary and queryable attributes', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitZhaopinResult', {
    content_id: 'job-1', title: '后端工程师', company_name: '示例科技', salary: '25-40K',
    work_city: '上海', job_experience: '3-5年', education: '本科', desc: '负责统一搜索服务。',
    content_url: 'https://example.com/jobs/1', rank: 2,
  }));
  assert.equal(document.subject.type, 'company');
  assert.equal(document.subject.name, '示例科技');
  assert.equal(document.summary, '25-40K · 上海 · 3-5年 · 本科 · 示例科技');
  assert.deepEqual(document.attributes, {
    salary: '25-40K', city: '上海', experience: '3-5年', education: '本科',
  });
  assert.equal(document.rank, 2);
});

test('complaint mapper keeps status separate while including it in summary', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitHeimaoResult', {
    content_id: 'complaint-1', title: '退款投诉', desc: '[投诉商家: 示例商家] [状态: 处理中] 商家拒绝退款。', merchant_name: '示例商家',
    status: '处理中', complaint_amount: '299元', appeal: '退款', content_url: 'https://example.com/complaints/1',
  }));
  assert.equal(document.subject.type, 'merchant');
  assert.equal(document.subject.name, '示例商家');
  assert.equal(document.summary, '示例商家 · 处理中 · 299元 · 退款');
  assert.equal(document.markdown, '商家拒绝退款。');
  assert.deepEqual(document.attributes, { status: '处理中', amount: '299元', request: '退款' });
});

test('media mapper distinguishes connector platform from original platform', () => {
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitMediaParsedResult', {
    content_id: 'media-1', platform: '抖音', title: '解析作品', description: '作品文案',
    creator_name: '示例作者', video_url: 'https://example.com/video.mp4',
    images: ['https://example.com/image.jpg'], audio_url: 'https://example.com/audio.mp3',
  }));
  assert.equal(document.platform, 'media_parser');
  assert.equal(document.originalPlatform, '抖音');
  assert.deepEqual(document.assets.map((asset) => asset.kind).sort(), ['audio', 'image', 'video']);
});

test('corrected manifests expose canonical fields for non-social families', () => {
  const fields = (id: string, capability: string) => listConnectorManifests()
    .find((item) => item.id === id)!.capabilities.find((item) => item.id === capability)!
    .outputFields.map((field) => field.key);
  assert.deepEqual(fields('zhaopin', 'keyword_search').filter((key) =>
    ['summary', 'salary', 'work_city', 'job_experience', 'education', 'rank'].includes(key)),
  ['summary', 'salary', 'work_city', 'job_experience', 'education', 'rank']);
  assert.ok(fields('heimao', 'content_detail').includes('status'));
  assert.ok(fields('qwen', 'keyword_search').includes('citations'));
  assert.ok(fields('media_parser', 'url_resolve').includes('original_platform'));
});
