export type ConnectorCategory = 'social_media' | 'ai_search' | 'web_search' | 'complaint' | 'recruitment';

export type ConnectorCapabilityId =
  | 'keyword_search'
  | 'content_detail'
  | 'creator_profile'
  | 'comments'
  | 'url_resolve';

export type ConnectorFieldType = 'string' | 'number' | 'boolean' | 'select' | 'string_list' | 'secret';

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
  legacyConfigKey?: string;
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
  legacyCrawlerType: 'search' | 'detail' | 'creator';
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
    methods: Array<'qrcode' | 'cookie'>;
    description: string;
  };
  runtime: {
    engine: 'playwright';
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
  login_type: 'qrcode' | 'cookie' | 'phone';
  crawler_type: 'search' | 'detail' | 'creator';
  keywords: string;
  specified_ids?: string;
  creator_ids?: string;
  start_page: number;
  enable_comments: boolean;
  enable_sub_comments: boolean;
  cookies: string;
  headless: boolean;
  loop_execution: boolean;
  task_id?: string;
  task_title?: string;
}
