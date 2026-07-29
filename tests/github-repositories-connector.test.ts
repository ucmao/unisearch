import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  GitHubRepositoriesCrawler,
  buildGitHubRepositoryQuery,
  normalizeGitHubRepositoryTarget,
  parseGitHubRepository,
  parseGitHubRepositorySearch,
} from '../src/crawler/platforms/github_repositories';
import { buildRawItem, connectorOutput } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { MemoryOutputSink } from '../src/core/sinks/memory';
import { applyConfig, resetConfig } from '../src/tools/config';

const fixture = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'fixtures/github-repository.json'), 'utf8'));

test('GitHub repository parser retains identity, metadata and citations', () => {
  const repository = parseGitHubRepository(fixture, {
    keyword: 'react', mode: 'general', period: 'weekly', rank: 2,
  });
  assert.equal(repository.content_id, '10270250');
  assert.equal(repository.full_name, 'facebook/react');
  assert.equal(repository.creator_name, 'facebook');
  assert.equal(repository.stars, 240000);
  assert.equal(repository.license, 'MIT');
  assert.deepEqual(repository.topics.slice(0, 2), ['declarative', 'frontend']);
  assert.equal(repository.rank, 2);
  assert.equal(repository.citations.length, 2);
});

test('GitHub repository query builder merges general and AI trend modes', () => {
  const now = new Date('2026-07-29T00:00:00.000Z');
  assert.equal(
    buildGitHubRepositoryQuery('', 'general', 'daily', 'python', now),
    'pushed:>=2026-07-28 stars:>=10 language:python',
  );
  assert.equal(
    buildGitHubRepositoryQuery('agent framework', 'ai', 'monthly', '', now),
    'agent framework (ai OR llm OR gpt OR agent OR rag OR machine-learning) in:name,description pushed:>=2026-06-29 stars:>=10',
  );
  assert.match(buildGitHubRepositoryQuery('', 'ai', 'weekly', '', now), /^\(ai OR llm OR gpt/);
});

test('GitHub repository targets accept owner/name and repository URLs only', () => {
  assert.equal(normalizeGitHubRepositoryTarget('facebook/react'), 'facebook/react');
  assert.equal(normalizeGitHubRepositoryTarget('github:openai/openai-node.git'), 'openai/openai-node');
  assert.equal(normalizeGitHubRepositoryTarget('https://github.com/microsoft/TypeScript/issues/123'), 'microsoft/TypeScript');
  assert.throws(() => normalizeGitHubRepositoryTarget('https://gitlab.com/example/repo'), /不是 GitHub 仓库链接/);
  assert.throws(() => normalizeGitHubRepositoryTarget('missing-owner'), /无效的 GitHub 仓库名称/);
});

test('GitHub repository output maps into canonical article fields', () => {
  const repository = parseGitHubRepository(fixture, {
    keyword: 'react', mode: 'general', period: 'weekly', rank: 1,
  });
  const document = mapRawItemToCanonicalDocument(buildRawItem('emitGitHubRepository', repository), 'run-github');
  assert.equal(document.platform, 'github_repositories');
  assert.equal(document.kind, 'article');
  assert.equal(document.sourceItemId, '10270250');
  assert.equal(document.sourceUrl, 'https://github.com/facebook/react');
  assert.equal(document.canonicalKey, 'github_repositories:article:10270250');
  assert.equal(document.subject.type, 'creator');
  assert.equal(document.subject.name, 'facebook');
  assert.equal(document.keyword, 'react');
  assert.deepEqual(document.metrics, {
    stars: 240000, forks: 49000, watchers: 240000, openIssues: 950, subscribers: 6700,
  });
  assert.equal(document.attributes.fullName, 'facebook/react');
  assert.equal(document.attributes.license, 'MIT');
  assert.equal(document.sourceUpdatedAt, '2026-07-29T01:02:03Z');
  assert.equal(document.citations.length, 2);
});

test('GitHub repository crawler performs an anonymous search request and emits normalized items', async () => {
  const requests: Array<{ url: string; options?: Record<string, unknown> }> = [];
  const client = {
    async get(url: string, options?: Record<string, unknown>) {
      requests.push({ url, options });
      return { data: { total_count: 1, incomplete_results: false, items: [fixture] } };
    },
  };
  const sink = new MemoryOutputSink();
  applyConfig({
    platform: 'github_repositories', crawler_type: 'search', keywords: 'react',
    crawler_max_notes_count: 1, start_page: 2,
    github_repositories_mode: 'general', github_repositories_period: 'weekly', github_repositories_language: 'typescript',
  });
  await connectorOutput.open(sink, {
    runId: 'run-github-request', source: 'github_repositories', startedAt: new Date().toISOString(),
  });
  try {
    await new GitHubRepositoriesCrawler(client).search();
    await connectorOutput.close({ status: 'completed' });
  } catch (error) {
    await connectorOutput.abort(error as Error);
    throw error;
  } finally {
    resetConfig();
  }

  assert.equal(requests.length, 1);
  const requestUrl = new URL(requests[0].url);
  assert.equal(requestUrl.origin + requestUrl.pathname, 'https://api.github.com/search/repositories');
  assert.equal(requestUrl.searchParams.get('page'), '2');
  assert.equal(requestUrl.searchParams.get('per_page'), '1');
  assert.match(requestUrl.searchParams.get('q') || '', /react in:name,description,readme/);
  assert.match(requestUrl.searchParams.get('q') || '', /language:typescript/);
  assert.equal(requests[0].options?.autoCookie, false);
  assert.equal((requests[0].options?.headers as Record<string, string>).Authorization, undefined);
  assert.equal(sink.items.length, 1);
  assert.equal(sink.items[0].source, 'github_repositories');
  assert.equal(sink.items[0].kind, 'article');
});

test('GitHub search response parser rejects a changed response structure', () => {
  assert.throws(() => parseGitHubRepositorySearch({}, {
    keyword: '', mode: 'general', period: 'weekly', rankOffset: 0,
  }), /缺少 items 数组/);
});
