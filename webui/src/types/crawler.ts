export interface CrawlerConfig {
  platform: string
  connector_id?: string
  capability?: ConnectorCapabilityId
  connector_options?: Record<string, unknown>
  login_type: string
  crawler_type: string
  keywords: string
  specified_ids: string  // 详情模式下的帖子/视频ID
  creator_ids: string    // 创作者模式下的创作者ID
  start_page: number
  enable_comments: boolean
  enable_sub_comments: boolean
  cookies: string
  headless: boolean
  loop_execution: boolean
  thread_id?: string
  plan_id?: string
  task_title?: string
}

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

export interface LogEntry {
  id: number
  timestamp: string
  level: 'info' | 'warning' | 'error' | 'success' | 'debug'
  message: string
  platform?: string
  run_id?: string
  thread_id?: string
  retry_count?: number
  max_retries?: number
  delay_sec?: number
  retry_reason?: string
}

export interface Platform {
  value: string
  label: string
  icon: string
  category?: ConnectorCategory
  capabilities?: ConnectorCapabilityId[]
}

export interface ConfigOption {
  value: string
  label: string
}

export type ConnectorCategory = 'social_media' | 'ai_web_qa' | 'web_search' | 'complaint_platform' | 'job_platform' | 'utility'
export type ConnectorCapabilityId = 'keyword_search' | 'content_detail' | 'creator_profile' | 'comments' | 'url_resolve'
export type ConnectorFieldType = 'string' | 'number' | 'boolean' | 'select' | 'string_list' | 'secret'

export interface ConnectorInputField {
  key: string
  label: string
  description: string
  type: ConnectorFieldType
  required?: boolean
  default?: string | number | boolean | string[]
  min?: number
  max?: number
  options?: Array<{ value: string; label: string }>
  runtimeConfigKey?: string
}

export interface ConnectorOutputField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'string_list' | 'object'
  required?: boolean
}

export interface ConnectorCapability {
  id: ConnectorCapabilityId
  label: string
  description: string
  runtimeMode: 'search' | 'detail' | 'creator'
  inputFields: ConnectorInputField[]
  outputType: string
  outputFields: ConnectorOutputField[]
  limitations: string[]
}

export interface ConnectorManifest {
  id: string
  version: string
  name: string
  icon: string
  category: ConnectorCategory
  description: string
  auth: {
    required: boolean
    methods: Array<'qrcode' | 'cookie'>
    description: string
  }
  runtime: {
    engine: 'playwright'
    isolatedProcess: boolean
    supportsHeadless: boolean
  }
  capabilities: ConnectorCapability[]
}
