import { createHash } from 'crypto';
import { AbstractCrawler } from '../base/BaseCrawler';
import { systemHttpClient } from '../base/SystemHttpClient';
import { activeConfig } from '../../tools/config';
import { connectorOutput } from '../../connectors/output/connector-output';

const API_BASE = 'https://aihot.virxact.com/api/v1';

type JsonRecord = Record<string, any>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function apiProblem(error: any): string {
  const data = error?.response?.data;
  const requestId = data?.requestId || error?.response?.headers?.['x-request-id'];
  const detail = data?.detail || data?.title || error?.message || '未知错误';
  return requestId ? `${detail}（requestId: ${requestId}）` : String(detail);
}

function retryAfterMs(value: unknown): number {
  if (value === undefined || value === null || value === '') return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(1_000, seconds * 1_000);
  const date = Date.parse(String(value));
  return Number.isFinite(date) ? Math.max(1_000, date - Date.now()) : 1_000;
}

async function getJson(url: string): Promise<JsonRecord> {
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await systemHttpClient.get(url, {
        autoCookie: false,
        maxRetries: 1,
        timeout: 12_000,
        headers: { Accept: 'application/json' },
      });
      if (!response.data || typeof response.data !== 'object') {
        throw new Error('AI HOT 返回了无效 JSON');
      }
      return response.data as JsonRecord;
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.response?.status || 0);
      if (![429, 503].includes(status) || attempt === 3) break;
      const waitMs = retryAfterMs(error?.response?.headers?.['retry-after']);
      console.warn(`[AIHOT] HTTP ${status}; retrying in ${Math.ceil(waitMs / 1000)}s (${attempt}/3)...`);
      await sleep(waitMs);
    }
  }
  throw new Error(`AI HOT 请求失败：${apiProblem(lastError)}`);
}

function sourceName(item: JsonRecord): string {
  return String(item?.source?.name || 'AI HOT');
}

function itemCitations(item: JsonRecord): Array<{ url: string; title?: string; source?: string }> {
  const result: Array<{ url: string; title?: string; source?: string }> = [];
  if (item?.links?.original) {
    result.push({
      url: String(item.links.original),
      title: String(item.originalTitle || item.title || '原文'),
      source: sourceName(item),
    });
  }
  const canonical = item?.attribution?.url || item?.links?.aihot;
  if (canonical) {
    result.push({
      url: String(canonical),
      title: String(item.title || 'AI HOT'),
      source: String(item?.attribution?.name || 'AI HOT'),
    });
  }
  return result;
}

function itemIdFromUrl(url: unknown, fallback: string): string {
  try {
    const segments = new URL(String(url)).pathname.split('/').filter(Boolean);
    return segments.at(-1) || stableId(fallback);
  } catch {
    return stableId(fallback);
  }
}

export function mapAiHotArticle(item: JsonRecord, keyword = ''): JsonRecord {
  return {
    content_id: String(item.id),
    title: String(item.title || ''),
    original_title: item.originalTitle || undefined,
    summary: String(item.summary || ''),
    description: String(item.summary || ''),
    creator_name: sourceName(item),
    content_url: item?.links?.aihot,
    original_url: item?.links?.original,
    story_url: item?.links?.story,
    published_at: item.publishedAt,
    discovered_at: item.discoveredAt,
    category: item.category,
    score: item.score,
    selected: item.selected,
    attribution: item.attribution,
    citations: itemCitations(item),
    source_keyword: keyword || undefined,
    content_mode: 'items',
    language: 'zh-CN',
  };
}

export function mapAiHotTopic(item: JsonRecord, rank: number): JsonRecord {
  const sourceCount = Number(item.sourceCount || 0);
  const signalCount = Number(item.signalCount || 0);
  const summary = `当前热点由 ${sourceCount} 个独立来源覆盖${signalCount ? `，包含 ${signalCount} 个额外热度信号` : ''}。`;
  return {
    content_id: String(item.id),
    title: String(item.title || ''),
    summary,
    description: summary,
    creator_name: sourceName(item),
    content_url: item?.links?.aihot,
    original_url: item?.links?.original,
    story_url: item?.links?.story,
    published_at: item.latestAt,
    source_count: sourceCount,
    signal_count: signalCount,
    source_names: Array.isArray(item.sourceNames) ? item.sourceNames : [],
    rank,
    citations: itemCitations(item),
    content_mode: 'hot_topics',
    language: 'zh-CN',
  };
}

