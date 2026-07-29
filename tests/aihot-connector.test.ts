import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapAiHotArticle,
  mapAiHotDailyItem,
  mapAiHotStory,
  mapAiHotTopic,
  normalizeAiHotStoryTarget,
} from '../src/crawler/platforms/aihot';

test('AI HOT item and topic responses map into connector payloads', () => {
  const item = {
    id: 'item-1',
    title: '模型发布',
    summary: '模型能力更新。',
    source: { name: '示例媒体' },
    links: { aihot: 'https://aihot.virxact.com/items/item-1', original: 'https://example.com/1' },
    attribution: { name: 'AI HOT', url: 'https://aihot.virxact.com/items/item-1' },
    category: 'ai-models',
    score: 91,
  };
  const article = mapAiHotArticle(item, '模型');
  assert.equal(article.content_id, 'item-1');
  assert.equal(article.original_url, 'https://example.com/1');
  assert.equal(article.source_keyword, '模型');
  assert.equal(article.citations.length, 2);

  const topic = mapAiHotTopic({
    ...item,
    sourceCount: 5,
    signalCount: 8,
    sourceNames: ['示例媒体', '另一媒体'],
  }, 1);
  assert.equal(topic.source_count, 5);
  assert.equal(topic.signal_count, 8);
  assert.equal(topic.rank, 1);
});

test('AI HOT daily and story responses retain provenance', () => {
  const daily = mapAiHotDailyItem({
    title: '日报条目',
    summary: '日报摘要',
    source: { name: '日报来源' },
    links: { aihot: 'https://aihot.virxact.com/items/daily-1', original: 'https://example.com/daily-1' },
  }, {
    date: '2026-07-29',
    generatedAt: '2026-07-29T00:00:00Z',
    links: { aihot: 'https://aihot.virxact.com/dailies/2026-07-29' },
  }, '模型', 2);
  assert.equal(daily.content_id, 'daily-1');
  assert.equal(daily.daily_date, '2026-07-29');
  assert.equal(daily.daily_section, '模型');

  const story = mapAiHotStory({
    publicId: 'story-1',
    title: '事件追踪',
    digest: '事件摘要',
    sourceCount: 2,
    reportCount: 1,
    links: { aihot: 'https://aihot.virxact.com/stories/story-1' },
    reports: [{
      title: '首篇报道',
      summary: '报道摘要',
      source: { name: '示例媒体' },
      links: { aihot: 'https://aihot.virxact.com/items/report-1' },
    }],
  });
  assert.equal(story.content_id, 'story-1');
  assert.match(story.description, /报道时间线/);
  assert.equal(story.citations.length, 2);
});

test('AI HOT story target accepts public IDs and story URLs only', () => {
  assert.equal(normalizeAiHotStoryTarget('story-1'), 'story-1');
  assert.equal(normalizeAiHotStoryTarget('https://aihot.virxact.com/stories/story-2'), 'story-2');
  assert.throws(
    () => normalizeAiHotStoryTarget('https://aihot.virxact.com/items/item-1'),
    /story publicId/,
  );
});
