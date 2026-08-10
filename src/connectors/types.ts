export type ConnectorCategory = 'social_media' | 'ai_web_qa' | 'web_search' | 'complaint_platform' | 'job_platform' | 'utility';

export type ConnectorCapabilityId =
  | 'keyword_search'
  | 'content_detail'
  | 'creator_profile'
  | 'comments'
  | 'url_resolve';

export type ConnectorFieldType = 'string' | 'number' | 'boolean' | 'select' | 'string_list' | 'secret';

/**
 * How a capability's "collection depth" translates into concrete crawl parameters.
 * - scroll_count: infinite-scroll or cursor-driven; only item count matters, start_page is not honored.
 * - true_pagination: real page-numbered fetch; start_page changes which page is fetched first.
 * - fixed_per_keyword: no depth concept — output count equals input keyword count.
 * - single_target: fetch by explicit id/link; depth only affects whether comments (with their replies) are pulled alongside, not volume.
 */
export type ConnectorBudgetModel = 'scroll_count' | 'true_pagination' | 'fixed_per_keyword' | 'single_target';

export interface ConnectorFieldOption {
  value: string;
  label: string;
}

export interface ConnectorInputField {
  key: string;
  label: string;
  description: string;
  type: ConnectorFieldType;
  required?: boolean;
  default?: string | number | boolean | string[];
  min?: number;
  max?: number;
  options?: ConnectorFieldOption[];
  runtimeConfigKey?: string;
}

export interface ConnectorOutputField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'string_list' | 'object';
  required?: boolean;
}

export interface ConnectorCapability {
  id: ConnectorCapabilityId;
  label: string;
  description: string;
  runtimeMode: 'search' | 'detail' | 'creator';
  budgetModel: ConnectorBudgetModel;
  /**
   * Items per depth level for this specific capability. Optional: capabilities
   * that omit it fall back to a share of the max_items ceiling. Values above
   * that ceiling are clamped, never passed through — normalizeConnectorRequest
   * rejects them and would fail the entire step.
   */
  depthBudget?: Partial<Record<'quick' | 'standard' | 'deep', number>>;
  inputFields: ConnectorInputField[];
  outputType: string;
  outputFields: ConnectorOutputField[];
  limitations: string[];
}

export interface ConnectorManifest {
  id: string;
  version: string;
  name: string;
  icon: string;
  category: ConnectorCategory;
  description: string;
  auth: {
    required: boolean;
    methods: Array<'qrcode' | 'none'>;
    description: string;
  };
  runtime: {
    engine: 'playwright' | 'http' | 'hybrid';
    isolatedProcess: boolean;
    supportsHeadless: boolean;
  };
  capabilities: ConnectorCapability[];
}

export interface ConnectorStartRequest {
  platform: string;
  connector_id?: string;
  capability?: ConnectorCapabilityId;
  connector_options?: Record<string, unknown>;
  login_type?: 'qrcode' | 'none';
  crawler_type: 'search' | 'detail' | 'creator';
  keywords: string;
  specified_ids?: string;
  creator_ids?: string;
  start_page: number;
  collection_depth?: 'quick' | 'standard' | 'deep' | 'custom';
  enable_comments: boolean;
  headless: boolean;
  loop_execution: boolean;
  thread_id?: string;
  workflow_id?: string;
  task_title?: string;
}
