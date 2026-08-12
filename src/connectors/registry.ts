import { CONNECTOR_MANIFESTS } from './manifests';
import type { ConnectorBudgetModel, ConnectorCapability, ConnectorManifest, ConnectorStartRequest } from './types';

const manifests = new Map(CONNECTOR_MANIFESTS.map((manifest) => [manifest.id, manifest]));

export function listConnectorManifests(): ConnectorManifest[] {
  return CONNECTOR_MANIFESTS;
}

export function listWebSearchConnectorIds(): string[] {
  return CONNECTOR_MANIFESTS
    .filter((connector) => connector.category === 'web_search' && connector.searchSurfaces !== undefined)
    .map((connector) => connector.id);
}

export function listLiveSearchConnectorIds(): string[] {
  return CONNECTOR_MANIFESTS
    .filter((connector) => connector.category === 'web_search' && connector.searchSurfaces?.liveSearch)
    .map((connector) => connector.id);
}

/**
 * 平台 id → 中文名的唯一来源。名称只在 CONNECTOR_MANIFESTS 里写一次，
 * 后端各处从这里取；前端通过 /api/config/platforms 拿同一份数据。
 * 以前每个展示层各抄一张表，加平台就要改八处，toutiao 正是这样漏掉的。
 */
export const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  CONNECTOR_MANIFESTS.map((manifest) => [manifest.id, manifest.name]),
);

export function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] || id;
}

export function getConnectorManifest(id: string): ConnectorManifest | undefined {
  return manifests.get(id);
}

export function getConnectorCapability(manifest: ConnectorManifest, request: ConnectorStartRequest): ConnectorCapability | undefined {
  if (request.capability) {
    return manifest.capabilities.find((capability) => capability.id === request.capability);
  }
  if (request.crawler_type === 'search') {
    return manifest.capabilities.find((capability) => capability.id === 'keyword_search');
  }
  if (request.crawler_type === 'creator') {
    return manifest.capabilities.find((capability) => capability.id === 'creator_profile');
  }
  return manifest.capabilities.find((capability) => capability.id === 'content_detail')
    || manifest.capabilities.find((capability) => capability.id === 'url_resolve')
    || manifest.capabilities[0];
}

export function normalizeConnectorRequest(input: ConnectorStartRequest): ConnectorStartRequest {
  if ('cookies' in (input as object)) throw new Error('Unsupported connector field: cookies');
  if (input.login_type && input.login_type !== 'qrcode' && input.login_type !== 'none') {
    throw new Error(`Unsupported login method: ${String(input.login_type)}`);
  }
  const connectorId = String(input.connector_id || input.platform || '');
  const manifest = getConnectorManifest(connectorId);
  if (!manifest) throw new Error(`Unsupported connector: ${connectorId}`);
  const capability = getConnectorCapability(manifest, input);
  if (!capability) throw new Error(`${manifest.name} requires a supported capability`);
  const loginType = manifest.auth.required ? 'qrcode' : 'none';

  const options = input.connector_options || {};
  const normalized: ConnectorStartRequest = {
    ...input,
    platform: connectorId,
    connector_id: connectorId,
    capability: capability.id,
    crawler_type: capability.runtimeMode,
    login_type: loginType,
    connector_options: options,
  };

  for (const field of capability.inputFields) {
    const raw = options[field.key] ?? (field.runtimeConfigKey ? (input as any)[field.runtimeConfigKey] : undefined);
    const value = raw === undefined ? field.default : raw;
    if (field.required && (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0))) {
      throw new Error(`${manifest.name} missing required parameter: ${field.label}`);
    }
    if (value === undefined || !field.runtimeConfigKey) continue;
    if (field.type === 'number') {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) throw new Error(`${field.label} must be a number`);
      if (field.min !== undefined && numberValue < field.min) throw new Error(`${field.label} must be >= ${field.min}`);
      if (field.max !== undefined && numberValue > field.max) throw new Error(`${field.label} must be <= ${field.max}`);
      (normalized as any)[field.runtimeConfigKey] = numberValue;
    } else if (field.type === 'string_list') {
      (normalized as any)[field.runtimeConfigKey] = Array.isArray(value) ? value.join(',') : String(value);
    } else {
      (normalized as any)[field.runtimeConfigKey] = value;
    }
  }
  return normalized;
}

export function connectorLabels(): Record<string, string> {
  return Object.fromEntries(CONNECTOR_MANIFESTS.map((manifest) => [manifest.id, manifest.name]));
}

const BUDGET_MODEL_NOTES: Record<ConnectorBudgetModel, string> = {
  scroll_count: '采集量由最大条数控制（页面自动滚动或翻页直到达标），指定起始页无效',
  true_pagination: '真实分页采集，采集量由最大条数控制，可指定起始页跳过前若干页',
  fixed_per_keyword: '一个关键词固定产出一条结果，没有翻页与详情页概念，采集深度对其无影响',
  single_target: '按指定 ID 或链接定点采集，采集深度只影响是否连带采集评论（含回复），不影响条数',
};

export function connectorCatalogForAI(): string {
  return CONNECTOR_MANIFESTS.map((manifest) => {
    const capabilities = manifest.capabilities.map((capability) => {
      const inputs = capability.inputFields.map((field) => `${field.key}:${field.type}${field.required ? '(必填)' : ''}`).join('、') || '无额外参数';
      const outputs = capability.outputFields.map((field) => field.key).join('、');
      return `${capability.id}（${capability.label}；输入：${inputs}；输出类型：${capability.outputType}[${outputs}]；采集模型：${BUDGET_MODEL_NOTES[capability.budgetModel]}；边界：${capability.limitations.join('；')}）`;
    }).join('；');
    return `- ${manifest.id}=${manifest.name}：${manifest.description} 能力：${capabilities}`;
  }).join('\n');
}
