import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from './connection';

export interface RunConfig {
  platform: string;
  keywords: string;
  crawler_type: string;
  thread_id?: string;
  workflow_id?: string;
  task_title?: string;
  [key: string]: any;
}

export interface ContentRecord {
  [key: string]: string | number;
  run_id: string;
  platform: string;
  platform_label: string;
  content_id: string;
  content_type: string;
  keyword: string;
  title: string;
  description: string;
  creator_id: string;
  creator_name: string;
  cover_url: string;
  content_url: string;
  published_at: number;
  likes: number;
  saves: number;
  comments: number;
  shares: number;
  views: number;
  engagement: number;
  source_file: string;
  source_metadata: string;
}

export interface CommentRecord {
  platform: string;
  platform_label: string;
  content_id: string;
  comment_id: string;
  parent_comment_id: string;
  level: 1 | 2;
  content: string;
  creator_id: string;
  creator_name: string;
  published_at: number;
  likes: number;
  sub_comment_count: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书', douyin: '抖音', kuaishou: '快手', bili: '哔哩哔哩',
  weibo: '微博', tieba: '贴吧', zhihu: '知乎', baidu: '百度',
  bing: '必应', so360: '360搜索', sogou: '搜狗', media_parser: '综合解析',
  zhaopin: '智联招聘', heimao: '黑猫投诉', deepseek: 'DeepSeek',
  doubao: '豆包', kimi: 'Kimi', nami: '纳米AI', qwen: '通义千问',
  wenxin: '文心一言', yuanbao: '腾讯元宝',
};

function parseJson(value: unknown): Record<string, any> {
  if (typeof value !== 'string') return {};
  try { return JSON.parse(value); } catch { return {}; }
}

export function parseMetric(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.max(0, Math.floor(value));
  const text = String(value).trim().toLowerCase().replace(/,/g, '').replace(/\+/g, '');
  const suffix = text.at(-1) || '';
  const multiplier = suffix === '万' || suffix === 'w' ? 10000 : suffix === '千' || suffix === 'k' ? 1000 : 1;
  const parsed = Number.parseFloat(multiplier === 1 ? text : text.slice(0, -1));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed * multiplier)) : 0;
}

export function parseTimestamp(value: any): number {
  if (value === null || value === undefined || value === '') return 0;
  let timestamp = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(timestamp)) timestamp = Date.parse(String(value)) / 1000;
  if (!Number.isFinite(timestamp)) return 0;
  if (timestamp > 10000000000) timestamp /= 1000;
  return Math.max(0, Math.floor(timestamp));
}

function metric(payload: Record<string, any>, keys: string[]): number {
  for (const key of keys) if (payload[key] !== undefined) return parseMetric(payload[key]);
  return 0;
}

function rowToContent(row: any): ContentRecord {
  const payload = parseJson(row.raw_payload_json);
  const likes = metric(payload, ['likes', 'liked_count', 'voteup_count', 'total_liked']);
  const saves = metric(payload, ['saves', 'collected_count', 'video_favorite_count']);
  const comments = metric(payload, ['comments', 'comment_count', 'comments_count', 'video_comment', 'total_replay_num']);
  const shares = metric(payload, ['shares', 'share_count', 'shared_count', 'video_share_count']);
  const views = metric(payload, ['views', 'viewd_count', 'video_play_count']);
  const metadata = parseJson(row.metadata_json);
  return {
    run_id: row.run_id || '',
    platform: row.source,
    platform_label: PLATFORM_LABELS[row.source] || row.source,
    content_id: row.source_item_id || row.document_id,
    content_type: row.kind,
    keyword: row.keywords || '未标记关键词',
    title: row.title || '',
    description: row.markdown || '',
    creator_id: String(payload.creator_id || payload.creator_hash || ''),
    creator_name: row.author || '',
    cover_url: String(payload.cover_url || payload.video_cover_url || ''),
    content_url: row.source_url || '',
    published_at: parseTimestamp(row.published_at),
    likes,
    saves,
    comments,
    shares,
    views,
    engagement: likes + saves + comments + shares,
    source_file: `document:${row.document_id}`,
    source_metadata: JSON.stringify({ ...metadata, raw: payload }),
  };
}

