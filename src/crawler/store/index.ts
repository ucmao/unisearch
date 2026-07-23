import { getDb } from '../../database/connection';
import { parseMetric, parseTimestamp, analyticsRepository } from '../../database/repository';
import type { Database } from 'better-sqlite3';

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: 'Bilibili',
  wb: '微博',
  tieba: '贴吧',
  zhihu: '知乎',
  baidu: '百度',
  bing: '必应中国',
  so360: '360搜索',
  sogou: '搜狗搜索',
  media_parser: '综合解析',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  qwen: '通义千问',
  yuanbao: '腾讯元宝',
  nami: '纳米 AI',
  wenxin: '文心一言',
};

const AI_WEB_QA_URLS: Record<string, string> = {
  deepseek: 'https://chat.deepseek.com/',
  kimi: 'https://kimi.moonshot.cn/',
  doubao: 'https://www.doubao.com/chat/',
  qwen: 'https://www.qianwen.com/',
  yuanbao: 'https://yuanbao.tencent.com/',
  nami: 'https://www.n.cn/',
  wenxin: 'https://wenxin.baidu.com/',
};

// Normalized content schema helper
function normalizeAndIngest(platform: string, rawItem: Record<string, any>): void {
  const runId = process.env.UNISEARCH_RUN_ID;
  if (!runId) return;

  let contentId = '';
  let title = '';
  let description = '';
  let creatorName = '';
  let creatorId = '';
  let keyword = rawItem.source_keyword || '未标记关键词';
  let coverUrl = '';
  let contentUrl = '';
  let publishedAt = 0;
  let contentType = 'content';

  let likes = 0;
  let saves = 0;
  let comments = 0;
  let shares = 0;
  let views = 0;

  if (platform === 'xhs') {
    contentId = rawItem.note_id || '';
    title = rawItem.title || rawItem.desc?.slice(0, 255) || '';
    description = rawItem.desc || '';
    creatorName = rawItem.nickname || '';
    creatorId = rawItem.creator_hash || '';
    coverUrl = rawItem.image_list?.split(',')[0] || '';
    contentUrl = rawItem.note_url || '';
    publishedAt = parseTimestamp(rawItem.time);
    contentType = rawItem.type || 'content';
    likes = parseMetric(rawItem.liked_count);
    saves = parseMetric(rawItem.collected_count);
    comments = parseMetric(rawItem.comment_count);
    shares = parseMetric(rawItem.share_count);
  } else if (platform === 'dy') {
    contentId = rawItem.aweme_id || '';
    title = rawItem.title || rawItem.desc?.slice(0, 255) || '';
    description = rawItem.desc || '';
    creatorName = rawItem.nickname || '';
    creatorId = rawItem.creator_hash || '';
    coverUrl = rawItem.cover_url || '';
    contentUrl = rawItem.aweme_url || '';
    publishedAt = parseTimestamp(rawItem.create_time);
    contentType = rawItem.aweme_type || 'content';
    likes = parseMetric(rawItem.liked_count);
    comments = parseMetric(rawItem.comment_count);
    shares = parseMetric(rawItem.share_count);
    saves = parseMetric(rawItem.collected_count);
  } else if (platform === 'bili') {
    contentId = rawItem.video_id || '';
    title = rawItem.title || '';
    description = rawItem.desc || '';
    creatorName = rawItem.nickname || '';
    creatorId = rawItem.creator_hash || '';
    coverUrl = rawItem.video_cover_url || '';
    contentUrl = rawItem.video_url || '';
    publishedAt = parseTimestamp(rawItem.create_time);
    contentType = rawItem.video_type || 'content';
    likes = parseMetric(rawItem.liked_count);
    comments = parseMetric(rawItem.video_comment);
    shares = parseMetric(rawItem.video_share_count);
    saves = parseMetric(rawItem.video_favorite_count);
    views = parseMetric(rawItem.video_play_count);
  } else if (platform === 'ks') {
    contentId = rawItem.video_id || '';
    title = rawItem.title || '';
    description = rawItem.desc || '';
    creatorName = rawItem.nickname || '';
    creatorId = rawItem.creator_hash || '';
    coverUrl = rawItem.video_cover_url || '';
    contentUrl = rawItem.video_url || '';
    publishedAt = parseTimestamp(rawItem.create_time);
    contentType = rawItem.video_type || 'content';
    likes = parseMetric(rawItem.liked_count);
    views = parseMetric(rawItem.viewd_count);
    comments = parseMetric(rawItem.comment_count);
  } else if (platform === 'wb') {
    contentId = rawItem.note_id || '';
    title = rawItem.content?.slice(0, 100) || '';
    description = rawItem.content || '';
    creatorName = rawItem.nickname || '';
    creatorId = rawItem.creator_hash || '';
    contentUrl = rawItem.note_url || '';
    publishedAt = parseTimestamp(rawItem.create_time);
    likes = parseMetric(rawItem.liked_count);
    comments = parseMetric(rawItem.comments_count);
    shares = parseMetric(rawItem.shared_count);
  } else if (platform === 'tieba') {
    contentId = rawItem.note_id || '';
    title = rawItem.title || '';
    description = rawItem.desc || '';
    creatorName = rawItem.user_nickname || '';
    creatorId = rawItem.creator_hash || '';
    contentUrl = rawItem.note_url || '';
    comments = parseMetric(rawItem.total_replay_num);
  } else if (platform === 'zhihu') {
    contentId = rawItem.content_id || '';
    title = rawItem.title || '';
    description = rawItem.desc || rawItem.content_text || '';
    creatorName = rawItem.user_nickname || '';
    creatorId = rawItem.creator_hash || '';
    contentUrl = rawItem.content_url || '';
    contentType = rawItem.content_type || 'content';
    likes = parseMetric(rawItem.voteup_count);
    comments = parseMetric(rawItem.comment_count);
  } else if (['baidu', 'bing', 'so360', 'sogou'].includes(platform)) {
    contentId = rawItem.real_url || rawItem.url || '';
    title = rawItem.title || '';
    description = rawItem.snippet || '';
    creatorName = rawItem.publisher || PLATFORM_LABELS[platform] || platform;
    creatorId = rawItem.publisher || '';
    contentUrl = rawItem.real_url || rawItem.url || '';
    coverUrl = Array.isArray(rawItem.images) ? (rawItem.images[0] || '') : (rawItem.images?.split(',')[0] || '');
    publishedAt = parseTimestamp(rawItem.publish_time);
    contentType = 'web_page';
  } else if (Object.hasOwn(AI_WEB_QA_URLS, platform)) {
    contentId = rawItem.id || rawItem.url || String(Date.now());
    title = rawItem.title || rawItem.question || '';
    description = rawItem.reasoning_content
      ? `【思考过程】:\n${rawItem.reasoning_content}\n\n【回答正文】:\n${rawItem.answer || rawItem.snippet || ''}`
      : (rawItem.answer || rawItem.snippet || '');
    creatorName = PLATFORM_LABELS[platform] || platform;
    creatorId = platform;
    contentUrl = rawItem.url || AI_WEB_QA_URLS[platform];
    publishedAt = parseTimestamp(rawItem.time || Date.now());
    contentType = 'ai_qa';
  } else if (platform === 'media_parser') {
    contentId = rawItem.video_id || String(Date.now());
    title = rawItem.title || '';
    description = rawItem.title || '';
    creatorName = rawItem.author?.nickname || rawItem.nickname || '';
    creatorId = rawItem.author?.author_id || rawItem.creator_hash || '';
    coverUrl = rawItem.cover_url || (Array.isArray(rawItem.images) ? rawItem.images[0] : '') || '';
    contentUrl = rawItem.video_url || rawItem.source_keyword || '';
    contentType = rawItem.images && rawItem.images.length > 0 && !rawItem.video_url ? 'image' : 'video';
  }

  const normalized = {
    platform,
    platform_label: PLATFORM_LABELS[platform] || platform,
    content_id: contentId,
    content_type: contentType,
    keyword,
    title,
    description,
    creator_id: creatorId,
    creator_name: creatorName,
    cover_url: coverUrl,
    content_url: contentUrl,
    published_at: publishedAt,
    likes,
    saves,
    comments,
    shares,
    views,
    engagement: likes + saves + comments + shares,
    source_file: `sqlite:db_store`,
    source_metadata: JSON.stringify(rawItem),
  };

  analyticsRepository.ingestContents(runId, [normalized]);
}

