export interface AppConfig {
  PLATFORM: string;
  KEYWORDS: string;
  LOGIN_TYPE: 'qrcode' | 'none';
  CRAWLER_TYPE: 'search' | 'detail' | 'creator';
  
  HEADLESS: boolean;
  SAVE_LOGIN_STATE: boolean;
  
  // CDP Mode
  ENABLE_CDP_MODE: boolean;
  CDP_DEBUG_PORT: number;
  CUSTOM_BROWSER_PATH: string;
  CDP_HEADLESS: boolean;
  BROWSER_LAUNCH_TIMEOUT: number;
  CDP_CONNECT_EXISTING: boolean;
  AUTO_CLOSE_BROWSER: boolean;

  SAVE_DATA_OPTION: 'sqlite' | 'json' | 'jsonl' | 'csv' | 'excel';
  SAVE_DATA_PATH: string;
  USER_DATA_DIR: string;
  
  START_PAGE: number;
  CRAWLER_MAX_NOTES_COUNT: number;
  JOB_LOCATION: string;
  MAX_CONCURRENCY_NUM: number;
  
  ENABLE_GET_MEIDAS: boolean;
  ENABLE_GET_COMMENTS: boolean;
  CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: number;
  
  ENABLE_GET_WORDCLOUD: boolean;
  STOP_WORDS_FILE: string;
  CRAWLER_MAX_SLEEP_SEC: number;
  DISABLE_SSL_VERIFY: boolean;

  AIHOT_CONTENT_MODE: 'items' | 'hot_topics' | 'latest_daily';
  AIHOT_ITEMS_MODE: 'selected' | 'all';
  AIHOT_WINDOW: '24h' | '7d';
  AIHOT_CATEGORY: string;

  ARXIV_SEARCH_SCOPE: 'all' | 'title' | 'author' | 'abstract' | 'category';
  ARXIV_SORT_BY: 'relevance' | 'lastUpdatedDate' | 'submittedDate';
  ARXIV_SORT_ORDER: 'ascending' | 'descending';

  GITHUB_REPOSITORIES_MODE: 'general' | 'ai';
  GITHUB_REPOSITORIES_PERIOD: 'daily' | 'weekly' | 'monthly';
  GITHUB_REPOSITORIES_LANGUAGE: string;

  WEB_READER_TIMEOUT_MS: number;
  WEB_READER_CONCURRENCY: number;

  /**
   * Reference to the written BOSS authorization/partner agreement that permits
   * this connector run. The BOSS runtime refuses to navigate without it.
   */
  BOSS_AUTHORIZATION_REFERENCE: string;

  // Platform specific lists
  XHS_CREATOR_ID_LIST: string[];
  DY_CREATOR_ID_LIST: string[];
  KS_CREATOR_ID_LIST: string[];
  BILI_CREATOR_ID_LIST: string[];
  WB_CREATOR_ID_LIST: string[];
  TIEBA_CREATOR_ID_LIST: string[];
  ZHIHU_CREATOR_ID_LIST: string[];

  XHS_SPECIFIED_ID_LIST: string[];
  DY_SPECIFIED_ID_LIST: string[];
  KS_SPECIFIED_ID_LIST: string[];
  BILI_SPECIFIED_ID_LIST: string[];
  WB_SPECIFIED_ID_LIST: string[];
  TIEBA_SPECIFIED_ID_LIST: string[];
  ZHIHU_SPECIFIED_ID_LIST: string[];
  ARXIV_SPECIFIED_ID_LIST: string[];
  GITHUB_REPOSITORIES_SPECIFIED_ID_LIST: string[];

  [key: string]: any;
}

