import assert from 'node:assert/strict';
import {
  connectorCatalogForAI,
  listConnectorManifests,
  normalizeConnectorRequest,
} from '../src/connectors/registry';
import type { ConnectorStartRequest } from '../src/connectors/types';

const baseRequest: ConnectorStartRequest = {
  platform: 'xhs',
  connector_id: 'xhs',
  capability: 'keyword_search',
  connector_options: { max_items: 42, enable_comments: true },
  login_type: 'qrcode',
  crawler_type: 'search',
  keywords: '科莱特',
  start_page: 1,
  enable_comments: false,
  headless: false,
  loop_execution: false,
};

assert.equal(listConnectorManifests().length, 32);
assert.ok(listConnectorManifests().every((manifest) => !manifest.auth.methods.includes('cookie' as never)));
assert.deepEqual(
  listConnectorManifests()
    .filter((manifest) => manifest.category === 'ai_web_qa')
    .map(({ id, name }) => [id, name]),
  [
    ['deepseek', 'DeepSeek'],
    ['kimi', 'Kimi'],
    ['doubao', '豆包'],
    ['qwen', '通义千问'],
    ['yuanbao', '腾讯元宝'],
    ['nami', '纳米AI'],
    ['wenxin', '文心一言'],
  ],
);

const normalized = normalizeConnectorRequest(baseRequest);
assert.equal(normalized.platform, 'xhs');
assert.equal(normalized.capability, 'keyword_search');
assert.equal((normalized as any).crawler_max_notes_count, 42);
assert.equal(normalized.enable_comments, true);
assert.throws(
  () => normalizeConnectorRequest({ ...baseRequest, cookies: 'secret' } as any),
  /Unsupported connector field: cookies/,
);

for (const manifest of listConnectorManifests()) {
  const expectedCapabilities = manifest.id === 'aihot' || manifest.id === 'arxiv' || manifest.id === 'github_repositories' || manifest.id === 'rss_news'
    ? ['keyword_search', 'content_detail']
    : manifest.id === 'heimao'
    ? ['keyword_search', 'content_detail', 'comments']
    : (manifest.category === 'web_search' || manifest.category === 'ai_web_qa')
    ? ['keyword_search']
    : manifest.id === 'web_reader'
    ? ['content_detail', 'url_resolve']
    : manifest.category === 'utility'
    ? ['url_resolve']
    : (manifest.category === 'job_platform' || manifest.category === 'complaint_platform')
    ? ['keyword_search', 'content_detail']
    : ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'];
  assert.deepEqual(
    manifest.capabilities.map((capability) => capability.id),
    expectedCapabilities,
    `${manifest.id} should expose the complete connector capability set`,
  );
  for (const capability of manifest.capabilities) {
    assert.ok(capability.inputFields.length > 0, `${manifest.id}:${capability.id} should declare inputs`);
    assert.ok(capability.outputFields.length > 0, `${manifest.id}:${capability.id} should declare outputs`);
    assert.ok(capability.limitations.length > 0, `${manifest.id}:${capability.id} should declare boundaries`);
  }
}

const biliDetail = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'bili',
  connector_id: 'bili',
  capability: 'content_detail',
  crawler_type: 'detail',
  specified_ids: 'BV1xx411c7mD',
  connector_options: { specified_ids: ['BV1xx411c7mD'], enable_comments: true },
});
assert.equal(biliDetail.crawler_type, 'detail');
assert.equal(biliDetail.specified_ids, 'BV1xx411c7mD');
assert.equal(biliDetail.enable_comments, true);

const catalog = connectorCatalogForAI();
assert.match(catalog, /xhs=小红书/);
assert.match(catalog, /keyword_search/);
assert.match(catalog, /输出类型：xhs_content/);
assert.match(catalog, /url_resolve/);
assert.match(catalog, /deepseek=DeepSeek/);
assert.match(catalog, /kimi=Kimi/);
assert.match(catalog, /qwen=通义千问/);
assert.match(catalog, /yuanbao=腾讯元宝/);
assert.match(catalog, /nami=纳米AI/);
assert.match(catalog, /zhaopin=智联招聘/);
assert.match(catalog, /boss=BOSS直聘/);
assert.match(catalog, /heimao=黑猫投诉/);
assert.match(catalog, /toutiao=头条搜索/);
assert.match(catalog, /aihot=AI HOT/);
assert.match(catalog, /arxiv=arXiv/);
assert.match(catalog, /github_repositories=GitHub 仓库/);
assert.match(catalog, /rss_news=RSS 新闻/);