export class DatabaseStore {
  private get db(): Database {
    return getDb();
  }

  // XiaoHongShu Note
  public async storeXhsNote(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO xhs_note (
        creator_hash, nickname, add_ts, last_modify_ts, note_id, type, title, desc,
        video_url, time, last_update_time, liked_count, collected_count, comment_count,
        share_count, image_list, tag_list, note_url, source_keyword, xsec_token
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(note_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        liked_count = excluded.liked_count,
        collected_count = excluded.collected_count,
        comment_count = excluded.comment_count,
        share_count = excluded.share_count,
        last_update_time = excluded.last_update_time
    `);

    stmt.run(
      item.creator_hash || '',
      item.nickname || '',
      addTs,
      lastModifyTs,
      item.note_id || '',
      item.type || 'content',
      item.title || '',
      item.desc || '',
      item.video_url || '',
      item.time || 0,
      item.last_update_time || 0,
      String(item.liked_count || 0),
      String(item.collected_count || 0),
      String(item.comment_count || 0),
      String(item.share_count || 0),
      item.image_list || '',
      item.tag_list || '',
      item.note_url || '',
      item.source_keyword || '',
      item.xsec_token || ''
    );

    // Ingest content record in real-time
    normalizeAndIngest('xhs', item);
  }

  public async storeXhsComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO xhs_note_comment (
        comment_id, create_time, note_id, content, creator_hash, nickname,
        sub_comment_count, pictures, parent_comment_id, add_ts, last_modify_ts, like_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        like_count = excluded.like_count,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.create_time || 0,
      item.note_id || '',
      item.content || '',
      item.creator_hash || '',
      item.nickname || '',
      item.sub_comment_count || 0,
      item.pictures || '',
      item.parent_comment_id || '',
      addTs,
      lastModifyTs,
      String(item.like_count || 0)
    );
  }

  // Douyin Aweme
  public async storeDouyinAweme(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO douyin_aweme (
        creator_hash, nickname, add_ts, last_modify_ts, aweme_id, aweme_type, title, desc,
        create_time, liked_count, comment_count, share_count, collected_count, aweme_url,
        cover_url, video_download_url, music_download_url, note_download_url, source_keyword
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(aweme_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        liked_count = excluded.liked_count,
        comment_count = excluded.comment_count,
        share_count = excluded.share_count,
        collected_count = excluded.collected_count
    `);

    stmt.run(
      item.creator_hash || '',
      item.nickname || '',
      addTs,
      lastModifyTs,
      item.aweme_id || '',
      item.aweme_type || 'content',
      item.title || '',
      item.desc || '',
      item.create_time || 0,
      String(item.liked_count || 0),
      String(item.comment_count || 0),
      String(item.share_count || 0),
      String(item.collected_count || 0),
      item.aweme_url || '',
      item.cover_url || '',
      item.video_download_url || '',
      item.music_download_url || '',
      item.note_download_url || '',
      item.source_keyword || ''
    );

    normalizeAndIngest('dy', item);
  }

  public async storeDouyinComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO douyin_aweme_comment (
        comment_id, aweme_id, content, create_time, creator_hash, nickname,
        sub_comment_count, parent_comment_id, add_ts, last_modify_ts, like_count, pictures
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        like_count = excluded.like_count,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.aweme_id || '',
      item.content || '',
      item.create_time || 0,
      item.creator_hash || '',
      item.nickname || '',
      item.sub_comment_count || 0,
      item.parent_comment_id || '',
      addTs,
      lastModifyTs,
      String(item.like_count || 0),
      item.pictures || ''
    );
  }

