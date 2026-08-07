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
  run_id?: string
  thread_id?: string
}

export interface CanonicalSubject {
  id?: string
  name?: string
  type: 'creator' | 'publisher' | 'company' | 'merchant' | 'ai_platform' | 'forum' | 'unknown'
}

export interface CanonicalAsset {
  assetId: string
  documentId: string
  kind: 'image' | 'video' | 'audio' | 'file' | 'unknown'
  role: 'cover' | 'content' | 'avatar' | 'thumbnail' | 'attachment' | 'unknown'
  url: string
  mimeType?: string
  localPath?: string
  metadata: Record<string, unknown>
}

export interface CanonicalCitation {
  title?: string
  url: string
  source?: string
}

export interface CanonicalDocument {
  schemaVersion: 2
  documentId: string
  canonicalKey: string
  kind: string
  platform: string
  originalPlatform?: string
  sourceItemId?: string
  parentSourceItemId?: string
  sourceUrl?: string
  keyword?: string
  rank?: number
  title: string
  summary: string
  markdown: string
  subject: CanonicalSubject
  publishedAt?: string | number
  sourceUpdatedAt?: string | number
  fetchedAt: string
  language: string
  metrics: Record<string, number | null>
  attributes: Record<string, unknown>
  citations: CanonicalCitation[]
  assets: CanonicalAsset[]
  provenance: {
    source: string
    sourceItemId?: string
    sourceUrl?: string
    rawItemId: string
    runId?: string
    fetchedAt: string
  }
  contentHash: string
  createdAt: string
  updatedAt: string
}

export interface AnalyticsAggregate {
  document_count: number
  content_count: number
  comment_count: number
  subject_count: number
  metrics: Record<string, number>
  metric_coverage: Record<string, number>
}

export interface AnalyticsGroup extends AnalyticsAggregate {
  platform?: string
  platform_label?: string
  kind?: string
  keyword?: string
  subject_type?: string
}

export interface AnalyticsSummary {
  totals: AnalyticsAggregate
  by_platform: AnalyticsGroup[]
  by_kind: AnalyticsGroup[]
  by_keyword: AnalyticsGroup[]
  by_subject_type: AnalyticsGroup[]
  filters: {
    platforms: [string, string][]
    kinds: string[]
    keywords: string[]
    subject_types: string[]
    metric_keys: string[]
    attribute_keys: string[]
  }
}

export interface AnalyticsDocumentsResponse {
  items: CanonicalDocument[]
  total: number
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
  /** 平台中文名，由后端统一映射（未知平台回落为 platform 原值） */
  platform_label: string
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
  thread_records: number
  message_records: number
}

/** 由后端从 CONNECTOR_MANIFESTS 下发；平台名称在前端不再有第二份拷贝。 */
export interface Platform {
  value: string
  label: string
  icon: string
  category?: string
  description?: string
  capabilities?: string[]
  requiresAuth?: boolean
}

