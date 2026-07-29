import { AbstractCrawler } from '../base/BaseCrawler';
import { systemHttpClient } from '../base/SystemHttpClient';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { ConnectorRuntimeError } from '../../core/contracts/errors';

const SEARCH_API_URL = 'https://api.github.com/search/repositories';
const REPOSITORY_API_URL = 'https://api.github.com/repos';
const PAGE_SIZE = 30;
const SEARCH_REQUEST_INTERVAL_MS = 6_100;
const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 } as const;

export type GitHubRepositoryMode = 'general' | 'ai';
export type GitHubRepositoryPeriod = keyof typeof PERIOD_DAYS;

interface GitHubHttpClient {
  get(url: string, options?: Record<string, unknown>): Promise<{ data: unknown }>;
}

interface GitHubOwner {
  id?: number;
  login?: string;
  html_url?: string;
  avatar_url?: string;
  type?: string;
}

interface GitHubLicense {
  key?: string;
  name?: string;
  spdx_id?: string;
  url?: string | null;
}

interface GitHubRepositoryApiItem {
  id?: number;
  node_id?: string;
  name?: string;
  full_name?: string;
  html_url?: string;
  url?: string;
  description?: string | null;
  homepage?: string | null;
  language?: string | null;
  topics?: string[];
  owner?: GitHubOwner;
  license?: GitHubLicense | null;
  stargazers_count?: number;
  watchers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  subscribers_count?: number;
  size?: number;
  default_branch?: string;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
  private?: boolean;
  visibility?: string;
}

export interface GitHubRepository {
  content_id: string;
  repository_id?: number;
  node_id?: string;
  full_name: string;
  title: string;
  summary: string;
  description: string;
  creator_id?: string;
  creator_name: string;
  creator_url?: string;
  content_url: string;
  api_url?: string;
  homepage?: string;
  language?: string;
  topics: string[];
  license?: string;
  license_name?: string;
  stars: number;
  watchers: number;
  forks: number;
  open_issues: number;
  subscribers?: number;
  size_kb?: number;
  default_branch?: string;
  created_at?: string;
  updated_at?: string;
  pushed_at?: string;
  archived: boolean;
  disabled: boolean;
  is_fork: boolean;
  is_private: boolean;
  visibility?: string;
  search_mode?: GitHubRepositoryMode;
  period?: GitHubRepositoryPeriod;
  source_keyword?: string;
  rank?: number;
  citations: Array<{ title: string; url: string; source: string }>;
}

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nonNegative(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.floor(numberValue)) : 0;
}

export function normalizeGitHubRepositoryTarget(value: string): string {
  let target = value.trim();
  if (!target) throw new ConnectorRuntimeError('INVALID_INPUT', 'GitHub 仓库名称不能为空');

  if (/^https?:\/\//i.test(target)) {
    let url: URL;
    try {
      url = new URL(target);
    } catch (error) {
      throw new ConnectorRuntimeError('INVALID_INPUT', `无效的 GitHub 仓库链接：${target}`, false, { cause: error });
    }
    if (!/(^|\.)github\.com$/i.test(url.hostname)) {
      throw new ConnectorRuntimeError('INVALID_INPUT', `不是 GitHub 仓库链接：${target}`);
    }
    const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    if (segments.length < 2) throw new ConnectorRuntimeError('INVALID_INPUT', `无法从链接识别 GitHub 仓库：${target}`);
    target = `${segments[0]}/${segments[1]}`;
  }

  target = target.replace(/^github:/i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]+$/.test(target)) {
    throw new ConnectorRuntimeError('INVALID_INPUT', `无效的 GitHub 仓库名称：${target}`);
  }
  return target;
}

function dateDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function buildGitHubRepositoryQuery(
  keyword: string,
  mode: GitHubRepositoryMode,
  period: GitHubRepositoryPeriod,
  language = '',
  now = new Date(),
): string {
  const terms: string[] = [];
  const cleanedKeyword = cleanText(keyword);
  if (mode === 'ai') {
    if (cleanedKeyword) terms.push(cleanedKeyword);
    // GitHub repository search accepts at most five boolean operators. Six
    // broad terms keep the merged AI trend query within that public API limit.
    terms.push('(ai OR llm OR gpt OR agent OR rag OR machine-learning)');
    terms.push('in:name,description');
  } else if (cleanedKeyword) {
    terms.push(cleanedKeyword, 'in:name,description,readme');
  }
  terms.push(`pushed:>=${dateDaysAgo(PERIOD_DAYS[period], now)}`, 'stars:>=10');
  if (cleanText(language)) terms.push(`language:${cleanText(language)}`);
  return terms.join(' ');
}

