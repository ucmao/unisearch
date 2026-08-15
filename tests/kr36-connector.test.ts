import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapKr36Article,
  mapKr36HotTopic,
  mapKr36NewsFlash,
  normalizeKr36Target,
} from '../src/crawler/platforms/kr36';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';

test('36Kr target normalizer extracts article and newsflash IDs correctly', () => {
  assert.equal(normalizeKr36Target('289123456789'), '289123456789');
  assert.equal(normalizeKr36Target('https://36kr.com/p/289123456789'), '289123456789');
  assert.equal(normalizeKr36Target('https://36kr.com/p/289123456789.html'), '289123456789');
  assert.equal(normalizeKr36Target('https://36kr.com/newsflashes/1987654321'), '1987654321');
  assert.throws(() => normalizeKr36Target('   '), /36氪文章链接或 ID 不能为空/);
});

test('36Kr article payload maps into connector payload and canonical document', () => {
  const rawItem = {
    itemId: '28912345',
    widgetTitle: '具身智能创业公司获数亿元融资',
    summary: '领投方为一线创投机构，本轮融资将用于核心算法研发。',
    widgetContent: '具身智能领域迎来重大投资。某初创公司今日宣布完成数亿元 Pre-A 轮融资。',
    author: '36氪专栏作者',
    authorId: '10086',
    publishTime: 1723700000000,
    widgetImage: 'https://img.36krcdn.com/test.jpg',
    columnName: '人工智能',
    likeCount: 156,
    commentCount: 42,
    viewCount: 12800,
    shareCount: 18,
  };

  const article = mapKr36Article(rawItem, '具身智能');
  assert.equal(article.content_id, '28912345');
  assert.equal(article.title, '具身智能创业公司获数亿元融资');
  assert.equal(article.creator_name, '36氪专栏作者');
  assert.equal(article.content_url, 'https://36kr.com/p/28912345');
  assert.equal(article.likes, 156);
  assert.equal(article.comments, 42);
  assert.equal(article.views, 12800);
  assert.equal(article.citations.length, 1);

  const raw = buildRawItem('emitKr36Article', article);
  const doc = mapRawItemToCanonicalDocument(raw, 'run-kr36-test');

  assert.equal(doc.platform, 'kr36');
  assert.equal(doc.title, '具身智能创业公司获数亿元融资');
  assert.equal(doc.subject.name, '36氪专栏作者');
  assert.equal(doc.subject.type, 'publisher');
  assert.equal(doc.metrics.likes, 156);
  assert.equal(doc.metrics.comments, 42);
  assert.equal(doc.metrics.views, 12800);
  assert.equal(doc.attributes.columnName, '人工智能');
});

test('36Kr newsflash and hot topic map appropriately', () => {
  const newsflash = mapKr36NewsFlash({
    itemId: '998877',
    widgetTitle: '大模型公司发布最新旗舰架构',
    widgetContent: '今日发布最新开源基座大模型，上下文窗口提升至 1M。',
    publishTime: 1723701234000,
  });
  assert.equal(newsflash.content_id, '998877');
  assert.equal(newsflash.content_mode, 'newsflash');
  assert.equal(newsflash.content_url, 'https://36kr.com/newsflashes/998877');

  const hotTopic = mapKr36HotTopic({
    itemId: '556677',
    widgetTitle: '24小时热门商业榜第一名',
    summary: '热度飙升的商业焦点',
    author: '36氪热榜',
    publishTime: 1723705678000,
  }, 1);
  assert.equal(hotTopic.content_id, '556677');
  assert.equal(hotTopic.rank, 1);
  assert.equal(hotTopic.content_mode, 'hot_topics');
});