export class AnalyticsRepository {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  createRun(config: RunConfig, taskName = ''): string {
    const runId = crypto.randomUUID().replace(/-/g, '');
    const title = String(config.task_title || taskName || config.keywords || config.platform);
    this.db.prepare(`
      INSERT INTO crawl_runs (
        run_id, thread_id, workflow_id, task_title, task_name, platform,
        crawler_type, keywords, status, started_at, config_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      runId,
      config.thread_id || null,
      config.workflow_id || null,
      title,
      taskName || title,
      config.platform,
      config.crawler_type || '',
      config.keywords || '',
      new Date().toISOString(),
      JSON.stringify(config),
    );
    return runId;
  }

  finishRun(runId: string, status: string, exitCode: number | null, _contents: any[], errorMessage = ''): void {
    const count = Number((this.db.prepare(
      'SELECT COUNT(*) AS count FROM document_sources WHERE run_id=?',
    ).get(runId) as any)?.count || 0);
    this.db.prepare(`
      UPDATE crawl_runs SET status=?, finished_at=?, exit_code=?, item_count=?, error_message=?
      WHERE run_id=?
    `).run(status, new Date().toISOString(), exitCode, count, errorMessage || null, runId);
  }

  appendRunLog(runId: string, log: { platform: string; timestamp: string; level: string; message: string }): number {
    return Number(this.db.prepare(`
      INSERT INTO crawl_run_logs (run_id, platform, timestamp, level, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(runId, log.platform, log.timestamp, log.level, log.message, new Date().toISOString()).lastInsertRowid);
  }

  listRunLogs(platform?: string, limit = 500, threadId?: string): any[] {
    const where: string[] = [];
    const params: any[] = [];
    if (platform) { where.push('l.platform=?'); params.push(platform); }
    if (threadId) { where.push('r.thread_id=?'); params.push(threadId); }
    const sql = `
      SELECT l.*, r.thread_id FROM crawl_run_logs l
      JOIN crawl_runs r ON r.run_id=l.run_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY l.id DESC LIMIT ?
    `;
    return (this.db.prepare(sql).all(...params, Math.max(1, Math.min(limit, 2000))) as any[]).reverse();
  }

