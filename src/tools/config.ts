export interface AppConfig {
  PLATFORM: string;
  KEYWORDS: string;
  LOGIN_TYPE: 'qrcode' | 'cookie' | 'phone';
  COOKIES: string;
  CRAWLER_TYPE: 'search' | 'detail' | 'creator';
  
  ENABLE_IP_PROXY: boolean;
  IP_PROXY_POOL_COUNT: number;
  IP_PROXY_PROVIDER_NAME: string;
  STATIC_PROXY_URL: string;

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
  MAX_CONCURRENCY_NUM: number;
  
  ENABLE_GET_MEIDAS: boolean;
  ENABLE_GET_COMMENTS: boolean;
  CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: number;
  ENABLE_GET_SUB_COMMENTS: boolean;
  
  ENABLE_GET_WORDCLOUD: boolean;
  STOP_WORDS_FILE: string;
  CRAWLER_MAX_SLEEP_SEC: number;
  DISABLE_SSL_VERIFY: boolean;

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

  [key: string]: any;
}

export const DEFAULT_CONFIG: AppConfig = {
  PLATFORM: 'xhs',
  KEYWORDS: '编程副业,编程兼职',
  LOGIN_TYPE: 'qrcode',
  COOKIES: '',
  CRAWLER_TYPE: 'search',
  
  ENABLE_IP_PROXY: false,
  IP_PROXY_POOL_COUNT: 2,
  IP_PROXY_PROVIDER_NAME: 'static',
  STATIC_PROXY_URL: '',

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
  MAX_CONCURRENCY_NUM: 1,
  
  ENABLE_GET_MEIDAS: false,
  ENABLE_GET_COMMENTS: false,
  CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES: 10,
  ENABLE_GET_SUB_COMMENTS: false,
  
  ENABLE_GET_WORDCLOUD: false,
  STOP_WORDS_FILE: './resources/hit_stopwords.txt',
  CRAWLER_MAX_SLEEP_SEC: 2,
  DISABLE_SSL_VERIFY: false,

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
  if (updates.login_type !== undefined) mappedUpdates.LOGIN_TYPE = updates.login_type;
  if (updates.crawler_type !== undefined) mappedUpdates.CRAWLER_TYPE = updates.crawler_type;
  if (updates.keywords !== undefined) mappedUpdates.KEYWORDS = updates.keywords;
  if (updates.start_page !== undefined) mappedUpdates.START_PAGE = updates.start_page;
  if (updates.cookies !== undefined) mappedUpdates.COOKIES = updates.cookies;

  if (updates.headless !== undefined) {
    mappedUpdates.HEADLESS = updates.headless;
    mappedUpdates.CDP_HEADLESS = updates.headless;
  }

  if (updates.enable_comments !== undefined) {
    mappedUpdates.ENABLE_GET_COMMENTS = updates.enable_comments;
  }
  if (updates.enable_sub_comments !== undefined) {
    mappedUpdates.ENABLE_GET_SUB_COMMENTS = updates.enable_sub_comments;
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