  // Bilibili Video
  public async storeBilibiliVideo(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO bilibili_video (
        video_id, video_url, creator_hash, nickname, liked_count, add_ts, last_modify_ts,
        video_type, title, desc, create_time, disliked_count, video_play_count,
        video_favorite_count, video_share_count, video_coin_count, video_danmaku,
        video_comment, video_cover_url, source_keyword
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(video_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        liked_count = excluded.liked_count,
        video_play_count = excluded.video_play_count,
        video_favorite_count = excluded.video_favorite_count,
        video_share_count = excluded.video_share_count,
        video_comment = excluded.video_comment
    `);

    stmt.run(
      item.video_id || '',
      item.video_url || '',
      item.creator_hash || '',
      item.nickname || '',
      item.liked_count || 0,
      addTs,
      lastModifyTs,
      item.video_type || 'content',
      item.title || '',
      item.desc || '',
      item.create_time || 0,
      item.disliked_count || '0',
      item.video_play_count || '0',
      item.video_favorite_count || '0',
      item.video_share_count || '0',
      item.video_coin_count || '0',
      item.video_danmaku || '0',
      item.video_comment || '0',
      item.video_cover_url || '',
      item.source_keyword || ''
    );

    normalizeAndIngest('bili', item);
  }

  public async storeBilibiliComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO bilibili_video_comment (
        comment_id, video_id, content, create_time, creator_hash, nickname,
        sub_comment_count, parent_comment_id, add_ts, last_modify_ts, like_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        like_count = excluded.like_count,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.video_id || '',
      item.content || '',
      item.create_time || 0,
      item.creator_hash || '',
      item.nickname || '',
      item.sub_comment_count || '0',
      item.parent_comment_id || '',
      addTs,
      lastModifyTs,
      item.like_count || '0'
    );
  }

  // Kuaishou Video
  public async storeKuaishouVideo(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO kuaishou_video (
        creator_hash, nickname, add_ts, last_modify_ts, video_id, video_type, title, desc,
        create_time, liked_count, viewd_count, video_url, video_cover_url, video_play_url, source_keyword
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(video_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        liked_count = excluded.liked_count,
        viewd_count = excluded.viewd_count
    `);

    stmt.run(
      item.creator_hash || '',
      item.nickname || '',
      addTs,
      lastModifyTs,
      item.video_id || '',
      item.video_type || 'content',
      item.title || '',
      item.desc || '',
      item.create_time || 0,
      item.liked_count || '0',
      item.viewd_count || '0',
      item.video_url || '',
      item.video_cover_url || '',
      item.video_play_url || '',
      item.source_keyword || ''
    );

    normalizeAndIngest('ks', item);
  }

  public async storeKuaishouComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO kuaishou_video_comment (
        comment_id, video_id, content, create_time, creator_hash, nickname,
        sub_comment_count, add_ts, last_modify_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.video_id || '',
      item.content || '',
      item.create_time || 0,
      item.creator_hash || '',
      item.nickname || '',
      item.sub_comment_count || '0',
      addTs,
      lastModifyTs
    );
  }