export interface SkillDefinition {
  id: string
  version: string
  name: string
  description: string
  category: 'core' | 'business' | 'tool'
  icon: string
  mentionable: boolean
  inputs: Array<{ key: string; required: boolean; description: string }>
  targetGuidance: Array<{
    platform: string
    label: string
    accepted: string[]
    preferred: string
    examples: string[]
    notes: string[]
  }>
  defaults?: {
    platforms: string[]
    capability: string
    collectionDepth: 'quick' | 'standard' | 'deep'
    contentEnrichment?: ContentEnrichmentOptions
    analysis: string[]
    outputs: string[]
  }
  limitations: string[]
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

export interface AnalysisCoverage {
  mode: 'quick'
  collectedDocumentCount: number
  statisticallyAnalyzedDocumentCount: number
  qualitativelyAnalyzedDocumentCount: number
  evidenceDocumentCount: number
  evidenceChunkCount: number
  citedDocumentCount: number
  fullDatasetStatistics: true
  partial: boolean
}

export interface AgentAttachment {
  attachment_id: string
  file_name: string
  mime_type: string
  kind: 'image' | 'text' | 'spreadsheet'
  size_bytes: number
  created_at: string
  preview_url?: string
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
  contentEnrichment: ContentEnrichmentOptions
  collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom'
  loginType: 'qrcode' | 'cookie'
  headless: boolean
  analysis: string[]
  analysisSource?: 'ai' | 'fallback' | 'user'
  autoAnalyze?: boolean
  outputs: string[]
}

export interface ContentEnrichmentOptions {
  mode: 'snippet' | 'auto' | 'full'
  maxReadItems: number
  maxPerDomain: number
  concurrency: number
  timeoutMsPerUrl: number
}

export interface AgentPlanStep {
  step_id: string
  plan_id: string
  platform: string
  kind?: string
  step_key?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped'
  run_id: string | null
  error_message: string | null
  /** 正文条数（不含评论） */
  item_count?: number
  /** 该平台附带采集到的评论条数 */
  comment_count?: number
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
  started_at?: string | null
  finished_at?: string | null
  round_number?: number
}

export interface AgentThreadSummary {
  thread_id: string
  title: string
  title_source?: 'default' | 'legacy' | 'fallback' | 'generated' | 'plan' | 'manual'
  title_locked?: number | boolean
  pinned_at?: string | null
  status: string
  updated_at: string
  last_message?: string
  plan_status?: string
  total_items?: number
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
  apiKey?: string
  apiKeyConfigured: boolean
  connectionVerified: boolean
  lastError?: string
}

export interface ModelProfiles {
  activeProvider: ModelProfile['provider']
  profiles: ModelProfile[]
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
  status: 'active' | 'candidate' | 'superseded'
  source_thread_id?: string | null
  source_message_id?: string | null
  created_at: string
  updated_at: string
  last_used_at?: string | null
}

// API functions
export const crawlerApi = {
  start: (config: CrawlerConfig) => api.post('/crawler/start', config),
  stop: (platform?: string) =>
    api.post<{ status: string; message: string; cancelled_plans?: string[] }>(
      '/crawler/stop', null, { params: { platform } },
    ),
  getStatus: (platform?: string) => api.get<CrawlerStatus>('/crawler/status', { params: { platform } }),
  getLogs: (platform?: string, limit = 500, thread_id?: string) => api.get<{ logs: LogEntry[] }>('/crawler/logs', { params: { platform, limit, thread_id } }),
}

export const dataApi = {
  getAnalyticsSummary: (params: {
    platform?: string
    kind?: string
    keyword?: string
    subject_type?: string
    query?: string
    run_id?: string
    workflow_id?: string
    thread_id?: string
  }) => api.get<AnalyticsSummary>('/data/analytics/summary', { params: cleanAnalyticsParams(params) }),
  getAnalyticsDocuments: (params: {
    platform?: string
    kind?: string
    keyword?: string
    subject_type?: string
    parent_source_item_id?: string
    query?: string
    sort_by?: string
    sort_order?: 'asc' | 'desc'
    page?: number
    page_size?: number
    run_id?: string
    workflow_id?: string
    thread_id?: string
  }) => api.get<AnalyticsDocumentsResponse>('/data/analytics/documents', { params: cleanAnalyticsParams(params) }),
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
  cleanupThreads: (mode: 'empty_short' | 'older_than_30_days_no_crawl' | 'all_threads') =>
    api.post<{ status: string; deleted: number }>('/data/storage/cleanup-threads', { mode }),
  getAnalyticsExportUrl: (params: {
    run_id?: string
    workflow_id?: string
    thread_id?: string
    platform?: string
    kind?: string
    keyword?: string
    subject_type?: string
    query?: string
    sort_by?: string
    sort_order?: 'asc' | 'desc'
    format?: 'csv' | 'json' | 'markdown'
  }) => {
    const search = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value && value !== 'all') search.set(key, value)
    })
    return `/api/data/analytics/export?${search.toString()}`
  },
}

function cleanAnalyticsParams<T extends Record<string, unknown>>(params: T): T {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [
    key,
    value === 'all' || value === '' ? undefined : value,
  ])) as T
}