const bossManifest = listConnectorManifests().find((manifest) => manifest.id === 'boss');
assert.ok(bossManifest);
assert.equal(bossManifest.name, 'BOSS直聘');
assert.deepEqual(bossManifest.capabilities.map((capability) => capability.id), ['keyword_search', 'content_detail']);

const heimaoManifest = listConnectorManifests().find((manifest) => manifest.id === 'heimao');
assert.ok(heimaoManifest);
assert.deepEqual(heimaoManifest.capabilities.map((capability) => capability.id), ['keyword_search', 'content_detail', 'comments']);

const bossRequest = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'boss',
  connector_id: 'boss',
  capability: 'keyword_search',
  login_type: 'qrcode',
  connector_options: { location: '上海', max_items: 500, start_page: 3 },
});
assert.equal(bossRequest.platform, 'boss');
assert.equal(bossRequest.login_type, 'none');
assert.equal((bossRequest as any).job_location, '上海');
assert.equal((bossRequest as any).crawler_max_notes_count, 500);
assert.equal(bossRequest.start_page, 3);

const arxivRequest = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'arxiv',
  connector_id: 'arxiv',
  login_type: 'qrcode',
  connector_options: {
    search_scope: 'title',
    sort_by: 'lastUpdatedDate',
    sort_order: 'ascending',
    max_items: 30,
    start_page: 2,
  },
});
assert.equal(arxivRequest.login_type, 'none');
assert.equal((arxivRequest as any).arxiv_search_scope, 'title');
assert.equal((arxivRequest as any).arxiv_sort_by, 'lastUpdatedDate');
assert.equal((arxivRequest as any).arxiv_sort_order, 'ascending');
assert.equal((arxivRequest as any).crawler_max_notes_count, 30);
assert.equal(arxivRequest.start_page, 2);

const githubRequest = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'github_repositories',
  connector_id: 'github_repositories',
  login_type: 'qrcode',
  keywords: '',
  connector_options: {
    mode: 'ai',
    period: 'monthly',
    language: 'python',
    max_items: 50,
    start_page: 3,
  },
});
assert.equal(githubRequest.login_type, 'none');
assert.equal((githubRequest as any).github_repositories_mode, 'ai');
assert.equal((githubRequest as any).github_repositories_period, 'monthly');
assert.equal((githubRequest as any).github_repositories_language, 'python');
assert.equal((githubRequest as any).crawler_max_notes_count, 50);
assert.equal(githubRequest.start_page, 3);

const rssRequest = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'rss_news',
  connector_id: 'rss_news',
  login_type: 'qrcode',
  keywords: '',
  connector_options: {
    source: 'bbc_technology',
    period: '24h',
    max_items: 40,
  },
});
assert.equal(rssRequest.login_type, 'none');
assert.equal((rssRequest as any).rss_news_source, 'bbc_technology');
assert.equal((rssRequest as any).rss_news_period, '24h');
assert.equal((rssRequest as any).crawler_max_notes_count, 40);

const aiHotRequest = normalizeConnectorRequest({
  ...baseRequest,
  platform: 'aihot',
  connector_id: 'aihot',
  login_type: 'qrcode',
  keywords: '',
  connector_options: {
    content_mode: 'hot_topics',
    items_mode: 'all',
    window: '7d',
    category: 'ai-models',
    max_items: 12,
  },
});
assert.equal(aiHotRequest.login_type, 'none');
assert.equal((aiHotRequest as any).aihot_content_mode, 'hot_topics');
assert.equal((aiHotRequest as any).aihot_items_mode, 'all');
assert.equal((aiHotRequest as any).aihot_window, '7d');
assert.equal((aiHotRequest as any).aihot_category, 'ai-models');
assert.equal((aiHotRequest as any).crawler_max_notes_count, 12);

console.log('connector registry tests passed');
