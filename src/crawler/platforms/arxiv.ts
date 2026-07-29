import * as cheerio from 'cheerio';
import { AbstractCrawler } from '../base/BaseCrawler';
import { systemHttpClient } from '../base/SystemHttpClient';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';
import { ConnectorRuntimeError } from '../../core/contracts/errors';

const API_URL = 'https://export.arxiv.org/api/query';
const PAGE_SIZE = 25;
const REQUEST_INTERVAL_MS = 3_000;

export type ArxivSearchScope = 'all' | 'title' | 'author' | 'abstract' | 'category';
export type ArxivSortBy = 'relevance' | 'lastUpdatedDate' | 'submittedDate';
export type ArxivSortOrder = 'ascending' | 'descending';

interface ArxivHttpClient {
  get(url: string, options?: Record<string, unknown>): Promise<{ data: unknown }>;
}

export interface ArxivPaper {
  content_id: string;
  arxiv_id: string;
  version?: number;
  title: string;
  summary: string;
  description: string;
  creator_name: string;
  authors: string[];
  categories: string[];
  primary_category?: string;
  content_url: string;
  pdf_url?: string;
  published_at?: string;
  updated_at?: string;
  comment?: string;
  journal_ref?: string;
  doi?: string;
  source_keyword?: string;
  rank?: number;
  language: string;
  citations: Array<{ title: string; url: string; source: string }>;
}

function cleanText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function directChildText(entry: cheerio.Cheerio<any>, name: string): string | undefined {
  const value = entry.children().filter((_, element) => (element as any).name === name).first().text();
  return cleanText(value) || undefined;
}

function parseVersionedId(value: string): { baseId: string; arxivId: string; version?: number } {
  const match = value.match(/^(.+?)(?:v(\d+))?$/i);
  const baseId = match?.[1] || value;
  const version = match?.[2] ? Number(match[2]) : undefined;
  return { baseId, arxivId: value, ...(version ? { version } : {}) };
}

export function normalizeArxivTarget(value: string): string {
  let target = value.trim();
  if (!target) throw new ConnectorRuntimeError('INVALID_INPUT', 'arXiv ID 不能为空');

  if (/^https?:\/\//i.test(target)) {
    let url: URL;
    try {
      url = new URL(target);
    } catch (error) {
      throw new ConnectorRuntimeError('INVALID_INPUT', `无效的 arXiv 链接：${target}`, false, { cause: error });
    }
    if (!/(^|\.)arxiv\.org$/i.test(url.hostname)) {
      throw new ConnectorRuntimeError('INVALID_INPUT', `不是 arXiv 链接：${target}`);
    }
    const match = decodeURIComponent(url.pathname).match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?\/?$/i);
    if (!match) throw new ConnectorRuntimeError('INVALID_INPUT', `无法从链接识别 arXiv ID：${target}`);
    target = match[1];
  }

  target = target.replace(/^arxiv:/i, '').replace(/\.pdf$/i, '').trim();
  const valid = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?$/i;
  if (!valid.test(target)) throw new ConnectorRuntimeError('INVALID_INPUT', `无效的 arXiv ID：${target}`);
  return target;
}

export function buildArxivSearchQuery(keyword: string, scope: ArxivSearchScope): string {
  const value = cleanText(keyword);
  if (!value) throw new ConnectorRuntimeError('INVALID_INPUT', 'arXiv 搜索关键词不能为空');
  if (scope === 'category') return `cat:${value}`;
  const prefixes: Record<Exclude<ArxivSearchScope, 'category'>, string> = {
    all: 'all',
    title: 'ti',
    author: 'au',
    abstract: 'abs',
  };
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${prefixes[scope]}:"${escaped}"`;
}

export function parseArxivAtom(xml: unknown, sourceKeyword = '', rankOffset = 0): ArxivPaper[] {
  const source = Buffer.isBuffer(xml) ? xml.toString('utf8') : String(xml || '');
  const $ = cheerio.load(source, { xmlMode: true });
  if (!$('feed').length) {
    throw new ConnectorRuntimeError('PAGE_STRUCTURE_CHANGED', 'arXiv API 返回的内容不是 Atom Feed');
  }

  const papers: ArxivPaper[] = [];
  $('feed > entry').each((index, element) => {
    const entry = $(element);
    const entryUrl = cleanText(entry.children('id').first().text());
    const rawId = entryUrl.split('/abs/').at(-1) || '';
    if (!rawId) return;
    const { baseId, arxivId, version } = parseVersionedId(rawId);
    const title = cleanText(entry.children('title').first().text());
    const summary = cleanText(entry.children('summary').first().text());
    const authors = entry.find('author > name').map((_, author) => cleanText($(author).text())).get().filter(Boolean);
    const categories = entry.children('category').map((_, category) => cleanText($(category).attr('term'))).get().filter(Boolean);
    const primaryCategory = cleanText(entry.children().filter((_, child) => (child as any).name === 'arxiv:primary_category').attr('term')) || categories[0];
    let versionAbstractUrl = entryUrl || `https://arxiv.org/abs/${arxivId}`;
    let pdfUrl = '';
    entry.children('link').each((_, link) => {
      const relation = $(link).attr('rel');
      const type = $(link).attr('type');
      const titleAttribute = $(link).attr('title');
      const href = $(link).attr('href') || '';
      if ((relation === 'alternate' || type === 'text/html') && href) versionAbstractUrl = href;
      if ((titleAttribute === 'pdf' || type === 'application/pdf') && href) pdfUrl = href;
    });
    if (!pdfUrl) pdfUrl = `https://arxiv.org/pdf/${arxivId}`;

    const citations = [
      { title: `${title || arxivId}（摘要页）`, url: versionAbstractUrl, source: 'arXiv' },
      { title: `${title || arxivId}（PDF）`, url: pdfUrl, source: 'arXiv' },
    ];
    const doi = directChildText(entry, 'arxiv:doi');
    if (doi) citations.push({ title: `DOI ${doi}`, url: `https://doi.org/${doi}`, source: 'DOI' });

    papers.push({
      content_id: baseId,
      arxiv_id: arxivId,
      ...(version ? { version } : {}),
      title,
      summary,
      description: summary,
      creator_name: authors.join(', '),
      authors,
      categories,
      ...(primaryCategory ? { primary_category: primaryCategory } : {}),
      // Keep the canonical source URL version-independent so a new paper
      // revision updates one Document instead of creating a duplicate.
      content_url: `https://arxiv.org/abs/${baseId}`,
      pdf_url: pdfUrl,
      published_at: cleanText(entry.children('published').first().text()) || undefined,
      updated_at: cleanText(entry.children('updated').first().text()) || undefined,
      comment: directChildText(entry, 'arxiv:comment'),
      journal_ref: directChildText(entry, 'arxiv:journal_ref'),
      ...(doi ? { doi } : {}),
      ...(sourceKeyword ? { source_keyword: sourceKeyword } : {}),
      rank: rankOffset + index + 1,
      language: 'en',
      citations,
    });
  });
  return papers;
}