export function parseGitHubRepository(
  raw: unknown,
  context: { keyword?: string; mode?: GitHubRepositoryMode; period?: GitHubRepositoryPeriod; rank?: number } = {},
): GitHubRepository {
  const item = (raw || {}) as GitHubRepositoryApiItem;
  const fullName = cleanText(item.full_name);
  const htmlUrl = cleanText(item.html_url);
  if (!item.id || !fullName || !htmlUrl) {
    throw new ConnectorRuntimeError('PAGE_STRUCTURE_CHANGED', 'GitHub API 返回的仓库数据缺少 id、full_name 或 html_url');
  }
  const ownerName = cleanText(item.owner?.login) || fullName.split('/')[0];
  const citations = [{ title: `${fullName} 仓库`, url: htmlUrl, source: 'GitHub' }];
  const homepage = cleanText(item.homepage);
  if (homepage && /^https?:\/\//i.test(homepage)) citations.push({ title: `${fullName} 项目主页`, url: homepage, source: '项目主页' });

  return {
    content_id: String(item.id),
    repository_id: item.id,
    ...(item.node_id ? { node_id: item.node_id } : {}),
    full_name: fullName,
    title: fullName,
    summary: cleanText(item.description),
    description: cleanText(item.description),
    ...(item.owner?.id ? { creator_id: String(item.owner.id) } : {}),
    creator_name: ownerName,
    ...(item.owner?.html_url ? { creator_url: item.owner.html_url } : {}),
    content_url: htmlUrl,
    ...(item.url ? { api_url: item.url } : {}),
    ...(homepage ? { homepage } : {}),
    ...(cleanText(item.language) ? { language: cleanText(item.language) } : {}),
    topics: Array.isArray(item.topics) ? item.topics.map(cleanText).filter(Boolean) : [],
    ...(item.license?.spdx_id && item.license.spdx_id !== 'NOASSERTION' ? { license: item.license.spdx_id } : {}),
    ...(item.license?.name ? { license_name: item.license.name } : {}),
    stars: nonNegative(item.stargazers_count),
    watchers: nonNegative(item.watchers_count),
    forks: nonNegative(item.forks_count),
    open_issues: nonNegative(item.open_issues_count),
    ...(item.subscribers_count !== undefined ? { subscribers: nonNegative(item.subscribers_count) } : {}),
    ...(item.size !== undefined ? { size_kb: nonNegative(item.size) } : {}),
    ...(item.default_branch ? { default_branch: item.default_branch } : {}),
    ...(item.created_at ? { created_at: item.created_at } : {}),
    ...(item.updated_at ? { updated_at: item.updated_at } : {}),
    ...(item.pushed_at ? { pushed_at: item.pushed_at } : {}),
    archived: Boolean(item.archived),
    disabled: Boolean(item.disabled),
    is_fork: Boolean(item.fork),
    is_private: Boolean(item.private),
    ...(item.visibility ? { visibility: item.visibility } : {}),
    ...(context.mode ? { search_mode: context.mode } : {}),
    ...(context.period ? { period: context.period } : {}),
    ...(context.keyword ? { source_keyword: context.keyword } : {}),
    ...(context.rank !== undefined ? { rank: context.rank } : {}),
    citations,
  };
}

export function parseGitHubRepositorySearch(
  raw: unknown,
  context: { keyword: string; mode: GitHubRepositoryMode; period: GitHubRepositoryPeriod; rankOffset: number },
): GitHubRepository[] {
  const data = (raw || {}) as { items?: unknown[] };
  if (!Array.isArray(data.items)) {
    throw new ConnectorRuntimeError('PAGE_STRUCTURE_CHANGED', 'GitHub Search API 返回内容缺少 items 数组');
  }
  return data.items.map((item, index) => parseGitHubRepository(item, {
    keyword: context.keyword,
    mode: context.mode,
    period: context.period,
    rank: context.rankOffset + index + 1,
  }));
}

export class GitHubRepositoriesCrawler extends AbstractCrawler {
  private lastSearchRequestAt = 0;

  constructor(
    private readonly client: GitHubHttpClient = systemHttpClient,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    super();
  }

  private async getJson(url: string, searchRequest = false): Promise<unknown> {
    if (searchRequest) {
      const remaining = SEARCH_REQUEST_INTERVAL_MS - (Date.now() - this.lastSearchRequestAt);
      if (this.lastSearchRequestAt && remaining > 0) await this.wait(remaining);
      this.lastSearchRequestAt = Date.now();
    }
    const response = await this.client.get(url, {
      autoCookie: false,
      maxRetries: 2,
      retryDelayMs: 2_000,
      timeout: 20_000,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'UniSearch/1.0 (anonymous GitHub repositories connector)',
      },
    });
    return response.data;
  }

  public async search(): Promise<void> {
    const configuredKeywords = String(activeConfig.KEYWORDS || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean);
    const keywords = configuredKeywords.length ? configuredKeywords : [''];
    const mode = (activeConfig.GITHUB_REPOSITORIES_MODE || 'general') as GitHubRepositoryMode;
    const period = (activeConfig.GITHUB_REPOSITORIES_PERIOD || 'weekly') as GitHubRepositoryPeriod;
    const language = cleanText(activeConfig.GITHUB_REPOSITORIES_LANGUAGE);
    const maxItems = Math.max(1, Math.min(100, Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20)));
    const startPage = Math.max(1, Math.min(34, Number(activeConfig.START_PAGE || 1)));

    for (const keyword of keywords) {
      let emitted = 0;
      let page = startPage;
      while (emitted < maxItems && page <= 34) {
        const requested = Math.min(PAGE_SIZE, maxItems - emitted);
        const parameters = new URLSearchParams({
          q: buildGitHubRepositoryQuery(keyword, mode, period, language),
          sort: 'stars',
          order: 'desc',
          per_page: String(requested),
          page: String(page),
        });
        console.log(`[GITHUB_REPOSITORIES] Searching ${mode} repositories on page ${page}...`);
        const repositories = parseGitHubRepositorySearch(await this.getJson(`${SEARCH_API_URL}?${parameters.toString()}`, true), {
          keyword,
          mode,
          period,
          rankOffset: emitted,
        });
        for (const repository of repositories) {
          await connectorOutput.emitGitHubRepository(repository);
          emitted++;
        }
        if (repositories.length < requested) break;
        page++;
      }
      console.log(`[GITHUB_REPOSITORIES] Emitted ${emitted} repositories${keyword ? ` for "${keyword}"` : ''}.`);
    }
  }

  private async fetchDetails(): Promise<void> {
    const rawTargets = Array.isArray(activeConfig.GITHUB_REPOSITORIES_SPECIFIED_ID_LIST)
      ? activeConfig.GITHUB_REPOSITORIES_SPECIFIED_ID_LIST
      : String(activeConfig.GITHUB_REPOSITORIES_SPECIFIED_ID_LIST || '').split(/[,，\n]+/);
    const targets = Array.from(new Set(rawTargets.map((value: unknown) => normalizeGitHubRepositoryTarget(String(value)))));
    if (!targets.length) throw new ConnectorRuntimeError('INVALID_INPUT', '请提供 owner/repository 或 GitHub 仓库链接');

    for (let index = 0; index < targets.length; index++) {
      const repository = parseGitHubRepository(await this.getJson(`${REPOSITORY_API_URL}/${targets[index].split('/').map(encodeURIComponent).join('/')}`), {
        rank: index + 1,
      });
      await connectorOutput.emitGitHubRepository(repository);
    }
    console.log(`[GITHUB_REPOSITORIES] Emitted ${targets.length} repository details.`);
  }

  public async start(): Promise<void> {
    if (activeConfig.CRAWLER_TYPE === 'detail') await this.fetchDetails();
    else await this.search();
  }
}