export const configApi = {
  getPlatforms: () => api.get<{ platforms: Platform[] }>('/config/platforms'),
  getConnectors: () => api.get<{ connectors: ConnectorManifest[] }>('/config/connectors'),
  getOptions: () =>
    api.get<{
      login_types: ConfigOption[]
      crawler_types: ConfigOption[]
    }>('/config/options'),
  clearAuthCredentials: (platform?: string) => api.post<{ status: string; message: string }>('/config/auth/clear', { platform }),
}

export const agentApi = {
  listSkills: () => api.get<{ items: SkillDefinition[] }>('/skills'),
  listThreads: () => api.get<{ items: AgentThreadSummary[] }>('/agent/threads'),
  listReferenceableTasks: () => api.get<{ items: AgentTaskReference[] }>('/agent/referenceable-tasks'),
  createThread: (title?: string, addWelcomeMessage = true) =>
    api.post<AgentThread>('/agent/threads', { title, add_welcome_message: addWelcomeMessage }),
  getThread: (threadId: string) => api.get<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`),
  renameThread: (threadId: string, title: string) => api.patch<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`, { title }),
  setThreadPinned: (threadId: string, pinned: boolean) => api.patch<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}`, { pinned }),
  deleteThread: (threadId: string, deleteAnalyticsData = false) => api.delete(`/agent/threads/${encodeURIComponent(threadId)}`, { data: { delete_analytics_data: deleteAnalyticsData } }),
  uploadAttachment: (threadId: string, file: { fileName: string; mimeType: string; dataBase64: string }) =>
    api.post<AgentAttachment>(`/agent/threads/${encodeURIComponent(threadId)}/attachments`, file, { timeout: 120000 }),
  deleteAttachment: (threadId: string, attachmentId: string) =>
    api.delete(`/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}`),
  getAttachmentFileUrl: (threadId: string, attachmentId: string) =>
    `/api/agent/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}/file`,
  sendMessage: (threadId: string, content: string, context: {
    attachment_ids?: string[]
    task_references?: Array<{ plan_id: string; platforms?: string[] }>
    mentioned_connectors?: string[]
    mentioned_skills?: string[]
  } = {}, signal?: AbortSignal) =>
    api.post<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}/messages`, { content, ...context }, { timeout: 180000, signal }),
  sendMessageStream: async (threadId: string, content: string, context: {
    attachment_ids?: string[]
    task_references?: Array<{ plan_id: string; platforms?: string[] }>
    mentioned_connectors?: string[]
    mentioned_skills?: string[]
  } = {}, onDelta?: (delta: string) => void, signal?: AbortSignal, onStatus?: (status: { phase: 'web_search' | 'reasoning'; message: string; sources?: any[]; retrieval?: string; analysis_coverage?: any; keywords?: string[] }) => void): Promise<{ data: AgentThread }> => {
    const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, ...context }),
      signal,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.detail || `请求失败（${response.status}）`)
    }
    if (!response.body) throw new Error('浏览器不支持流式响应')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: AgentThread | null = null
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (event.type === 'delta' && typeof event.delta === 'string') onDelta?.(event.delta)
        else if (event.type === 'status' && typeof event.message === 'string') {
          onStatus?.({ phase: event.phase, message: event.message, sources: event.sources, retrieval: event.retrieval, analysis_coverage: event.analysis_coverage, keywords: event.keywords })
        }
        else if (event.type === 'complete') result = event.thread as AgentThread
        else if (event.type === 'error') throw new Error(event.detail || 'AI 消息处理失败')
        else if (event.type === 'stopped') throw new DOMException(event.detail || '已停止生成', 'AbortError')
      }
      if (done) break
    }
    if (!result) throw new Error('AI 流式响应未正常完成')
    return { data: result }
  },
  stopMessage: (threadId: string) =>
    api.post<{ stopped: boolean }>(`/agent/threads/${encodeURIComponent(threadId)}/messages/stop`, {}),
  regenerateMessage: (threadId: string, messageId: string, signal?: AbortSignal) =>
    api.post<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/regenerate`, {}, { timeout: 180000, signal }),
  regenerateMessageStream: async (
    threadId: string,
    messageId: string,
    onDelta?: (delta: string) => void,
    signal?: AbortSignal,
    onStatus?: (status: { phase: 'web_search' | 'reasoning'; message: string; sources?: any[]; retrieval?: string; analysis_coverage?: any; keywords?: string[] }) => void,
  ): Promise<{ data: AgentThread }> => {
    const response = await fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/regenerate/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      throw new Error(payload.detail || `请求失败（${response.status}）`)
    }
    if (!response.body) throw new Error('浏览器不支持流式响应')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: AgentThread | null = null
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (event.type === 'delta' && typeof event.delta === 'string') onDelta?.(event.delta)
        else if (event.type === 'status' && typeof event.message === 'string') {
          onStatus?.({ phase: event.phase, message: event.message, sources: event.sources, retrieval: event.retrieval, analysis_coverage: event.analysis_coverage, keywords: event.keywords })
        }
        else if (event.type === 'complete') result = event.thread as AgentThread
        else if (event.type === 'error') throw new Error(event.detail || 'AI 消息处理失败')
        else if (event.type === 'stopped') throw new DOMException(event.detail || '已停止生成', 'AbortError')
      }
      if (done) break
    }
    if (!result) throw new Error('AI 流式响应未正常完成')
    return { data: result }
  },
  deleteMessagePair: (threadId: string, messageId: string) =>
    api.delete<AgentThread>(`/agent/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`),
  executePlan: (planId: string) => api.post<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}/execute`),
  stopPlan: (planId: string) =>
    api.post<{ stopped: boolean; plan: AgentPlan }>(`/agent/plans/${encodeURIComponent(planId)}/stop`, null, { timeout: 60000 }),
  updatePlan: (planId: string, updates: {
    keywords?: string[]
    analysis?: string[]
    collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom'
    contentEnrichment?: Partial<ContentEnrichmentOptions>
  }) =>
    api.patch<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}`, updates),
  updatePlanAnalysis: (planId: string, analysis: string[]) =>
    api.patch<AgentPlan>(`/agent/plans/${encodeURIComponent(planId)}/analysis`, { analysis }),
  getPlanExportUrl: (planId: string) => `/api/agent/plans/${encodeURIComponent(planId)}/export`,
  getModelProfile: () => api.get<ModelProfile>('/agent/model-profile'),
  getModelProfiles: () => api.get<ModelProfiles>('/agent/model-profiles'),
  saveModelProfile: (profile: Partial<ModelProfile> & { apiKey?: string; clearApiKey?: boolean }) => api.put<ModelProfile>('/agent/model-profile', profile),
  testModelProfile: () => api.post<{ success: boolean; message: string; latency_ms: number }>('/agent/model-profile/test', null, { timeout: 180000 }),
  getMemorySettings: () => api.get<MemorySettings>('/agent/memory-settings'),
  saveMemorySettings: (settings: Partial<MemorySettings>) => api.put<MemorySettings>('/agent/memory-settings', settings),
  getRuntimeSettings: () => api.get<RuntimeSettings>('/agent/runtime-settings'),
  saveRuntimeSettings: (settings: Partial<RuntimeSettings>) => api.put<RuntimeSettings>('/agent/runtime-settings', settings),
  listMemories: () => api.get<{ items: AgentMemory[] }>('/agent/memories'),
  createMemory: (input: { content: string; category?: AgentMemory['category'] }) =>
    api.post<AgentMemory>('/agent/memories', input),
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
  getWindowStatus: () => api.get<{ success: boolean; visible: boolean; has_views?: boolean; can_open?: boolean }>('/browser/window'),
  toggleWindow: (action: 'show' | 'hide' | 'toggle' = 'toggle') =>
    api.post<{ success: boolean; visible: boolean; toggled?: boolean; has_views?: boolean; can_open?: boolean }>('/browser/window', { action }),
}

export default api
