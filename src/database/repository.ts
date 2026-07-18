import type { Database } from 'better-sqlite3';
import { getDb } from './connection';
import crypto from 'crypto';

export interface RunConfig {
  platform: string;
  keywords: string;
  crawler_type: string;
  login_type: string;
  start_page?: number;
  enable_comments?: boolean;
  enable_sub_comments?: boolean;
  cookies?: string;
  headless?: boolean;
  loop_execution?: boolean;
  [key: string]: any;
}

export interface ContentRecord {
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
  ingested_at?: string;
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
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: 'Bilibili',
  wb: '微博',
  tieba: '贴吧',
  zhihu: '知乎',
};

const SQLITE_CONTENT_TABLES: Record<string, string> = {
  xhs: 'xhs_note',
  dy: 'douyin_aweme',
  ks: 'kuaishou_video',
  bili: 'bilibili_video',
  wb: 'weibo_note',
  tieba: 'tieba_note',
  zhihu: 'zhihu_content',
};

const SQLITE_COMMENT_TABLES: Record<string, [string, string]> = {
  xhs: ['xhs_note_comment', 'note_id'],
  dy: ['douyin_aweme_comment', 'aweme_id'],
  ks: ['kuaishou_video_comment', 'video_id'],
  bili: ['bilibili_video_comment', 'video_id'],
  wb: ['weibo_note_comment', 'note_id'],
  tieba: ['tieba_comment', 'note_id'],
  zhihu: ['zhihu_comment', 'content_id'],
};

// Convert metrics (e.g., "2.4万", "1,200") to integer
export function parseMetric(value: any): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  if (typeof value === 'number') {
    return Math.max(0, Math.floor(value));
  }

  const text = String(value).trim().toLowerCase().replace(/,/g, '').replace(/\+/g, '');
  const multipliers: Record<string, number> = {
    '万': 10000,
    'w': 10000,
    '千': 1000,
    'k': 1000,
  };

  const lastChar = text.charAt(text.length - 1);
  let multiplier = 1;
  let numericText = text;

  if (lastChar in multipliers) {
    multiplier = multipliers[lastChar];
    numericText = text.slice(0, -1);
  }

  try {
    const val = parseFloat(numericText);
    return isNaN(val) ? 0 : Math.max(0, Math.floor(val * multiplier));
  } catch {
    return 0;
  }
}

// Convert mixed timestamps to seconds
export function parseTimestamp(value: any): number {
  if (value === null || value === undefined || value === '') {
    return 0;
  }
  let ts = 0;
  if (typeof value === 'number') {
    ts = Math.floor(value);
  } else {
    const text = String(value).trim();
    const parsed = parseFloat(text);
    if (!isNaN(parsed)) {
      ts = Math.floor(parsed);
    } else {
      try {
        ts = Math.floor(Date.parse(text) / 1000);
      } catch {
        return 0;
      }
    }
  }
  
  // Convert milliseconds to seconds if needed
  if (ts > 10000000000) {
    ts = Math.floor(ts / 1000);
  }
  return ts;
}

export class AnalyticsRepository {
  private get db(): Database {
    return getDb();
  }

  public createRun(config: RunConfig, taskName = ''): string {
    const runId = crypto.randomUUID().replace(/-/g, '');
    const platform = config.platform || '';
    const keywords = config.keywords || '';
    const platformLabel = PLATFORM_LABELS[platform] || platform;
    const displayName = taskName.trim() || `${platformLabel} · ${keywords || config.crawler_type || '任务'}`;

    const configJson = JSON.stringify(config);
    const startedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO crawl_runs 
      (run_id, task_name, platform, crawler_type, keywords, save_option, status, started_at, config_json)
      VALUES (?, ?, ?, ?, ?, 'sqlite', 'running', ?, ?)
    `);
    
    stmt.run(runId, displayName, platform, config.crawler_type || '', keywords, startedAt, configJson);
    return runId;
  }

  public finishRun(
    runId: string,
    status: string,
    exitCode: number | null,
    contents: any[],
    errorMessage = ''
  ): void {
    // Ingest the crawled content records first
    this.ingestContents(runId, contents);

    const finishedAt = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE crawl_runs
      SET status = ?, finished_at = ?, exit_code = ?, item_count = ?, error_message = ?
      WHERE run_id = ?
    `);