export class ArxivCrawler extends AbstractCrawler {
  private lastRequestAt = 0;

  constructor(
    private readonly client: ArxivHttpClient = systemHttpClient,
    private readonly wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    super();
  }

  private async getFeed(parameters: URLSearchParams): Promise<unknown> {
    const remaining = REQUEST_INTERVAL_MS - (Date.now() - this.lastRequestAt);
    if (this.lastRequestAt && remaining > 0) await this.wait(remaining);
    this.lastRequestAt = Date.now();
    const response = await this.client.get(`${API_URL}?${parameters.toString()}`, {
      autoCookie: false,
      maxRetries: 2,
      retryDelayMs: REQUEST_INTERVAL_MS,
      timeout: 20_000,
      headers: {
        Accept: 'application/atom+xml, application/xml;q=0.9',
        'User-Agent': 'UniSearch/1.0 (local desktop arXiv metadata connector)',
      },
    });
    return response.data;
  }

  public async search(): Promise<void> {
    const keywords = String(activeConfig.KEYWORDS || '').split(/[,，\n]+/).map((value) => value.trim()).filter(Boolean);
    if (!keywords.length) throw new ConnectorRuntimeError('INVALID_INPUT', 'arXiv 搜索至少需要一个关键词');

    const maxItems = Math.max(1, Math.min(100, Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 15)));
    const startPage = Math.max(1, Number(activeConfig.START_PAGE || 1));
    const scope = (activeConfig.ARXIV_SEARCH_SCOPE || 'all') as ArxivSearchScope;
    const sortBy = (activeConfig.ARXIV_SORT_BY || 'submittedDate') as ArxivSortBy;
    const sortOrder = (activeConfig.ARXIV_SORT_ORDER || 'descending') as ArxivSortOrder;

    for (const keyword of keywords) {
      let emitted = 0;
      let start = (startPage - 1) * PAGE_SIZE;
      while (emitted < maxItems) {
        const requested = Math.min(PAGE_SIZE, maxItems - emitted);
        const parameters = new URLSearchParams({
          search_query: buildArxivSearchQuery(keyword, scope),
          start: String(start),
          max_results: String(requested),
          sortBy,
          sortOrder,
        });
        console.log(`[ARXIV] Searching "${keyword}" from result ${start + 1}, requesting ${requested} papers...`);
        const papers = parseArxivAtom(await this.getFeed(parameters), keyword, emitted);
        for (const paper of papers) {
          await connectorOutput.emitArxivPaper(paper);
          emitted++;
          if (emitted >= maxItems) break;
        }
        if (papers.length < requested) break;
        start += papers.length;
      }
      console.log(`[ARXIV] Emitted ${emitted} papers for "${keyword}".`);
    }
  }

  private async fetchDetails(): Promise<void> {
    const rawTargets = Array.isArray(activeConfig.ARXIV_SPECIFIED_ID_LIST)
      ? activeConfig.ARXIV_SPECIFIED_ID_LIST
      : String(activeConfig.ARXIV_SPECIFIED_ID_LIST || '').split(/[,，\n]+/);
    const ids = Array.from(new Set(rawTargets.map((value: unknown) => normalizeArxivTarget(String(value)))));
    if (!ids.length) throw new ConnectorRuntimeError('INVALID_INPUT', '请提供 arXiv ID 或论文链接');

    let rank = 0;
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      const parameters = new URLSearchParams({ id_list: batch.join(','), max_results: String(batch.length) });
      const papers = parseArxivAtom(await this.getFeed(parameters), '', rank);
      for (const paper of papers) {
        await connectorOutput.emitArxivPaper(paper);
        rank++;
      }
    }
    console.log(`[ARXIV] Emitted ${rank} paper details.`);
  }

  public async start(): Promise<void> {
    if (activeConfig.CRAWLER_TYPE === 'detail') await this.fetchDetails();
    else await this.search();
  }
}