  private loadContentRows(params: {
    run_id?: string | null; plan_id?: string | null; thread_id?: string | null;
    platform?: string | null; keyword?: string | null; query?: string | null;
  }): ContentRecord[] {
    const where: string[] = ["d.kind != 'comment'"];
    const values: any[] = [];
    if (params.run_id && params.run_id !== 'all') { where.push('s.run_id=?'); values.push(params.run_id); }
    if (params.plan_id && params.plan_id !== 'all') { where.push('r.workflow_id=?'); values.push(params.plan_id); }
    if (params.thread_id && params.thread_id !== 'all') { where.push('r.thread_id=?'); values.push(params.thread_id); }
    if (params.platform && params.platform !== 'all') { where.push('s.source=?'); values.push(params.platform); }
    const rows = this.db.prepare(`
      SELECT d.*, s.run_id, s.source, s.source_item_id, s.raw_payload_json,
             r.keywords, r.workflow_id, r.thread_id
      FROM document_sources s
      JOIN documents d ON d.document_id=s.document_id
      LEFT JOIN crawl_runs r ON r.run_id=s.run_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.updated_at DESC
    `).all(...values) as any[];
    let contents = rows.map(rowToContent);
    if (!params.run_id && !params.plan_id && !params.thread_id) {
      const seen = new Set<string>();
      contents = contents.filter((item) => {
        const key = `${item.platform}:${item.content_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (params.keyword && params.keyword !== 'all') contents = contents.filter((item) => item.keyword.includes(params.keyword!));
    if (params.query) {
      const query = params.query.toLowerCase();
      contents = contents.filter((item) =>
        `${item.title} ${item.description} ${item.creator_name} ${item.content_id}`.toLowerCase().includes(query),
      );
    }
    return contents;
  }

  queryContents(params: {
    run_id?: string | null; plan_id?: string | null; thread_id?: string | null;
    platform?: string | null; keyword?: string | null; query?: string | null;
    sort_by?: string; sort_order?: 'asc' | 'desc'; page?: number; page_size?: number;
  }): { items: ContentRecord[]; total: number; page: number; page_size: number; pages: number } {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.page_size || 20, 1000000));
    const sortBy = ['engagement', 'published_at', 'likes', 'comments', 'views'].includes(params.sort_by || '')
      ? params.sort_by as keyof ContentRecord : 'engagement';
    const direction = params.sort_order === 'asc' ? 1 : -1;
    const rows = this.loadContentRows(params).sort((a, b) => (Number(a[sortBy]) - Number(b[sortBy])) * direction);
    const total = rows.length;
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total, page, page_size: pageSize, pages: Math.ceil(total / pageSize),
    };
  }

  summary(runId?: string | null, platform?: string | null, keyword?: string | null, planId?: string | null, threadId?: string | null): any {
    const selected = this.loadContentRows({
      run_id: runId, plan_id: planId, thread_id: threadId, platform, keyword,
    });
    const all = this.loadContentRows({ run_id: runId, plan_id: planId, thread_id: threadId });
    const aggregate = (items: ContentRecord[]) => ({
      content_count: items.length,
      contents: items.length,
      creator_count: new Set(items.map((item) => item.creator_id || item.creator_name).filter(Boolean)).size,
      likes: items.reduce((sum, item) => sum + item.likes, 0),
      saves: items.reduce((sum, item) => sum + item.saves, 0),
      comments: items.reduce((sum, item) => sum + item.comments, 0),
      shares: items.reduce((sum, item) => sum + item.shares, 0),
      views: items.reduce((sum, item) => sum + item.views, 0),
      engagement: items.reduce((sum, item) => sum + item.engagement, 0),
    });
    const group = (key: 'keyword' | 'platform') => [...new Set(selected.map((item) => item[key]))]
      .map((value) => ({ [key]: value, ...(key === 'platform' ? { platform_label: PLATFORM_LABELS[value] || value } : {}), ...aggregate(selected.filter((item) => item[key] === value)) }));
    return {
      totals: aggregate(selected),
      by_keyword: group('keyword'),
      by_platform: group('platform'),
      filters: {
        platforms: [...new Set(all.map((item) => item.platform))].map((value) => [value, PLATFORM_LABELS[value] || value]),
        keywords: [...new Set(all.map((item) => item.keyword))],
      },
    };
  }

  queryComments(params: {
    run_id?: string | null; plan_id?: string | null; thread_id?: string | null;
    platform?: string | null; content_id?: string | null; level?: number | null;
    query?: string | null; page?: number; page_size?: number;
  }): { items: CommentRecord[]; total: number; page: number; page_size: number; pages: number } {
    const where = ["d.kind='comment'"];
    const values: any[] = [];
    if (params.run_id && params.run_id !== 'all') { where.push('s.run_id=?'); values.push(params.run_id); }
    if (params.plan_id && params.plan_id !== 'all') { where.push('r.workflow_id=?'); values.push(params.plan_id); }
    if (params.thread_id && params.thread_id !== 'all') { where.push('r.thread_id=?'); values.push(params.thread_id); }
    if (params.platform && params.platform !== 'all') { where.push('s.source=?'); values.push(params.platform); }
    const rows = this.db.prepare(`
      SELECT d.*, s.source, s.source_item_id, s.raw_payload_json
      FROM document_sources s JOIN documents d ON d.document_id=s.document_id
      LEFT JOIN crawl_runs r ON r.run_id=s.run_id WHERE ${where.join(' AND ')}
    `).all(...values) as any[];
    let items = rows.map((row): CommentRecord => {
      const raw = parseJson(row.raw_payload_json);
      const parentCommentId = String(raw.parent_comment_id || '');
      const contentId = String(raw.note_id || raw.aweme_id || raw.video_id || raw.content_id || '');
      return {
        platform: row.source, platform_label: PLATFORM_LABELS[row.source] || row.source,
        content_id: contentId, comment_id: row.source_item_id || row.document_id,
        parent_comment_id: parentCommentId,
        level: parentCommentId && parentCommentId !== '0' ? 2 : 1,
        content: row.markdown || '', creator_id: String(raw.creator_hash || raw.creator_id || ''),
        creator_name: row.author || '', published_at: parseTimestamp(row.published_at),
        likes: metric(raw, ['like_count', 'comment_like_count']),
        sub_comment_count: metric(raw, ['sub_comment_count']),
      };
    });
    if (params.content_id) items = items.filter((item) => item.content_id === params.content_id);
    if (params.level) items = items.filter((item) => item.level === params.level);
    if (params.query) {
      const query = params.query.toLowerCase();
      items = items.filter((item) => `${item.content} ${item.creator_name}`.toLowerCase().includes(query));
    }
    items.sort((a, b) => b.published_at - a.published_at);
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(params.page_size || 20, 1000000));
    const total = items.length;
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total, page, page_size: pageSize, pages: Math.ceil(total / pageSize) };
  }

  queryCommentThreads(params: {
    platform: string; content_id: string; run_id?: string | null; plan_id?: string | null;
    thread_id?: string | null; page?: number; page_size?: number;
  }): any {
    const page = params.page || 1;
    const pageSize = params.page_size || 20;
    const comments = this.queryComments({ ...params, page: 1, page_size: 1000000 }).items;
    const roots = comments.filter((item) => item.level === 1);
    const rootIds = new Set(roots.map((item) => item.comment_id));
    const replies = comments.filter((item) => item.level === 2);
    const pageRoots = roots.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: pageRoots.map((root) => ({ ...root, replies: replies.filter((reply) => reply.parent_comment_id === root.comment_id) })),
      total: comments.length, root_total: roots.length,
      orphan_reply_count: replies.filter((reply) => !rootIds.has(reply.parent_comment_id)).length,
      orphan_replies: page === 1 ? replies.filter((reply) => !rootIds.has(reply.parent_comment_id)) : [],
      page, page_size: pageSize, pages: Math.ceil(roots.length / pageSize),
    };
  }

  listRuns(page = 1, pageSize = 20): any {
    const total = Number((this.db.prepare('SELECT COUNT(*) AS count FROM crawl_runs').get() as any).count);
    const items = this.db.prepare(`
      SELECT r.*, r.workflow_id AS plan_id, COALESCE(t.title, w.goal, r.task_title) AS task_title
      FROM crawl_runs r LEFT JOIN workflow_runs w ON w.workflow_id=r.workflow_id
      LEFT JOIN agent_threads t ON t.thread_id=r.thread_id
      ORDER BY r.started_at DESC LIMIT ? OFFSET ?
    `).all(pageSize, (page - 1) * pageSize);
    return { items, total, page, page_size: pageSize, pages: Math.ceil(total / pageSize) };
  }

  listTaskHierarchy(): any {
    const rows = this.db.prepare(`
      SELECT r.*, r.workflow_id AS plan_id, COALESCE(t.title, r.task_title) AS task_title,
             COALESCE(w.goal, r.task_title) AS round_title
      FROM crawl_runs r LEFT JOIN workflow_runs w ON w.workflow_id=r.workflow_id
      LEFT JOIN agent_threads t ON t.thread_id=r.thread_id ORDER BY r.started_at DESC
    `).all() as any[];
    const tasks = new Map<string, any>();
    for (const run of rows) {
      const threadId = run.thread_id || run.run_id;
      const workflowId = run.workflow_id || run.run_id;
      if (!tasks.has(threadId)) tasks.set(threadId, { thread_id: threadId, task_title: run.task_title, rounds: new Map() });
      const task = tasks.get(threadId);
      if (!task.rounds.has(workflowId)) task.rounds.set(workflowId, { plan_id: workflowId, round_title: run.round_title, runs: [] });
      task.rounds.get(workflowId).runs.push(run);
    }
    const items = [...tasks.values()].map((task) => ({ ...task, rounds: [...task.rounds.values()] }));
    return { items, total: items.length, round_total: items.reduce((sum, item) => sum + item.rounds.length, 0), run_total: rows.length };
  }

  storageSummary(): any {
    const count = (table: string) => Number((this.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as any).count);
    return {
      analytics_runs: count('crawl_runs'),
      analytics_records: count('documents'),
      log_records: count('crawl_run_logs'),
      raw_records: count('document_sources'),
    };
  }

  cleanupHistory(mode: 'failed_empty' | 'older_than_30_days' | 'all'): number {
    const predicate = mode === 'failed_empty'
      ? "status!='running' AND (status='failed' OR item_count=0)"
      : mode === 'older_than_30_days'
        ? "status!='running' AND started_at < datetime('now','-30 days')"
        : "status!='running'";
    const ids = this.db.prepare(`SELECT run_id FROM crawl_runs WHERE ${predicate}`).all() as Array<{ run_id: string }>;
    return this.deleteRuns(ids.map((item) => item.run_id));
  }

  private deleteScope(column: 'thread_id' | 'workflow_id', values: string[]): number {
    const ids = [...new Set(values.filter(Boolean))];
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    const running = Number((this.db.prepare(
      `SELECT COUNT(*) AS count FROM crawl_runs WHERE ${column} IN (${placeholders}) AND status='running'`,
    ).get(...ids) as any).count);
    if (running) throw new Error('请先停止所选任务中正在采集的执行');
    return this.db.prepare(`DELETE FROM crawl_runs WHERE ${column} IN (${placeholders})`).run(...ids).changes;
  }

  deleteThreads(ids: string[]): number { return this.deleteScope('thread_id', ids); }
  deletePlans(ids: string[]): number { return this.deleteScope('workflow_id', ids); }

  deleteRuns(runIds: string[]): number {
    const ids = [...new Set(runIds.filter(Boolean))];
    if (!ids.length) return 0;
    const all = ids.includes('all');
    const where = all ? "status!='running'" : `run_id IN (${ids.map(() => '?').join(',')})`;
    const params = all ? [] : ids;
    if (!all) {
      const running = Number((this.db.prepare(
        `SELECT COUNT(*) AS count FROM crawl_runs WHERE ${where} AND status='running'`,
      ).get(...params) as any).count);
      if (running) throw new Error('请先停止所选执行中的采集任务');
    }
    return this.db.prepare(`DELETE FROM crawl_runs WHERE ${where}`).run(...params).changes;
  }

  deleteRun(runId: string): boolean { return this.deleteRuns([runId]) > 0; }
}

export const analyticsRepository = new AnalyticsRepository();