    stmt.run(status, finishedAt, exitCode, contents.length, errorMessage || null, runId);
  }

  public ingestContents(runId: string, contents: any[]): number {
    if (!contents || contents.length === 0) {
      return 0;
    }

    const ingestedAt = new Date().toISOString();
    const insertStmt = this.db.prepare(`
      INSERT INTO content_records (
        run_id, platform, platform_label, content_id, content_type, keyword, title, description,
        creator_id, creator_name, cover_url, content_url, published_at, likes, saves,
        comments, shares, views, engagement, source_file, ingested_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(run_id, platform, content_id, keyword) DO UPDATE SET
        platform_label = excluded.platform_label,
        content_type = excluded.content_type,
        title = excluded.title,
        description = excluded.description,
        creator_id = excluded.creator_id,
        creator_name = excluded.creator_name,
        cover_url = excluded.cover_url,
        content_url = excluded.content_url,
        published_at = excluded.published_at,
        likes = excluded.likes,
        saves = excluded.saves,
        comments = excluded.comments,
        shares = excluded.shares,
        views = excluded.views,
        engagement = excluded.engagement,
        source_file = excluded.source_file,
        ingested_at = excluded.ingested_at
    `);

    const transaction = this.db.transaction((items: any[]) => {
      for (const item of items) {
        insertStmt.run(
          runId,
          item.platform || '',
          item.platform_label || PLATFORM_LABELS[item.platform] || item.platform || '',
          item.content_id || '',
          item.content_type || 'content',
          item.keyword || '未标记关键词',
          item.title || '',
          item.description || '',
          item.creator_id || '',
          item.creator_name || '',
          item.cover_url || '',
          item.content_url || '',
          item.published_at || 0,
          item.likes || 0,
          item.saves || 0,
          item.comments || 0,
          item.shares || 0,
          item.views || 0,
          item.engagement || 0,
          item.source_file || '',
          ingestedAt
        );
      }
    });

    transaction(contents);
    return contents.length;
  }

  private getScopeSql(runId?: string | null): { sql: string; params: any[] } {
    if (runId && runId !== 'all') {
      return {
        sql: 'SELECT * FROM content_records WHERE run_id = ?',
        params: [runId],
      };
    }
    return {
      sql: `
        SELECT c.* FROM content_records c
        INNER JOIN (
          SELECT MAX(id) AS id FROM content_records GROUP BY platform, content_id, keyword
        ) latest ON latest.id = c.id
      `,
      params: [],
    };
  }

  private getFiltersSql(
    platform?: string | null,
    keyword?: string | null,
    query?: string | null
  ): { sql: string; params: any[] } {
    const clauses: string[] = [];
    const params: any[] = [];

    if (platform && platform !== 'all') {
      clauses.push('platform = ?');
      params.push(platform);
    }
    if (keyword && keyword !== 'all') {
      clauses.push('keyword = ?');
      params.push(keyword);
    }
    if (query && query.trim() !== '') {
      clauses.push(
        '(title LIKE ? OR description LIKE ? OR creator_name LIKE ? OR creator_id LIKE ? OR content_id LIKE ?)'
      );
      const pattern = `%${query.trim()}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }

    return {
      sql: clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '',
      params,
    };
  }

  public queryContents(params: {
    run_id?: string | null;
    platform?: string | null;
    keyword?: string | null;
    query?: string | null;
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
    page?: number;
    page_size?: number;
  }): { items: any[]; total: number; page: number; page_size: number; pages: number } {
    const runId = params.run_id || null;
    const platform = params.platform || null;
    const keyword = params.keyword || null;
    const query = params.query || null;
    const sortBy = params.sort_by || 'engagement';
    const sortOrder = params.sort_order || 'desc';
    const page = params.page || 1;
    const pageSize = params.page_size || 20;

    const SORTABLE_FIELDS = new Set([
      'engagement',
      'likes',
      'saves',
      'comments',
      'shares',
      'views',
      'published_at',
      'title',
    ]);
    if (!SORTABLE_FIELDS.has(sortBy)) {
      throw new Error(`Unsupported sort field: ${sortBy}`);
    }

    const { sql: scopeSql, params: scopeParams } = this.getScopeSql(runId);
    const { sql: filterSql, params: filterParams } = this.getFiltersSql(platform, keyword, query);

    const countSql = `SELECT COUNT(*) AS total FROM (${scopeSql}) scoped${filterSql}`;
    const totalRow = this.db.prepare(countSql).get(...scopeParams, ...filterParams) as { total: number };
    const total = totalRow ? totalRow.total : 0;

    const direction = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const collation = sortBy === 'title' ? ' COLLATE NOCASE' : '';
    const offset = (page - 1) * pageSize;

    const querySql = `
      SELECT * FROM (${scopeSql}) scoped${filterSql}
      ORDER BY ${sortBy}${collation} ${direction}, id DESC
      LIMIT ? OFFSET ?
    `;

    const rows = this.db
      .prepare(querySql)
      .all(...scopeParams, ...filterParams, pageSize, offset);

    return {
      items: rows,
      total,
      page,
      page_size: pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  public summary(
    runId?: string | null,
    platform?: string | null,
    keyword?: string | null
  ): any {
    const { sql: scopeSql, params: scopeParams } = this.getScopeSql(runId);
    const { sql: platformFilterSql, params: platformParams } = this.getFiltersSql(platform, null, null);
    const { sql: selectedFilterSql, params: selectedParams } = this.getFiltersSql(platform, keyword, null);

    const selectedRows = this.db.prepare(`SELECT * FROM (${scopeSql}) scoped${selectedFilterSql}`).all(...scopeParams, ...selectedParams);
    const comparisonRows = this.db.prepare(`SELECT * FROM (${scopeSql}) scoped${platformFilterSql}`).all(...scopeParams, ...platformParams);
    const allRows = this.db.prepare(`SELECT * FROM (${scopeSql}) scoped`).all(...scopeParams);

    const aggregateGroup = (items: any[]) => {
      const creatorSet = new Set(items.map((i) => i.creator_id).filter(Boolean));
      return {
        content_count: items.length,
        creator_count: creatorSet.size,
        likes: items.reduce((sum, i) => sum + (i.likes || 0), 0),
        saves: items.reduce((sum, i) => sum + (i.saves || 0), 0),
        comments: items.reduce((sum, i) => sum + (i.comments || 0), 0),
        shares: items.reduce((sum, i) => sum + (i.shares || 0), 0),
        views: items.reduce((sum, i) => sum + (i.views || 0), 0),
        engagement: items.reduce((sum, i) => sum + (i.engagement || 0), 0),
      };
    };

    const keywordGroups: Record<string, any[]> = {};
    const platformGroups: Record<string, any[]> = {};

    for (const item of comparisonRows) {
      if (!keywordGroups[item.keyword]) keywordGroups[item.keyword] = [];
      keywordGroups[item.keyword].push(item);
    }

    for (const item of selectedRows) {
      if (!platformGroups[item.platform]) platformGroups[item.platform] = [];
      platformGroups[item.platform].push(item);
    }

    const byKeyword = Object.entries(keywordGroups).map(([name, items]) => ({
      keyword: name,
      ...aggregateGroup(items),
    }));
    byKeyword.sort((a, b) => b.engagement - a.engagement || b.content_count - a.content_count);

    const byPlatform = Object.entries(platformGroups).map(([name, items]) => ({
      platform: name,
      platform_label: PLATFORM_LABELS[name] || name,
      ...aggregateGroup(items),
    }));
    byPlatform.sort((a, b) => b.content_count - a.content_count);

    const allPlatforms = Array.from(new Set(allRows.map((i) => JSON.stringify([i.platform, i.platform_label]))))
      .map((str) => JSON.parse(str))
      .sort((a, b) => a[0].localeCompare(b[0]));

    const allKeywords = Array.from(new Set(comparisonRows.map((i) => i.keyword))).sort();

    return {
      totals: aggregateGroup(selectedRows),
      by_keyword: byKeyword,
      by_platform: byPlatform,
      filters: {
        platforms: allPlatforms,
        keywords: allKeywords,
      },
    };
  }

  public queryComments(params: {
    run_id?: string | null;
    platform?: string | null;
    content_id?: string | null;
    level?: number | null;
    query?: string | null;
    page?: number;
    page_size?: number;
  }): { items: CommentRecord[]; total: number; page: number; page_size: number; pages: number } {
    const runId = params.run_id || null;
    const platform = params.platform || null;
    const contentId = params.content_id || null;
    const level = params.level || null;
    const query = params.query || null;
    const page = params.page || 1;
    const pageSize = params.page_size || 20;

    let allowedContentIds: Set<string> | null = null;
    if (runId && runId !== 'all') {
      const allowed = this.db
        .prepare('SELECT DISTINCT platform, content_id FROM content_records WHERE run_id = ?')
        .all(runId) as { platform: string; content_id: string }[];
      allowedContentIds = new Set(allowed.map((r) => `${r.platform}:${r.content_id}`));
    }

    const queryText = query ? query.trim().toLowerCase() : '';
    const comments: CommentRecord[] = [];

    const platforms = platform && platform in SQLITE_COMMENT_TABLES ? [platform] : Object.keys(SQLITE_COMMENT_TABLES);
    
    // Check if table exists before querying
    const tablesInDb = new Set(
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map((r: any) => r.name)
    );

    for (const p of platforms) {
      const [table, contentKey] = SQLITE_COMMENT_TABLES[p];
      if (!tablesInDb.has(table)) {
        continue;
      }

      const rows = this.db.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows as any[]) {
        const rowContentId = String(row[contentKey] || '');
        if (allowedContentIds && !allowedContentIds.has(`${p}:${rowContentId}`)) {
          continue;
        }
        if (contentId && rowContentId !== contentId) {
          continue;
        }

        const parentId = String(row.parent_comment_id || '');
        const commentLevel = parentId && parentId !== '0' && parentId !== 'None' && parentId !== '' ? 2 : 1;
        if (level && commentLevel !== level) {
          continue;
        }

        const content = String(row.content || '');
        const creatorName = String(row.nickname || row.user_nickname || '');
        const creatorId = String(row.creator_hash || '');
        const commentId = String(row.comment_id || '');

        if (queryText) {
          const haystack = `${content} ${creatorName} ${creatorId} ${commentId} ${rowContentId}`.toLowerCase();
          if (!haystack.includes(queryText)) {
            continue;
          }
        }

        comments.push({
          platform: p,
          platform_label: PLATFORM_LABELS[p] || p,
          content_id: rowContentId,
          comment_id: commentId,
          parent_comment_id: parentId,
          level: commentLevel as 1 | 2,
          content,
          creator_id: creatorId,
          creator_name: creatorName,
          published_at: parseTimestamp(row.create_time || row.publish_time),
          likes: parseMetric(row.like_count || row.comment_like_count),
          sub_comment_count: parseMetric(row.sub_comment_count),
        });
      }
    }

    comments.sort((a, b) => b.published_at - a.published_at || b.comment_id.localeCompare(a.comment_id));
    
    const total = comments.length;
    const offset = (page - 1) * pageSize;
    const items = comments.slice(offset, offset + pageSize);

    return {
      items,
      total,
      page,
      page_size: pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  public queryCommentThreads(params: {
    platform: string;
    content_id: string;
    run_id?: string | null;
    page?: number;
    page_size?: number;
  }): {
    items: any[];
    total: number;
    root_total: number;
    orphan_reply_count: number;
    orphan_replies: any[];
    page: number;
    page_size: number;
    pages: number;
  } {
    const page = params.page || 1;
    const pageSize = params.page_size || 20;

    const result = this.queryComments({
      run_id: params.run_id,
      platform: params.platform,
      content_id: params.content_id,
      page: 1,
      page_size: 1000000,
    });

    const comments = result.items;
    const roots = comments.filter((c) => c.level === 1);
    roots.sort((a, b) => b.published_at - a.published_at || b.comment_id.localeCompare(a.comment_id));

    const repliesByParent: Record<string, any[]> = {};
    for (const c of comments) {
      if (c.level === 2) {
        if (!repliesByParent[c.parent_comment_id]) {
          repliesByParent[c.parent_comment_id] = [];
        }
        repliesByParent[c.parent_comment_id].push(c);
      }
    }

    for (const parentId in repliesByParent) {
      repliesByParent[parentId].sort((a, b) => a.published_at - b.published_at || a.comment_id.localeCompare(b.comment_id));
    }

    const rootTotal = roots.length;
    const offset = (page - 1) * pageSize;
    const paginatedRoots = roots.slice(offset, offset + pageSize);

    const threads = paginatedRoots.map((root) => ({
      ...root,
      replies: repliesByParent[root.comment_id] || [],
    }));

    const knownRootIds = new Set(roots.map((r) => r.comment_id));
    const orphanReplies = comments.filter((c) => c.level === 2 && !knownRootIds.has(c.parent_comment_id));

    return {
      items: threads,
      total: comments.length,
      root_total: rootTotal,
      orphan_reply_count: orphanReplies.length,
      orphan_replies: page === 1 ? orphanReplies : [],
      page,
      page_size: pageSize,
      pages: Math.ceil(rootTotal / pageSize),
    };
  }

  public listRuns(page = 1, pageSize = 20): { items: any[]; total: number; page: number; page_size: number; pages: number } {
    const totalRow = this.db.prepare('SELECT COUNT(*) AS total FROM crawl_runs').get() as { total: number };
    const total = totalRow ? totalRow.total : 0;
    
    const offset = (page - 1) * pageSize;
    const rows = this.db
      .prepare('SELECT * FROM crawl_runs ORDER BY started_at DESC LIMIT ? OFFSET ?')
      .all(pageSize, offset);

    return {
      items: rows,
      total,
      page,
      page_size: pageSize,
      pages: Math.ceil(total / pageSize),
    };
  }

  public deleteRun(runId: string): boolean {
    if (runId === 'all') {
      this.db.prepare("DELETE FROM crawl_runs WHERE status != 'running'").run();
      return true;
    }

    const row = this.db.prepare('SELECT status FROM crawl_runs WHERE run_id = ?').get(runId) as { status: string } | undefined;
    if (!row) {
      return false;
    }
    if (row.status === 'running') {
      throw new Error('A running task cannot be deleted');
    }

    this.db.prepare('DELETE FROM crawl_runs WHERE run_id = ?').run(runId);
    return true;
  }
}

export const analyticsRepository = new AnalyticsRepository();