export const DEFAULT_CONFIG: AppConfig = {
  PLATFORM: 'xhs',
  KEYWORDS: '编程副业,编程兼职',
  SPECIFIED_IDS: '',
  CREATOR_IDS: '',
  TARGET_URLS: '',
  LOGIN_TYPE: 'qrcode',
  CRAWLER_TYPE: 'search',
  
  HEADLESS: true,
  SAVE_LOGIN_STATE: true,
  
  ENABLE_CDP_MODE: false,
  CDP_DEBUG_PORT: 9222,
  CUSTOM_BROWSER_PATH: '',
  CDP_HEADLESS: true,

  BROWSER_LAUNCH_TIMEOUT: 60,
  CDP_CONNECT_EXISTING: false,
  AUTO_CLOSE_BROWSER: true,

  SAVE_DATA_OPTION: 'sqlite',
  SAVE_DATA_PATH: '',
  USER_DATA_DIR: '%s_user_data_dir',

  START_PAGE: 1,
  CRAWLER_MAX_NOTES_COUNT: 15,
  JOB_LOCATION: '',
  MAX_CONCURRENCY_NUM: 1,
  
  ENABLE_GET_MEIDAS: false,
  ENABLE_GET_COMMENTS: false,
  CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 10,
  
  ENABLE_GET_WORDCLOUD: false,
  STOP_WORDS_FILE: './resources/hit_stopwords.txt',
  CRAWLER_MAX_SLEEP_SEC: 2,
  DISABLE_SSL_VERIFY: false,

  AIHOT_CONTENT_MODE: 'items',
  AIHOT_ITEMS_MODE: 'selected',
  AIHOT_WINDOW: '24h',
  AIHOT_CATEGORY: 'all',

  ARXIV_SEARCH_SCOPE: 'all',
  ARXIV_SORT_BY: 'submittedDate',
  ARXIV_SORT_ORDER: 'descending',

  GITHUB_REPOSITORIES_MODE: 'general',
  GITHUB_REPOSITORIES_PERIOD: 'weekly',
  GITHUB_REPOSITORIES_LANGUAGE: '',

  WEB_READER_TIMEOUT_MS: 15000,
  WEB_READER_CONCURRENCY: 2,

  BOSS_AUTHORIZATION_REFERENCE: '',

  XHS_CREATOR_ID_LIST: [],
  DY_CREATOR_ID_LIST: [],
  KS_CREATOR_ID_LIST: [],
  BILI_CREATOR_ID_LIST: [],
  WB_CREATOR_ID_LIST: [],
  TIEBA_CREATOR_ID_LIST: [],
  ZHIHU_CREATOR_ID_LIST: [],

  XHS_SPECIFIED_ID_LIST: [],
  DY_SPECIFIED_ID_LIST: [],
  KS_SPECIFIED_ID_LIST: [],
  BILI_SPECIFIED_ID_LIST: [],
  WB_SPECIFIED_ID_LIST: [],
  TIEBA_SPECIFIED_ID_LIST: [],
  ZHIHU_SPECIFIED_ID_LIST: [],
  ARXIV_SPECIFIED_ID_LIST: [],
  GITHUB_REPOSITORIES_SPECIFIED_ID_LIST: [],
};

export let activeConfig: AppConfig = { ...DEFAULT_CONFIG };

export function applyConfig(updates: any): AppConfig {
  if (!updates) return activeConfig;

  const mappedUpdates: Partial<AppConfig> = {};

  // Direct case-insensitive lookup in DEFAULT_CONFIG
  for (const [key, value] of Object.entries(updates)) {
    const upperKey = key.toUpperCase();
    if (upperKey in DEFAULT_CONFIG) {
      (mappedUpdates as any)[upperKey] = value;
    }
  }

  // Explicit frontend-to-backend mappings
  if (updates.platform !== undefined) mappedUpdates.PLATFORM = updates.platform;
  if (updates.login_type !== undefined) {
    if (updates.login_type !== 'qrcode' && updates.login_type !== 'none') {
      throw new Error(`Unsupported login method: ${String(updates.login_type)}`);
    }
    mappedUpdates.LOGIN_TYPE = updates.login_type;
  }
  if (updates.crawler_type !== undefined) mappedUpdates.CRAWLER_TYPE = updates.crawler_type;
  if (updates.keywords !== undefined) mappedUpdates.KEYWORDS = updates.keywords;
  if (updates.start_page !== undefined) mappedUpdates.START_PAGE = updates.start_page;

  if (updates.headless !== undefined) {
    mappedUpdates.HEADLESS = updates.headless;
    mappedUpdates.CDP_HEADLESS = updates.headless;
  }

  if (updates.enable_comments !== undefined) {
    mappedUpdates.ENABLE_GET_COMMENTS = updates.enable_comments;
  }

  if (updates.specified_ids !== undefined) {
    const rawVal = typeof updates.specified_ids === 'string'
      ? updates.specified_ids
      : Array.isArray(updates.specified_ids) ? updates.specified_ids.join(',') : String(updates.specified_ids);
    mappedUpdates.SPECIFIED_IDS = rawVal;
  }
  if (updates.creator_ids !== undefined) {
    const rawVal = typeof updates.creator_ids === 'string'
      ? updates.creator_ids
      : Array.isArray(updates.creator_ids) ? updates.creator_ids.join(',') : String(updates.creator_ids);
    mappedUpdates.CREATOR_IDS = rawVal;
  }
  if (updates.target_urls !== undefined) {
    const rawVal = typeof updates.target_urls === 'string'
      ? updates.target_urls
      : Array.isArray(updates.target_urls) ? updates.target_urls.join(',') : String(updates.target_urls);
    mappedUpdates.TARGET_URLS = rawVal;
  }

  // Handle platform specific creator/specified list inputs
  if (updates.platform) {
    const plat = updates.platform.toUpperCase();
    if (updates.specified_ids !== undefined) {
      const listKey = `${plat}_SPECIFIED_ID_LIST` as keyof AppConfig;
      const ids = typeof updates.specified_ids === 'string'
        ? updates.specified_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
        : updates.specified_ids;
      (mappedUpdates as any)[listKey] = ids;
    }
    if (updates.creator_ids !== undefined) {
      const listKey = `${plat}_CREATOR_ID_LIST` as keyof AppConfig;
      const ids = typeof updates.creator_ids === 'string'
        ? updates.creator_ids.split(',').map((s: string) => s.trim()).filter(Boolean)
        : updates.creator_ids;
      (mappedUpdates as any)[listKey] = ids;
    }
  }

  activeConfig = {
    ...activeConfig,
    ...mappedUpdates,
  };
  return activeConfig;
}

export function resetConfig(): void {
  activeConfig = { ...DEFAULT_CONFIG };
}