export function mapAiHotDailyItem(
  item: JsonRecord,
  report: JsonRecord,
  section: string,
  rank: number,
): JsonRecord {
  const canonical = item?.links?.aihot || report?.links?.aihot;
  const fallback = `${report.date}:${section}:${rank}:${item.title}`;
  return {
    content_id: itemIdFromUrl(canonical, fallback),
    title: String(item.title || ''),
    summary: String(item.summary || ''),
    description: String(item.summary || ''),
    creator_name: sourceName(item),
    content_url: canonical,
    original_url: item?.links?.original,
    published_at: item.publishedAt || report.generatedAt,
    daily_date: report.date,
    daily_section: section,
    report_url: report?.links?.aihot,
    attribution: item.attribution || report.attribution,
    rank,
    citations: itemCitations({ ...item, attribution: item.attribution || report.attribution }),
    content_mode: 'latest_daily',
    language: 'zh-CN',
  };
}

export function normalizeAiHotStoryTarget(value: string): string {
  const target = value.trim();
  if (!target) throw new Error('AI HOT story ID 不能为空');
  if (!/^https?:\/\//i.test(target)) {
    if (target.length > 128 || target.includes('/')) throw new Error(`无效的 AI HOT story ID：${target}`);
    return target;
  }
  const url = new URL(target);
  const segments = url.pathname.split('/').filter(Boolean);
  const storiesIndex = segments.lastIndexOf('stories');
  const publicId = storiesIndex >= 0 ? segments[storiesIndex + 1] : '';
  if (!publicId) {
    throw new Error('请提供 AI HOT API 返回的 story publicId 或 /stories/ 链接；普通 /items/ 链接不能推导事件 ID');
  }
  return publicId;
}

export function mapAiHotStory(story: JsonRecord): JsonRecord {
  const reports = Array.isArray(story.reports) ? story.reports : [];
  const timeline = reports.map((report: JsonRecord) => {
    const title = String(report.title || '未命名报道');
    const url = report?.links?.aihot;
    const heading = url ? `[${title}](${url})` : title;
    const meta = [report.publishedAt, report?.source?.name].filter(Boolean).join(' · ');
    return `- ${heading}${meta ? `（${meta}）` : ''}${report.summary ? `\n  ${report.summary}` : ''}`;
  }).join('\n');
  const digest = String(story.digest || story.latest || '');
  const markdown = [
    digest,
    timeline ? `## 报道时间线\n\n${timeline}` : '',
  ].filter(Boolean).join('\n\n');
  const citations = reports
    .filter((report: JsonRecord) => report?.links?.aihot)
    .map((report: JsonRecord) => ({
      url: String(report.links.aihot),
      title: String(report.title || 'AI HOT 报道'),
      source: String(report?.source?.name || 'AI HOT'),
    }));
  if (story?.links?.aihot) {
    citations.unshift({ url: String(story.links.aihot), title: String(story.title || 'AI HOT 事件'), source: 'AI HOT' });
  }
  return {
    content_id: String(story.publicId),
    title: String(story.title || ''),
    summary: digest,
    description: markdown,
    creator_name: 'AI HOT',
    content_url: story?.links?.aihot,
    published_at: story.firstReportAt,
    updated_at: story.digestUpdatedAt || story.latestAt,
    story_status: story.status,
    source_count: story.sourceCount,
    report_count: story.reportCount,
    reports,
    storyline: Array.isArray(story.storyline) ? story.storyline : [],
    related: Array.isArray(story.related) ? story.related : [],
    citations,
    content_mode: 'story',
    language: 'zh-CN',
  };
}

export class AiHotCrawler extends AbstractCrawler {
  public async search(): Promise<void> { await this.start(); }
  private maxItems(): number {
    return Math.max(1, Math.min(100, Number(activeConfig.CRAWLER_MAX_NOTES_COUNT || 20)));
  }

