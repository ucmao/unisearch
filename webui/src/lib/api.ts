import axios from 'axios'
import type { ConnectorManifest } from '@/types/crawler'

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
  connector_id?: string
  capability?: string
  connector_options?: Record<string, unknown>
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
  source_metadata?: string
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
  thread_id: string
  plan_id: string
  task_title: string
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

export interface AnalyticsTaskGroup {
  thread_id: string
  task_title: string
  rounds: AnalyticsRoundGroup[]
}

export interface AnalyticsRoundGroup {
  plan_id: string
  round_title: string
  runs: CrawlRun[]
}

export interface AnalyticsTasksResponse {
  items: AnalyticsTaskGroup[]
  total: number
  round_total: number
  run_total: number
}

export interface StorageSummary {
  analytics_runs: number
  analytics_records: number
  log_records: number
  raw_records: number
}

export interface Platform {
  value: string
  label: string
  icon: string
  category?: string
  capabilities?: string[]
}

export interface ConfigOption {
  value: string
  label: string
}

export interface AgentMessage {
  message_id: string
  thread_id: string
  role: 'user' | 'assistant' | 'system'
  kind: 'text' | 'clarify' | 'plan' | 'analysis' | 'status' | 'export'
  content: string
  metadata: Record<string, any>
  created_at: string
}

export interface AgentAttachment {
  attachment_id: string
  file_name: string
  mime_type: string
  kind: 'image' | 'text' | 'spreadsheet'
  size_bytes: number
  created_at: string
}

export interface AgentTaskReference {
  plan_id: string
  goal: string
  status: 'completed' | 'partially_completed'
  platforms: string[]
  content_count: number
  updated_at: string
}

export interface ResearchPlanData {
  goal: string
  platforms: string[]
  keywords: string[]
  capability?: 'keyword_search' | 'content_detail' | 'creator_profile' | 'comments' | 'url_resolve'
  targets?: string[]
  connectorOptions?: Record<string, Record<string, unknown>>
  collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom'
  collectComments: boolean
  collectSubComments: boolean
  startPage: number
  loginType: 'qrcode' | 'cookie'
  headless: boolean
  analysis: string[]
  analysisSource?: 'ai' | 'fallback' | 'user'
  outputs: string[]
}

export interface AgentPlanStep {
  step_id: string
  plan_id: string
  platform: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
  run_id: string | null
  error_message: string | null
  item_count?: number
}

export interface AgentPlan {
  plan_id: string
  thread_id: string
  goal: string
  status: 'awaiting_confirmation' | 'queued' | 'running' | 'completed' | 'partially_completed' | 'failed' | 'stopped'
  plan: ResearchPlanData
  steps: AgentPlanStep[]
  stats?: {
    content_count: number
    by_platform: Array<{ platform: string; platform_label: string; count: number }>
  }
  created_at: string
  updated_at: string
  round_number?: number
}

export interface AgentThreadSummary {
  thread_id: string
  title: string
  title_source?: 'default' | 'legacy' | 'fallback' | 'generated' | 'plan' | 'manual'
  title_locked?: number | boolean
  status: string
  updated_at: string
  last_message?: string
  plan_status?: string
}

export interface AgentThread extends AgentThreadSummary {
  messages: AgentMessage[]
  plan: AgentPlan | null
  plans: AgentPlan[]
}

export interface ModelProfile {
  provider: 'minimax' | 'deepseek' | 'custom'
  baseUrl: string
  model: string
  temperature: number
  timeoutMs: number
  apiKeyConfigured: boolean
  connectionVerified: boolean
  lastError?: string
}

export interface MemorySettings {
  enabled: boolean
  autoCapture: boolean
  autoRecall: boolean
  captureMode: 'conservative' | 'balanced'
  recallLimit: number
}

export interface RuntimeSettings {
  maxConcurrentCrawlers: number
}

export interface AgentMemory {
  memory_id: string
  category: 'identity' | 'preference' | 'context' | 'rule'
  memory_key: string
  content: string
  confidence: number
  importance: number
  status: 'active' | 'candidate'
  source_thread_id?: string | null
  source_message_id?: string | null
  created_at: string
  updated_at: string
  last_used_at?: string | null
}