  // Weibo Note
  public async storeWeiboNote(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO weibo_note (
        creator_hash, nickname, add_ts, last_modify_ts, note_id, content, create_time,
        create_date_time, liked_count, comments_count, shared_count, note_url, source_keyword
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(note_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        liked_count = excluded.liked_count,
        comments_count = excluded.comments_count,
        shared_count = excluded.shared_count
    `);

    stmt.run(
      item.creator_hash || '',
      item.nickname || '',
      addTs,
      lastModifyTs,
      item.note_id || '',
      item.content || '',
      item.create_time || 0,
      item.create_date_time || '',
      item.liked_count || '0',
      item.comments_count || '0',
      item.shared_count || '0',
      item.note_url || '',
      item.source_keyword || ''
    );

    normalizeAndIngest('wb', item);
  }

  public async storeWeiboComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO weibo_note_comment (
        comment_id, note_id, content, create_time, create_date_time, creator_hash, nickname,
        comment_like_count, sub_comment_count, parent_comment_id, add_ts, last_modify_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        comment_like_count = excluded.comment_like_count,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.note_id || '',
      item.content || '',
      item.create_time || 0,
      item.create_date_time || '',
      item.creator_hash || '',
      item.nickname || '',
      item.comment_like_count || '0',
      item.sub_comment_count || '0',
      item.parent_comment_id || '',
      addTs,
      lastModifyTs
    );
  }

  // Tieba Note
  public async storeTiebaNote(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO tieba_note (
        note_id, title, desc, note_url, publish_time, creator_hash, user_nickname,
        tieba_id, tieba_name, tieba_link, total_replay_num, total_replay_page,
        add_ts, last_modify_ts, source_keyword
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?
      )
      ON CONFLICT(note_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        total_replay_num = excluded.total_replay_num,
        total_replay_page = excluded.total_replay_page
    `);

    stmt.run(
      item.note_id || '',
      item.title || '',
      item.desc || '',
      item.note_url || '',
      item.publish_time || '',
      item.creator_hash || '',
      item.user_nickname || '',
      item.tieba_id || '',
      item.tieba_name || '',
      item.tieba_link || '',
      item.total_replay_num || 0,
      item.total_replay_page || 0,
      addTs,
      lastModifyTs,
      item.source_keyword || ''
    );

    normalizeAndIngest('tieba', item);
  }

  public async storeTiebaComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO tieba_comment (
        comment_id, parent_comment_id, content, creator_hash, user_nickname,
        tieba_id, tieba_name, tieba_link, publish_time, sub_comment_count,
        note_id, note_url, add_ts, last_modify_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.parent_comment_id || '',
      item.content || '',
      item.creator_hash || '',
      item.user_nickname || '',
      item.tieba_id || '',
      item.tieba_name || '',
      item.tieba_link || '',
      item.publish_time || '',
      item.sub_comment_count || 0,
      item.note_id || '',
      item.note_url || '',
      addTs,
      lastModifyTs
    );
  }