  private async fetchItems(): Promise<void> {
    const keywords = String(activeConfig.KEYWORDS || '').split(',').map((value) => value.trim()).filter(Boolean);
    const queries = keywords.length ? keywords : [''];
    const mode = activeConfig.AIHOT_ITEMS_MODE === 'all' ? 'all' : 'selected';
    const window = activeConfig.AIHOT_WINDOW === '7d' ? '7d' : '24h';
    const category = String(activeConfig.AIHOT_CATEGORY || 'all');
    const maxItems = this.maxItems();

    for (const keyword of queries) {
      if (keyword && [...keyword].length < 2) throw new Error(`AI HOT 关键词至少需要 2 个字符：${keyword}`);
      let emitted = 0;
      let cursor = '';
      do {
        const params = new URLSearchParams({
          mode,
          window,
          limit: String(Math.min(100, maxItems - emitted)),
        });
        if (keyword) params.set('q', keyword);
        if (category !== 'all') params.set('category', category);
        if (cursor) params.set('cursor', cursor);
        const response = await getJson(`${API_BASE}/items?${params.toString()}`);
        const items = Array.isArray(response.items) ? response.items : [];
        for (const item of items) {
          await connectorOutput.emitAiHotItem(mapAiHotArticle(item, keyword));
          emitted++;
          if (emitted >= maxItems) break;
        }
        cursor = response?.page?.hasMore ? String(response?.page?.nextCursor || '') : '';
      } while (cursor && emitted < maxItems);
      console.log(`[AIHOT] Collected ${emitted} item(s)${keyword ? ` for "${keyword}"` : ''}.`);
    }
  }

  private async fetchHotTopics(): Promise<void> {
    const response = await getJson(`${API_BASE}/hot-topics`);
    const items = (Array.isArray(response.items) ? response.items : []).slice(0, this.maxItems());
    for (const [index, item] of items.entries()) {
      await connectorOutput.emitAiHotItem(mapAiHotTopic(item, index + 1));
    }
    console.log(`[AIHOT] Collected ${items.length} current hot topic(s).`);
  }

  private async fetchLatestDaily(): Promise<void> {
    const response = await getJson(`${API_BASE}/dailies/latest`);
    const report = response.report;
    if (!report || typeof report !== 'object') throw new Error('AI HOT 最新日报响应缺少 report');
    const entries: Array<{ item: JsonRecord; section: string }> = [];
    for (const section of Array.isArray(report.sections) ? report.sections : []) {
      for (const item of Array.isArray(section.items) ? section.items : []) {
        entries.push({ item, section: String(section.label || '日报') });
      }
    }
    for (const item of Array.isArray(report.flashes) ? report.flashes : []) {
      entries.push({ item, section: '快讯' });
    }
    const selected = entries.slice(0, this.maxItems());
    for (const [index, entry] of selected.entries()) {
      await connectorOutput.emitAiHotItem(mapAiHotDailyItem(entry.item, report, entry.section, index + 1));
    }
    console.log(`[AIHOT] Collected ${selected.length} item(s) from daily ${report.date}.`);
  }

  private async fetchStories(): Promise<void> {
    const rawTargets = Array.isArray(activeConfig.AIHOT_SPECIFIED_ID_LIST)
      ? activeConfig.AIHOT_SPECIFIED_ID_LIST
      : [];
    if (!rawTargets.length) throw new Error('请提供至少一个 AI HOT story publicId 或 /stories/ 链接');
    for (const target of rawTargets) {
      const publicId = normalizeAiHotStoryTarget(String(target));
      const response = await getJson(`${API_BASE}/stories/${encodeURIComponent(publicId)}`);
      if (!response.story || typeof response.story !== 'object') throw new Error(`AI HOT story ${publicId} 响应缺少 story`);
      await connectorOutput.emitAiHotItem(mapAiHotStory(response.story));
      console.log(`[AIHOT] Collected story ${publicId}.`);
    }
  }

  public async start(): Promise<void> {
    console.log('[AIHOT] Starting anonymous REST API v1 connector...');
    if (activeConfig.CRAWLER_TYPE === 'detail') {
      await this.fetchStories();
      return;
    }
    if (activeConfig.AIHOT_CONTENT_MODE === 'hot_topics') await this.fetchHotTopics();
    else if (activeConfig.AIHOT_CONTENT_MODE === 'latest_daily') await this.fetchLatestDaily();
    else await this.fetchItems();
  }
}
