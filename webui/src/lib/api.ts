import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Types
export interface PlatformState {
  status: 'idle' | 'running' | 'stopping' | 'error'
  platform: string
  crawler_type: string | null
  started_at: string | null
  error_message: string | null
  run_id: string | null
}

export interface CrawlerStatus {
  status: 'idle' | 'running' | 'stopping' | 'error'
  platform?: string | null
  crawler_type?: string | null
  started_at?: string | null
  error_message?: string | null
  run_id?: string | null
  platform_states?: { [platform: string]: PlatformState }
}

export interface CrawlerConfig {
  platform: string
  login_type: string
  crawler_type: string
  keywords: string
  specified_ids?: string
  creator_ids?: string
  start_page: number
  enable_comments: boolean
  enable_sub_comments: boolean
  cookies: string
  headless: boolean
  loop_execution: boolean
}

export interface LogEntry {
  id: number
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success' | 'debug'
  message: string
  platform?: string
}

export interface AnalyticsTotals {
  content_count: number
  creator_count: number
  likes: number
  saves: number
  comments: number
  shares: number
  views: number
  engagement: number
}

export interface KeywordAnalytics extends AnalyticsTotals {
  keyword: string
}

export interface PlatformAnalytics extends AnalyticsTotals {
  platform: string
  platform_label: string
}

export interface AnalyticsSummary {
  totals: AnalyticsTotals
  by_keyword: KeywordAnalytics[]
  by_platform: PlatformAnalytics[]
  filters: {
    platforms: [string, string][]
    keywords: string[]
  }
}

export interface NormalizedContent {
  run_id?: string
  platform: string
  platform_label: string
  content_id: string
  content_type: string
  keyword: string
  title: string
  description: string
  creator_id: string
  creator_name: string
  cover_url: string
  content_url: string
  published_at: number
  likes: number
  saves: number
  comments: number
  shares: number
  views: number
  engagement: number
  source_file: string
}