// API functions
export const crawlerApi = {
  start: (config: CrawlerConfig) => api.post('/crawler/start', config),
  stop: (platform?: string) => api.post('/crawler/stop', null, { params: { platform } }),
  getStatus: (platform?: string) => api.get<CrawlerStatus>('/crawler/status', { params: { platform } }),
  getLogs: (platform?: string, limit = 100) => api.get<{ logs: LogEntry[] }>('/crawler/logs', { params: { platform, limit } }),
}

export const dataApi = {
  getAnalyticsSummary: (platform?: string, keyword?: string, runId?: string, planId?: string, threadId?: string) =>
    api.get<AnalyticsSummary>('/data/analytics/summary', {
      params: {
        platform: platform && platform !== 'all' ? platform : undefined,
        keyword: keyword && keyword !== 'all' ? keyword : undefined,
        run_id: runId && runId !== 'all' ? runId : undefined,
        plan_id: planId && planId !== 'all' ? planId : undefined,
        thread_id: threadId && threadId !== 'all' ? threadId : undefined,
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
    plan_id?: string
    thread_id?: string
  }) => api.get<AnalyticsContentsResponse>('/data/analytics/contents', {
    params: {
      ...params,
      platform: params.platform && params.platform !== 'all' ? params.platform : undefined,
      keyword: params.keyword && params.keyword !== 'all' ? params.keyword : undefined,
      run_id: params.run_id && params.run_id !== 'all' ? params.run_id : undefined,
      plan_id: params.plan_id && params.plan_id !== 'all' ? params.plan_id : undefined,
      thread_id: params.thread_id && params.thread_id !== 'all' ? params.thread_id : undefined,
    },
  }),
  getAnalyticsComments: (params: {
    run_id?: string
    plan_id?: string
    thread_id?: string
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
      plan_id: params.plan_id && params.plan_id !== 'all' ? params.plan_id : undefined,
      thread_id: params.thread_id && params.thread_id !== 'all' ? params.thread_id : undefined,
    },
  }),
  getAnalyticsCommentThreads: (params: {
    run_id?: string
    plan_id?: string
    thread_id?: string
    platform: string
    content_id: string
    page?: number
    page_size?: number
  }) => api.get<AnalyticsCommentThreadsResponse>('/data/analytics/comments/threads', {
    params: {
      ...params,
      run_id: params.run_id && params.run_id !== 'all' ? params.run_id : undefined,
      plan_id: params.plan_id && params.plan_id !== 'all' ? params.plan_id : undefined,
      thread_id: params.thread_id && params.thread_id !== 'all' ? params.thread_id : undefined,
    },
  }),
  getAnalyticsRuns: (page = 1, pageSize = 20) =>
    api.get<AnalyticsRunsResponse>('/data/analytics/runs', { params: { page, page_size: pageSize } }),
  getAnalyticsTasks: () => api.get<AnalyticsTasksResponse>('/data/analytics/tasks'),
  deleteAnalyticsRun: (runId: string) =>
    api.delete<{ status: string; run_id: string }>(`/data/analytics/runs/${encodeURIComponent(runId)}`),
  deleteAnalyticsTask: (threadId: string) =>
    api.delete<{ status: string; thread_id: string }>(`/data/analytics/tasks/${encodeURIComponent(threadId)}`),
  deleteAnalyticsRound: (planId: string) =>
    api.delete<{ status: string; plan_id: string }>(`/data/analytics/rounds/${encodeURIComponent(planId)}`),
  deleteAnalyticsRuns: (runIds: string[]) =>
    api.post<{ status: string; deleted: number }>('/data/analytics/runs/batch-delete', { run_ids: runIds }),
  deleteAnalyticsTasks: (threadIds: string[]) =>
    api.post<{ status: string; deleted: number }>('/data/analytics/tasks/batch-delete', { thread_ids: threadIds }),
  deleteAnalyticsRounds: (planIds: string[]) =>
    api.post<{ status: string; deleted: number }>('/data/analytics/rounds/batch-delete', { plan_ids: planIds }),
  getStorageSummary: () => api.get<StorageSummary>('/data/storage/summary'),
  cleanupStorage: (mode: 'failed_empty' | 'older_than_30_days' | 'all') =>
    api.post<{ status: string; deleted: number }>('/data/storage/cleanup', { mode }),
  getAnalyticsExportUrl: (params: {
    run_id?: string
    plan_id?: string
    thread_id?: string
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
  getConnectors: () => api.get<{ connectors: ConnectorManifest[] }>('/config/connectors'),
  getOptions: () =>
    api.get<{
      login_types: ConfigOption[]
      crawler_types: ConfigOption[]
    }>('/config/options'),
}

export const agentApi = {
  listThreads: () => api.get<{ items: AgentThreadSummary[] }>('/agent/threads'),
  listReferenceableTasks: () => api.get<{ items: AgentTaskReference[] }>('/agent/referenceable-tasks'),
  createThread: (title?: string, addWelcomeMessage = true) =>
    api.post<AgentThread>('/agent/threads', { title, add_welcome_message: addWelcomeMessage }),
  getThread: (threadId: string) => api.get<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`),
  renameThread: (threadId: string, title: string) => api.patch<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`, { title }),
  deleteThread: (threadId: string, deleteAnalyticsData = false) => api.delete(`/agent/threads/${encodeURIComponent(threadId)}`, { data: { delete_analytics_data: deleteAnalyticsData } }),
  deleteThreads: (threadIds: string[], deleteAnalyticsData = false) =>
    api.post<{ status: string; deleted: number; analytics_runs_deleted: number }>('/agent/threads/batch-delete', {
      thread_ids: threadIds,
      delete_analytics_data: deleteAnalyticsData,
    }),
  uploadAttachment: (threadId: string, file: { fileName: string; mimeType: string; dataBase64: string }) =>
    api.post<AgentAttachment>(`/agent/threads/${encodeURIComponent(threadId)}/attachments`, file, { timeout: 120000 }),
  deleteAttachment: (threadId: string, attachmentId: string) =>
    api.delete(`/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}`),
  sendMessage: (threadId: string, content: string, context: {
    attachment_ids?: string[]
    task_references?: Array<{ plan_id: string; platforms?: string[] }>
  } = {}) =>
    api.post<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}/messages`, { content, ...context }, { timeout: 180000 }),
  executePlan: (planId: string) => api.post<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}/execute`),
  updatePlan: (planId: string, updates: { keywords?: string[]; analysis?: string[]; collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom' }) =>
    api.patch<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}`, updates),
  updatePlanAnalysis: (planId: string, analysis: string[]) =>
    api.patch<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}/analysis`, { analysis }),
  getPlanExportUrl: (planId: string) => `/api/agent/plans/${encodeURIComponent(planId)}/export`,
  getModelProfile: () => api.get<ModelProfile>('/agent/model-profile'),
  saveModelProfile: (profile: Partial<ModelProfile> & { apiKey?: string }) => api.put<ModelProfile>('/agent/model-profile', profile),
  testModelProfile: () => api.post<{ success: boolean; message: string; latency_ms: number }>('/agent/model-profile/test', null, { timeout: 180000 }),
  getMemorySettings: () => api.get<MemorySettings>('/agent/memory-settings'),
  saveMemorySettings: (settings: Partial<MemorySettings>) => api.put<MemorySettings>('/agent/memory-settings', settings),
  getRuntimeSettings: () => api.get<RuntimeSettings>('/agent/runtime-settings'),
  saveRuntimeSettings: (settings: Partial<RuntimeSettings>) => api.put<RuntimeSettings>('/agent/runtime-settings', settings),
  listMemories: () => api.get<{ items: AgentMemory[] }>('/agent/memories'),
  updateMemory: (memoryId: string, input: { content?: string; status?: AgentMemory['status'] }) =>
    api.patch<AgentMemory>(`/agent/memories/${encodeURIComponent(memoryId)}`, input),
  deleteMemory: (memoryId: string) => api.delete(`/agent/memories/${encodeURIComponent(memoryId)}`),
  clearMemories: () => api.delete<{ deleted: number }>('/agent/memories'),
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

export const browserApi = {
  getWindowStatus: () => api.get<{ success: boolean; visible: boolean }>('/browser/window'),
  toggleWindow: (action: 'show' | 'hide' | 'toggle' = 'toggle') =>
    api.post<{ success: boolean; visible: boolean }>('/browser/window', { action }),
}

export default api
