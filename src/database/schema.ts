import type { Database } from 'better-sqlite3';

export function initSchema(db: Database): void {
  db.exec(`
    -- Bilibili Video Table
    CREATE TABLE IF NOT EXISTS bilibili_video (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL UNIQUE,
      video_url TEXT NOT NULL,
      creator_hash TEXT,
      nickname TEXT,
      liked_count INTEGER,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      video_type TEXT,
      title TEXT,
      desc TEXT,
      create_time INTEGER,
      disliked_count TEXT,
      video_play_count TEXT,
      video_favorite_count TEXT,
      video_share_count TEXT,
      video_coin_count TEXT,
      video_danmaku TEXT,
      video_comment TEXT,
      video_cover_url TEXT,
      source_keyword TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_bili_vid ON bilibili_video(video_id);
    CREATE INDEX IF NOT EXISTS idx_bili_v_creator ON bilibili_video(creator_hash);
    CREATE INDEX IF NOT EXISTS idx_bili_v_ctime ON bilibili_video(create_time);

    -- Bilibili Comment Table
    CREATE TABLE IF NOT EXISTS bilibili_video_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      comment_id TEXT NOT NULL UNIQUE,
      video_id TEXT,
      content TEXT,
      create_time INTEGER,
      sub_comment_count TEXT,
      parent_comment_id TEXT,
      like_count TEXT DEFAULT '0'
    );
    CREATE INDEX IF NOT EXISTS idx_bili_c_cid ON bilibili_video_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_bili_c_vid ON bilibili_video_comment(video_id);
    CREATE INDEX IF NOT EXISTS idx_bili_c_creator ON bilibili_video_comment(creator_hash);

    -- Bilibili Up Dynamic Table
    CREATE TABLE IF NOT EXISTS bilibili_up_dynamic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dynamic_id TEXT NOT NULL UNIQUE,
      creator_hash TEXT,
      user_name TEXT,
      text TEXT,
      type TEXT,
      pub_ts INTEGER,
      total_comments INTEGER,
      total_forwards INTEGER,
      total_liked INTEGER,
      add_ts INTEGER,
      last_modify_ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bili_d_did ON bilibili_up_dynamic(dynamic_id);
    CREATE INDEX IF NOT EXISTS idx_bili_d_creator ON bilibili_up_dynamic(creator_hash);

    -- Douyin Aweme Table
    CREATE TABLE IF NOT EXISTS douyin_aweme (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      aweme_id TEXT NOT NULL UNIQUE,
      aweme_type TEXT,
      title TEXT,
      desc TEXT,
      create_time INTEGER,
      liked_count TEXT,
      comment_count TEXT,
      share_count TEXT,
      collected_count TEXT,
      aweme_url TEXT,
      cover_url TEXT,
      video_download_url TEXT,
      music_download_url TEXT,
      note_download_url TEXT,
      source_keyword TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_dy_a_aid ON douyin_aweme(aweme_id);
    CREATE INDEX IF NOT EXISTS idx_dy_a_creator ON douyin_aweme(creator_hash);
    CREATE INDEX IF NOT EXISTS idx_dy_a_ctime ON douyin_aweme(create_time);

    -- Douyin Comment Table
    CREATE TABLE IF NOT EXISTS douyin_aweme_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      comment_id TEXT NOT NULL UNIQUE,
      aweme_id TEXT,
      content TEXT,
      create_time INTEGER,
      sub_comment_count TEXT,
      parent_comment_id TEXT,
      like_count TEXT DEFAULT '0',
      pictures TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_dy_c_cid ON douyin_aweme_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_dy_c_aid ON douyin_aweme_comment(aweme_id);
    CREATE INDEX IF NOT EXISTS idx_dy_c_creator ON douyin_aweme_comment(creator_hash);

    -- Kuaishou Video Table
    CREATE TABLE IF NOT EXISTS kuaishou_video (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      video_id TEXT NOT NULL UNIQUE,
      video_type TEXT,
      title TEXT,
      desc TEXT,
      create_time INTEGER,
      liked_count TEXT,
      viewd_count TEXT,
      video_url TEXT,
      video_cover_url TEXT,
      video_play_url TEXT,
      source_keyword TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_ks_v_vid ON kuaishou_video(video_id);
    CREATE INDEX IF NOT EXISTS idx_ks_v_creator ON kuaishou_video(creator_hash);
    CREATE INDEX IF NOT EXISTS idx_ks_v_ctime ON kuaishou_video(create_time);

    -- Kuaishou Comment Table
    CREATE TABLE IF NOT EXISTS kuaishou_video_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      comment_id TEXT NOT NULL UNIQUE,
      video_id TEXT,
      content TEXT,
      create_time INTEGER,
      sub_comment_count TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ks_c_cid ON kuaishou_video_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_ks_c_vid ON kuaishou_video_comment(video_id);
    CREATE INDEX IF NOT EXISTS idx_ks_c_creator ON kuaishou_video_comment(creator_hash);

    -- Weibo Note Table
    CREATE TABLE IF NOT EXISTS weibo_note (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      note_id TEXT NOT NULL UNIQUE,
      content TEXT,
      create_time INTEGER,
      create_date_time TEXT,
      liked_count TEXT,
      comments_count TEXT,
      shared_count TEXT,
      note_url TEXT,
      source_keyword TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_wb_n_nid ON weibo_note(note_id);
    CREATE INDEX IF NOT EXISTS idx_wb_n_creator ON weibo_note(creator_hash);
    CREATE INDEX IF NOT EXISTS idx_wb_n_ctime ON weibo_note(create_time);

    -- Weibo Comment Table
    CREATE TABLE IF NOT EXISTS weibo_note_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      comment_id TEXT NOT NULL UNIQUE,
      note_id TEXT,
      content TEXT,
      create_time INTEGER,
      create_date_time TEXT,
      comment_like_count TEXT,
      sub_comment_count TEXT,
      parent_comment_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wb_c_cid ON weibo_note_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_wb_c_nid ON weibo_note_comment(note_id);
    CREATE INDEX IF NOT EXISTS idx_wb_c_creator ON weibo_note_comment(creator_hash);

    -- Xiaohongshu Note Table
    CREATE TABLE IF NOT EXISTS xhs_note (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      note_id TEXT NOT NULL UNIQUE,
      type TEXT,
      title TEXT,
      desc TEXT,
      video_url TEXT,
      time INTEGER,
      last_update_time INTEGER,
      liked_count TEXT,
      collected_count TEXT,
      comment_count TEXT,
      share_count TEXT,
      image_list TEXT,
      tag_list TEXT,
      note_url TEXT,
      source_keyword TEXT DEFAULT '',
      xsec_token TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_xhs_n_nid ON xhs_note(note_id);
    CREATE INDEX IF NOT EXISTS idx_xhs_n_creator ON xhs_note(creator_hash);
    CREATE INDEX IF NOT EXISTS idx_xhs_n_time ON xhs_note(time);

    -- Xiaohongshu Comment Table
    CREATE TABLE IF NOT EXISTS xhs_note_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      creator_hash TEXT,
      nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      comment_id TEXT NOT NULL UNIQUE,
      create_time INTEGER,
      note_id TEXT,
      content TEXT,
      sub_comment_count INTEGER,
      pictures TEXT,
      parent_comment_id TEXT,
      like_count TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_xhs_c_cid ON xhs_note_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_xhs_c_nid ON xhs_note_comment(note_id);
    CREATE INDEX IF NOT EXISTS idx_xhs_c_ctime ON xhs_note_comment(create_time);

    -- Tieba Note Table
    CREATE TABLE IF NOT EXISTS tieba_note (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL UNIQUE,
      title TEXT,
      desc TEXT,
      note_url TEXT,
      publish_time TEXT,
      creator_hash TEXT,
      user_nickname TEXT DEFAULT '',
      tieba_id TEXT DEFAULT '',
      tieba_name TEXT,
      tieba_link TEXT,
      total_replay_num INTEGER DEFAULT 0,
      total_replay_page INTEGER DEFAULT 0,
      add_ts INTEGER,
      last_modify_ts INTEGER,
      source_keyword TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_tb_n_nid ON tieba_note(note_id);
    CREATE INDEX IF NOT EXISTS idx_tb_n_creator ON tieba_note(creator_hash);

    -- Tieba Comment Table
    CREATE TABLE IF NOT EXISTS tieba_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT NOT NULL UNIQUE,
      parent_comment_id TEXT DEFAULT '',
      content TEXT,
      creator_hash TEXT,
      user_nickname TEXT DEFAULT '',
      tieba_id TEXT DEFAULT '',
      tieba_name TEXT,
      tieba_link TEXT,
      publish_time TEXT,
      sub_comment_count INTEGER DEFAULT 0,
      note_id TEXT,
      note_url TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tb_c_cid ON tieba_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_tb_c_nid ON tieba_comment(note_id);
    CREATE INDEX IF NOT EXISTS idx_tb_c_creator ON tieba_comment(creator_hash);

    -- Zhihu Content Table
    CREATE TABLE IF NOT EXISTS zhihu_content (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT NOT NULL UNIQUE,
      content_type TEXT,
      content_text TEXT,
      content_url TEXT,
      question_id TEXT,
      title TEXT,
      desc TEXT,
      created_time TEXT,
      updated_time TEXT,
      voteup_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      source_keyword TEXT,
      creator_hash TEXT,
      user_nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_zh_con_cid ON zhihu_content(content_id);
    CREATE INDEX IF NOT EXISTS idx_zh_con_creator ON zhihu_content(creator_hash);

    -- Zhihu Comment Table
    CREATE TABLE IF NOT EXISTS zhihu_comment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT NOT NULL UNIQUE,
      parent_comment_id TEXT,
      content TEXT,
      publish_time TEXT,
      sub_comment_count INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      dislike_count INTEGER DEFAULT 0,
      content_id TEXT,
      content_type TEXT,
      creator_hash TEXT,
      user_nickname TEXT,
      add_ts INTEGER,
      last_modify_ts INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_zh_c_cid ON zhihu_comment(comment_id);
    CREATE INDEX IF NOT EXISTS idx_zh_c_conid ON zhihu_comment(content_id);
    CREATE INDEX IF NOT EXISTS idx_zh_c_creator ON zhihu_comment(creator_hash);

    -- Crawl Runs Table (Analytics tracking)
    CREATE TABLE IF NOT EXISTS crawl_runs (
      run_id TEXT PRIMARY KEY,
      task_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      crawler_type TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      save_option TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      exit_code INTEGER,
      item_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      config_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_runs_started_at ON crawl_runs(started_at DESC);

    -- Content Records Table (Normalized analytical contents)
    CREATE TABLE IF NOT EXISTS content_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      platform_label TEXT NOT NULL,
      content_id TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'content',
      keyword TEXT NOT NULL DEFAULT '未标记关键词',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      creator_id TEXT NOT NULL DEFAULT '',
      creator_name TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      content_url TEXT NOT NULL DEFAULT '',
      published_at INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      saves INTEGER NOT NULL DEFAULT 0,
      comments INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      views INTEGER NOT NULL DEFAULT 0,
      engagement INTEGER NOT NULL DEFAULT 0,
      source_file TEXT NOT NULL DEFAULT '',
      ingested_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES crawl_runs(run_id) ON DELETE CASCADE,
      UNIQUE(run_id, platform, content_id, keyword)
    );
    CREATE INDEX IF NOT EXISTS idx_content_run_id ON content_records(run_id);
    CREATE INDEX IF NOT EXISTS idx_content_platform_keyword ON content_records(platform, keyword);
    CREATE INDEX IF NOT EXISTS idx_content_engagement ON content_records(engagement DESC);

    -- Local conversational agent workspace
    CREATE TABLE IF NOT EXISTS agent_threads (
      thread_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_threads_updated ON agent_threads(updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'text',
      content TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES agent_threads(thread_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_messages_thread ON agent_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS agent_plans (
      plan_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(thread_id) REFERENCES agent_threads(thread_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_plans_thread ON agent_plans(thread_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_plan_steps (
      step_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      run_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES agent_plans(plan_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_plan_steps_plan ON agent_plan_steps(plan_id);
  `);
}
