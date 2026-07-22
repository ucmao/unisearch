import { CONNECTOR_MANIFESTS } from './manifests';
import type { ConnectorCapability, ConnectorManifest, ConnectorStartRequest } from './types';

const manifests = new Map(CONNECTOR_MANIFESTS.map((manifest) => [manifest.id, manifest]));

export function listConnectorManifests(): ConnectorManifest[] {
  return CONNECTOR_MANIFESTS;
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
  return manifest.capabilities[0];
}

export function normalizeConnectorRequest(input: ConnectorStartRequest): ConnectorStartRequest {
  const connectorId = String(input.connector_id || input.platform || '');
  const manifest = getConnectorManifest(connectorId);
  if (!manifest) throw new Error(`Unsupported connector: ${connectorId}`);
  const capability = getConnectorCapability(manifest, input);
  if (!capability) throw new Error(`${manifest.name} requires a supported capability`);
  let loginType = input.login_type;
  if (!manifest.auth.required || manifest.auth.methods.includes('none')) {
    loginType = 'none';
  } else if (!loginType || !manifest.auth.methods.includes(loginType as 'qrcode' | 'cookie' | 'none')) {
    loginType = manifest.auth.methods[0] as 'qrcode' | 'cookie' | 'none';
  }
  if (!manifest.auth.methods.includes(loginType as 'qrcode' | 'cookie' | 'none')) {
    throw new Error(`${manifest.name} does not support login method: ${loginType}`);
  }

  const options = input.connector_options || {};
  const normalized: ConnectorStartRequest = {
    ...input,
    platform: connectorId,
    connector_id: connectorId,
    capability: capability.id,
    crawler_type: capability.runtimeMode,
    login_type: loginType as 'qrcode' | 'cookie' | 'none',
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
  if (normalized.enable_sub_comments && !normalized.enable_comments) normalized.enable_sub_comments = false;
  return normalized;
}

export function connectorLabels(): Record<string, string> {
  return Object.fromEntries(CONNECTOR_MANIFESTS.map((manifest) => [manifest.id, manifest.name]));
}

export function connectorCatalogForAI(): string {
  return CONNECTOR_MANIFESTS.map((manifest) => {
    const capabilities = manifest.capabilities.map((capability) => {
      const inputs = capability.inputFields.map((field) => `${field.key}:${field.type}${field.required ? '(必填)' : ''}`).join('、') || '无额外参数';
      const outputs = capability.outputFields.map((field) => field.key).join('、');
      return `${capability.id}（${capability.label}；输入：${inputs}；输出类型：${capability.outputType}[${outputs}]；边界：${capability.limitations.join('；')}）`;
    }).join('；');
    return `- ${manifest.id}=${manifest.name}：${manifest.description} 能力：${capabilities}`;
  }).join('\n');
}