  // Zhihu Content
  public async storeZhihuContent(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO zhihu_content (
        content_id, content_type, content_text, content_url, question_id, title, desc,
        created_time, updated_time, voteup_count, comment_count, source_keyword,
        creator_hash, user_nickname, add_ts, last_modify_ts
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
      ON CONFLICT(content_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        voteup_count = excluded.voteup_count,
        comment_count = excluded.comment_count,
        updated_time = excluded.updated_time
    `);

    stmt.run(
      item.content_id || '',
      item.content_type || 'content',
      item.content_text || '',
      item.content_url || '',
      item.question_id || '',
      item.title || '',
      item.desc || '',
      item.created_time || '',
      item.updated_time || '',
      item.voteup_count || 0,
      item.comment_count || 0,
      item.source_keyword || '',
      item.creator_hash || '',
      item.user_nickname || '',
      addTs,
      lastModifyTs
    );

    normalizeAndIngest('zhihu', item);
  }

  public async storeZhihuComment(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;

    const stmt = this.db.prepare(`
      INSERT INTO zhihu_comment (
        comment_id, parent_comment_id, content, publish_time, sub_comment_count,
        like_count, dislike_count, content_id, content_type, creator_hash,
        user_nickname, add_ts, last_modify_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comment_id) DO UPDATE SET
        last_modify_ts = excluded.last_modify_ts,
        like_count = excluded.like_count,
        dislike_count = excluded.dislike_count,
        sub_comment_count = excluded.sub_comment_count
    `);

    stmt.run(
      item.comment_id || '',
      item.parent_comment_id || '',
      item.content || '',
      item.publish_time || '',
      item.sub_comment_count || 0,
      item.like_count || 0,
      item.dislike_count || 0,
      item.content_id || '',
      item.content_type || 'content',
      item.creator_hash || '',
      item.user_nickname || '',
      addTs,
      lastModifyTs
    );
  }

  public async storeSearchEngineResult(item: Record<string, any>): Promise<void> {
    const addTs = Math.floor(Date.now() / 1000);
    const lastModifyTs = addTs;
    const imagesStr = Array.isArray(item.images) ? item.images.join(',') : (item.images || '');

    const stmt = this.db.prepare(`
      INSERT INTO search_engine_result (
        search_engine, title, url, real_url, snippet, publisher,
        publish_time, images, search_rank, source_keyword, add_ts, last_modify_ts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      item.search_engine || item.engine || '',
      item.title || '',
      item.url || '',
      item.real_url || item.url || '',
      item.snippet || '',
      item.publisher || '',
      item.publish_time || item.time || '',
      imagesStr,
      item.search_rank || item.rank || 0,
      item.source_keyword || '',
      addTs,
      lastModifyTs
    );

    normalizeAndIngest(item.search_engine || item.engine, item);
  }

  public async storeMediaParsedResult(item: Record<string, any>): Promise<void> {
    const livePhotoVideo = Array.isArray(item.live_photos) && item.live_photos[0]?.live_photo_url
      ? item.live_photos[0].live_photo_url
      : '';
    const finalVideoUrl = item.video_url || livePhotoVideo || '';
    const isImage = Array.isArray(item.images) && item.images.length > 0 && !finalVideoUrl;

    if (isImage) {
      await this.storeXhsNote({
        note_id: item.video_id || String(Date.now()),
        type: 'normal',
        title: item.title || '',
        desc: item.title || '',
        nickname: item.author?.nickname || '无名作者',
        creator_hash: item.author?.author_id || '',
        cover_url: item.cover_url || (item.images?.[0] || ''),
        video_url: '',
        image_list: item.images?.join(',') || '',
        note_url: item.source_keyword || '',
        liked_count: 0,
        collected_count: 0,
        comment_count: 0,
        share_count: 0,
        source_keyword: item.source_keyword || '',
      });
    } else {
      await this.storeDouyinAweme({
        aweme_id: item.video_id || String(Date.now()),
        title: item.title || '',
        desc: item.title || '',
        nickname: item.author?.nickname || '无名作者',
        creator_hash: item.author?.author_id || '',
        cover_url: item.cover_url || '',
        aweme_url: item.source_keyword || '',
        video_url: finalVideoUrl,
        image_list: Array.isArray(item.images) ? item.images.join(',') : '',
        music_url: item.audio_url || '',
        liked_count: 0,
        comment_count: 0,
        collected_count: 0,
        share_count: 0,
        source_keyword: item.source_keyword || '',
      });
    }
    normalizeAndIngest('media_parser', {
      ...item,
      video_url: finalVideoUrl,
    });
  }

  public async storeDeepSeekResult(item: Record<string, any>): Promise<void> {
    const citationsStr = Array.isArray(item.citations)
      ? item.citations.map((c: any) => (typeof c === 'string' ? c : `${c.title || ''} (${c.url || ''})`)).join('\n')
      : String(item.citations || '');

    const snippetText = item.reasoning_content
      ? `【思考过程】:\n${item.reasoning_content}\n\n【回答正文】:\n${item.answer || item.desc || ''}`
      : (item.answer || item.desc || '');

    await this.storeSearchEngineResult({
      engine: 'deepseek',
      title: item.question || item.title || '',
      url: item.url || 'https://chat.deepseek.com/',
      real_url: item.url || 'https://chat.deepseek.com/',
      snippet: snippetText,
      publisher: 'DeepSeek',
      images: citationsStr,
      source_keyword: item.source_keyword || item.question || '',
      search_rank: 1,
      publish_time: item.time || '',
    });
  }

  public async storeKimiResult(item: Record<string, any>): Promise<void> {
    const citationsStr = Array.isArray(item.citations)
      ? item.citations.map((c: any) => (typeof c === 'string' ? c : `${c.title || ''} (${c.url || ''})`)).join('\n')
      : String(item.citations || '');

    const snippetText = item.reasoning_content
      ? `【思考过程】:\n${item.reasoning_content}\n\n【回答正文】:\n${item.answer || item.desc || ''}`
      : (item.answer || item.desc || '');

    await this.storeSearchEngineResult({
      engine: 'kimi',
      title: item.question || item.title || '',
      url: item.url || 'https://kimi.moonshot.cn/',
      real_url: item.url || 'https://kimi.moonshot.cn/',
      snippet: snippetText,
      publisher: 'Kimi',
      images: citationsStr,
      source_keyword: item.source_keyword || item.question || '',
      search_rank: 1,
      publish_time: item.time || '',
    });
  }

  public async storeDoubaoResult(item: Record<string, any>): Promise<void> {
    const citations = Array.isArray(item.citations)
      ? item.citations.map((citation: any) => typeof citation === 'string' ? citation : `${citation.title || ''} (${citation.url || ''})`).join('\n')
      : String(item.citations || '');
    const snippet = item.reasoning_content
      ? `【思考过程】：\n${item.reasoning_content}\n\n【回答正文】：\n${item.answer || item.desc || ''}`
      : (item.answer || item.desc || '');
    await this.storeSearchEngineResult({ engine: 'doubao', title: item.question || item.title || '',
      url: item.url || 'https://www.doubao.com/chat/', real_url: item.url || 'https://www.doubao.com/chat/',
      snippet, publisher: '豆包', images: citations, source_keyword: item.source_keyword || item.question || '',
      search_rank: 1, publish_time: item.time || '' });
  }

  public async storeQwenResult(item: Record<string, any>): Promise<void> {
    const citations = Array.isArray(item.citations)
      ? item.citations.map((citation: any) => typeof citation === 'string' ? citation : `${citation.title || ''} (${citation.url || ''})`).join('\n')
      : String(item.citations || '');
    const snippet = item.reasoning_content
      ? `【思考过程】：\n${item.reasoning_content}\n\n【回答正文】：\n${item.answer || item.desc || ''}`
      : (item.answer || item.desc || '');
    await this.storeSearchEngineResult({ engine: 'qwen', title: item.question || item.title || '',
      url: item.url || 'https://www.qianwen.com/', real_url: item.url || 'https://www.qianwen.com/',
      snippet, publisher: '通义千问', images: citations, source_keyword: item.source_keyword || item.question || '',
      search_rank: 1, publish_time: item.time || '' });
  }

  public async storeAiWebQaResult(platform: 'yuanbao' | 'nami' | 'wenxin', item: Record<string, any>): Promise<void> {
    const citations = Array.isArray(item.citations)
      ? item.citations.map((citation: any) => typeof citation === 'string' ? citation : `${citation.title || ''} (${citation.url || ''})`).join('\n')
      : String(item.citations || '');
    const snippet = item.reasoning_content
      ? `【思考过程】：\n${item.reasoning_content}\n\n【回答正文】：\n${item.answer || item.desc || ''}`
      : (item.answer || item.desc || '');
    await this.storeSearchEngineResult({
      engine: platform,
      title: item.question || item.title || '',
      url: item.url || AI_WEB_QA_URLS[platform],
      real_url: item.url || AI_WEB_QA_URLS[platform],
      snippet,
      publisher: PLATFORM_LABELS[platform],
      images: citations,
      source_keyword: item.source_keyword || item.question || '',
      search_rank: 1,
      publish_time: item.time || '',
    });
  }
}

export const dbStore = new DatabaseStore();
export default dbStore;