export interface AnalyticsContentsResponse {
  items: NormalizedContent[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface NormalizedComment {
  platform: string
  platform_label: string
  content_id: string
  comment_id: string
  parent_comment_id: string
  level: 1 | 2
  content: string
  creator_id: string
  creator_name: string
  published_at: number
  likes: number
  sub_comment_count: number
}

export interface AnalyticsCommentsResponse {
  items: NormalizedComment[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface CommentThread extends NormalizedComment {
  replies: NormalizedComment[]
}

export interface AnalyticsCommentThreadsResponse {
  items: CommentThread[]
  total: number
  root_total: number
  orphan_reply_count: number
  orphan_replies: NormalizedComment[]
  page: number
  page_size: number
  pages: number
}

export interface CrawlRun {
  run_id: string
  task_name: string
  platform: string
  crawler_type: string
  keywords: string
  save_option: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  started_at: string
  finished_at: string | null
  exit_code: number | null
  item_count: number
  error_message: string | null
  config_json: string
}

export interface AnalyticsRunsResponse {
  items: CrawlRun[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface Platform {
  value: string
  label: string
  icon: string
}

export interface ConfigOption {
  value: string
  label: string
}

export interface AgentMessage {
  message_id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  kind: 'text' | 'clarify' | 'plan' | 'analysis' | 'status'
  content: string
  metadata: Record<string, any>
  created_at: string
}

export interface ResearchPlanData {
  goal: string
  platforms: string[]
  keywords: string[]
  collectComments: boolean
  collectSubComments: boolean
  startPage: number
  loginType: 'qrcode' | 'cookie'
  headless: boolean
  analysis: string[]
  outputs: string[]
}

export interface AgentPlanStep {
  step_id: string
  plan_id: string
  platform: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
  run_id: string | null
  error_message: string | null
}

export interface AgentPlan {
  plan_id: string
  thread_id: string
  goal: string
  status: 'awaiting_confirmation' | 'queued' | 'running' | 'completed' | 'partially_completed' | 'failed' | 'stopped'
  plan: ResearchPlanData
  steps: AgentPlanStep[]
  created_at: string
  updated_at: string
}

export interface AgentThreadSummary {
  thread_id: string
  title: string
  status: string
  updated_at: string
  last_message?: string
  plan_status?: string
}

export interface AgentThread extends AgentThreadSummary {
  messages: AgentMessage[]
  plan: AgentPlan | null
}

export interface ModelProfile {
  provider: 'minimax' | 'deepseek' | 'custom'
  baseUrl: string
  model: string
  temperature: number
  timeoutMs: number
  apiKeyConfigured: boolean
}

// API functions
export const crawlerApi = {
  start: (config: CrawlerConfig) => api.post('/crawler/start', config),
  stop: (platform?: string) => api.post('/crawler/stop', null, { params: { platform } }),
  getStatus: (platform?: string) => api.get<CrawlerStatus>('/crawler/status', { params: { platform } }),
  getLogs: (platform?: string, limit = 100) => api.get<{ logs: LogEntry[] }>('/crawler/logs', { params: { platform, limit } }),
}

export const dataApi = {
  getAnalyticsSummary: (platform?: string, keyword?: string, runId?: string) =>
    api.get<AnalyticsSummary>('/data/analytics/summary', {
      params: {
        platform: platform && platform !== 'all' ? platform : undefined,
        keyword: keyword && keyword !== 'all' ? keyword : undefined,
        run_id: runId && runId !== 'all' ? runId : undefined,
      },
    }),
  getAnalyticsContents: (params: {
    platform?: string
    keyword?: string
    query?: string
    sort_by?: string
    sort_order?: 'asc' | 'desc'
    page?: number
    page_size?: number
    run_id?: string
  }) => api.get<AnalyticsContentsResponse>('/data/analytics/contents', {
    params: {
      ...params,
      platform: params.platform && params.platform !== 'all' ? params.platform : undefined,
      keyword: params.keyword && params.keyword !== 'all' ? params.keyword : undefined,
      run_id: params.run_id && params.run_id !== 'all' ? params.run_id : undefined,
    },
  }),
  getAnalyticsComments: (params: {
    run_id?: string
    platform?: string
    content_id?: string
    level?: number
    query?: string
    page?: number
    page_size?: number
  }) => api.get<AnalyticsCommentsResponse>('/data/analytics/comments', {
    params: {
      ...params,
      platform: params.platform && params.platform !== 'all' ? params.platform : undefined,
      run_id: params.run_id && params.run_id !== 'all' ? params.run_id : undefined,
    },
  }),
  getAnalyticsCommentThreads: (params: {
    run_id?: string
    platform: string
    content_id: string
    page?: number
    page_size?: number
  }) => api.get<AnalyticsCommentThreadsResponse>('/data/analytics/comments/threads', {
    params: {
      ...params,
      run_id: params.run_id && params.run_id !== 'all' ? params.run_id : undefined,
    },
  }),
  getAnalyticsRuns: (page = 1, pageSize = 20) =>
    api.get<AnalyticsRunsResponse>('/data/analytics/runs', { params: { page, page_size: pageSize } }),
  deleteAnalyticsRun: (runId: string) =>
    api.delete<{ status: string; run_id: string }>(`/data/analytics/runs/${encodeURIComponent(runId)}`),
  getAnalyticsExportUrl: (params: {
    run_id?: string
    platform?: string
    keyword?: string
    query?: string
    sort_by?: string
  }) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value && value !== 'all') search.set(key, value)
    })
    return `/api/data/analytics/export?${search.toString()}`
  },
}

export const configApi = {
  getPlatforms: () => api.get<{ platforms: Platform[] }>('/config/platforms'),
  getOptions: () =>
    api.get<{
      login_types: ConfigOption[]
      crawler_types: ConfigOption[]
    }>('/config/options'),
}

export const agentApi = {
  listThreads: () => api.get<{ items: AgentThreadSummary[] }>('/agent/threads'),
  createThread: (title?: string) => api.post<AgentThread>('/agent/threads', { title }),
  getThread: (threadId: string) => api.get<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`),
  deleteThread: (threadId: string) => api.delete(`/agent/threads/${encodeURIComponent(threadId)}`),
  sendMessage: (threadId: string, content: string) =>
    api.post<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}/messages`, { content }, { timeout: 180000 }),
  executePlan: (planId: string) => api.post<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}/execute`),
  getPlanExportUrl: (planId: string) => `/api/agent/plans/${encodeURIComponent(planId)}/export`,
  getModelProfile: () => api.get<ModelProfile>('/agent/model-profile'),
  saveModelProfile: (profile: Partial<ModelProfile> & { apiKey?: string }) => api.put<ModelProfile>('/agent/model-profile', profile),
  testModelProfile: () => api.post<{ success: boolean; message: string; latency_ms: number }>('/agent/model-profile/test', null, { timeout: 180000 }),
}

export interface EnvCheckResult {
  success: boolean
  message: string
  output?: string
  error?: string
}

export const envApi = {
  check: () => api.get<EnvCheckResult>('/env/check'),
}

export default api
