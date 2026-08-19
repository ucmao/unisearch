import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getDatabasePath } from '../database/connection';
import { localEmbedder, LOCAL_EMBEDDING_MODEL } from './local-embedder';

export type RetrievalProvider = 'local' | 'siliconflow' | 'custom';

export const RETRIEVAL_PROVIDERS: RetrievalProvider[] = ['local', 'siliconflow', 'custom'];

export interface RetrievalProfile {
  provider: RetrievalProvider;
  baseUrl: string;
  apiKey?: string;
  apiKeyConfigured: boolean;
  embeddingModel: string;
  rerankerModel: string;
  timeoutMs: number;
}

export interface RetrievalProfiles {
  activeProvider: RetrievalProvider;
  profiles: RetrievalProfile[];
}

interface StoredRetrievalProviderProfile {
  baseUrl: string;
  embeddingModel: string;
  rerankerModel: string;
  apiKey?: string;
  timeoutMs: number;
}

interface StoredRetrievalConfig {
  version: 5;
  activeProvider: RetrievalProvider;
  profiles: Record<RetrievalProvider, StoredRetrievalProviderProfile>;
}

const RETRIEVAL_PROVIDER_DEFAULTS: Record<RetrievalProvider, StoredRetrievalProviderProfile> = {
  local: {
    baseUrl: '',
    embeddingModel: LOCAL_EMBEDDING_MODEL,
    rerankerModel: '',
    timeoutMs: 60000,
  },
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    embeddingModel: 'BAAI/bge-m3',
    rerankerModel: 'BAAI/bge-reranker-v2-m3',
    timeoutMs: 60000,
  },
  custom: {
    baseUrl: '',
    embeddingModel: '',
    rerankerModel: '',
    timeoutMs: 60000,
  },
};

function createDefaultRetrievalConfig(): StoredRetrievalConfig {
  return {
    version: 5,
    activeProvider: 'local',
    profiles: {
      local: { ...RETRIEVAL_PROVIDER_DEFAULTS.local },
      siliconflow: { ...RETRIEVAL_PROVIDER_DEFAULTS.siliconflow },
      custom: { ...RETRIEVAL_PROVIDER_DEFAULTS.custom },
    },
  };
}

function normalizedBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function endpoint(baseUrl: string, resource: 'embeddings' | 'rerank'): string {
  const normalized = normalizedBaseUrl(baseUrl);
  if (normalized.endsWith(`/${resource}`)) return normalized;
  return `${normalized}/${resource}`;
}

function publicApiError(error: any): string {
  const status = Number(error?.response?.status || 0);
  const raw = String(
    error?.response?.data?.message
      || error?.response?.data?.detail
      || error?.message
      || '检索模型服务调用失败',
  );
  if ([401, 403].includes(status)) return 'API Key 无效、无权限或已失效 (401/403)';
  if (status === 404) return 'API 地址或模型名称不存在 (404)';
  if (status === 429) return 'API 请求超出频率限制 (429)';
  if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return '检索模型服务连接超时';
  if (/ENOTFOUND|ECONNREFUSED|network|socket/i.test(raw)) return '无法连接检索模型服务';
  return raw.slice(0, 180);
}

export class RetrievalService {
  constructor(private readonly configFilePath?: string) {}

  private get configPath(): string {
    return this.configFilePath || path.join(path.dirname(getDatabasePath()), 'retrieval-profile.json');
  }

  private readStored(): StoredRetrievalConfig {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      if (parsed?.version === 5 && parsed.profiles && typeof parsed.profiles === 'object') {
        const config = createDefaultRetrievalConfig();
        config.activeProvider = RETRIEVAL_PROVIDERS.includes(parsed.activeProvider) ? parsed.activeProvider : 'local';
        for (const provider of RETRIEVAL_PROVIDERS) {
          const stored = parsed.profiles[provider];
          if (!stored || typeof stored !== 'object') continue;
          config.profiles[provider] = {
            ...config.profiles[provider],
            ...stored,
            baseUrl: normalizedBaseUrl(String(stored.baseUrl ?? config.profiles[provider].baseUrl)),
            embeddingModel: String(stored.embeddingModel ?? config.profiles[provider].embeddingModel).trim(),
            rerankerModel: String(stored.rerankerModel ?? config.profiles[provider].rerankerModel).trim(),
            apiKey: typeof stored.apiKey === 'string' && stored.apiKey.trim() ? stored.apiKey.trim() : undefined,
            timeoutMs: Math.max(5000, Math.min(180000, Number(stored.timeoutMs) || config.profiles[provider].timeoutMs)),
          };
        }
        return config;
      }

      // Backward compatibility for version 4, 3, or flat profiles
      const config = createDefaultRetrievalConfig();
      if (parsed && typeof parsed === 'object') {
        const activeProvider: RetrievalProvider = parsed.provider === 'custom' ? 'custom' : parsed.provider === 'siliconflow' ? 'siliconflow' : 'local';
        config.activeProvider = activeProvider;
        if (activeProvider !== 'local') {
          config.profiles[activeProvider] = {
            baseUrl: normalizedBaseUrl(String(parsed.baseUrl || (activeProvider === 'siliconflow' ? RETRIEVAL_PROVIDER_DEFAULTS.siliconflow.baseUrl : ''))),
            embeddingModel: String(parsed.embeddingModel || (activeProvider === 'siliconflow' ? RETRIEVAL_PROVIDER_DEFAULTS.siliconflow.embeddingModel : '')).trim(),
            rerankerModel: String(parsed.rerankerModel ?? (activeProvider === 'siliconflow' ? RETRIEVAL_PROVIDER_DEFAULTS.siliconflow.rerankerModel : '')).trim(),
            apiKey: typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : undefined,
            timeoutMs: Math.max(5000, Math.min(180000, Number(parsed.timeoutMs) || 60000)),
          };
        }
      }
      return config;
    } catch {
      return createDefaultRetrievalConfig();
    }
  }

  private writeConfig(config: StoredRetrievalConfig): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }

  getProfile(includeSecret = false, requestedProvider?: RetrievalProvider): RetrievalProfile {
    const config = this.readStored();
    const provider = requestedProvider || config.activeProvider;
    const isLocal = provider === 'local';
    const stored = config.profiles[provider] || RETRIEVAL_PROVIDER_DEFAULTS[provider];
    const apiKey = includeSecret ? (stored.apiKey || '') : '';
    return {
      provider,
      baseUrl: isLocal ? '' : stored.baseUrl,
      ...(includeSecret ? { apiKey } : {}),
      apiKeyConfigured: isLocal ? true : Boolean(stored.apiKey),
      embeddingModel: isLocal ? LOCAL_EMBEDDING_MODEL : stored.embeddingModel,
      rerankerModel: isLocal ? '' : stored.rerankerModel,
      timeoutMs: stored.timeoutMs,
    };
  }

  getProfiles(): RetrievalProfiles {
    const config = this.readStored();
    return {
      activeProvider: config.activeProvider,
      profiles: RETRIEVAL_PROVIDERS.map((provider) => this.getProfile(false, provider)),
    };
  }

  saveProfile(input: Partial<RetrievalProfile> & { clearApiKey?: boolean }): RetrievalProfile {
    const config = this.readStored();
    const provider: RetrievalProvider = input.provider === 'local' ? 'local' : input.provider === 'custom' ? 'custom' : input.provider === 'siliconflow' ? 'siliconflow' : config.activeProvider;
    const previous = config.profiles[provider] || { ...RETRIEVAL_PROVIDER_DEFAULTS[provider] };
    const inputApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';

    const nextBaseUrl = provider === 'local' ? '' : normalizedBaseUrl(input.baseUrl === undefined ? previous.baseUrl : String(input.baseUrl));
    const nextEmbeddingModel = provider === 'local' ? LOCAL_EMBEDDING_MODEL : String(input.embeddingModel === undefined ? previous.embeddingModel : input.embeddingModel).trim();
    const nextRerankerModel = provider === 'local' ? '' : String(input.rerankerModel === undefined ? previous.rerankerModel : input.rerankerModel).trim();
    const nextTimeoutMs = Math.max(5000, Math.min(180000, Number(input.timeoutMs) || previous.timeoutMs || 60000));

    let nextApiKey: string | undefined = previous.apiKey;
    if (input.clearApiKey) {
      nextApiKey = undefined;
    } else if (inputApiKey) {
      nextApiKey = inputApiKey;
    }

    if (provider !== 'local' && (!nextBaseUrl || !nextEmbeddingModel)) {
      throw new Error('云端服务 API 地址和向量模型名称不能为空');
    }

    config.activeProvider = provider;
    config.profiles[provider] = {
      baseUrl: nextBaseUrl,
      embeddingModel: nextEmbeddingModel,
      rerankerModel: nextRerankerModel,
      apiKey: nextApiKey,
      timeoutMs: nextTimeoutMs,
    };

    this.writeConfig(config);
    return this.getProfile(false, provider);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const profile = this.getProfile(true);

    if (profile.provider === 'local') {
      return await localEmbedder.embed(texts);
    }

    if (!profile.apiKey) {
      throw new Error('尚未配置知识检索 API Key');
    }
    try {
      const response = await axios.post(endpoint(profile.baseUrl, 'embeddings'), {
        model: profile.embeddingModel,
        input: texts,
        encoding_format: 'float',
      }, {
        headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
        timeout: profile.timeoutMs,
      });
      const rows = Array.isArray(response.data?.data) ? response.data.data : [];
      const ordered = rows
        .map((row: any, offset: number) => ({ index: Number.isInteger(row?.index) ? row.index : offset, embedding: row?.embedding }))
        .sort((left: any, right: any) => left.index - right.index);
      if (ordered.length !== texts.length || ordered.some((row: any) => !Array.isArray(row.embedding) || !row.embedding.length)) {
        throw new Error('Embedding API 返回的向量数量或格式无效');
      }
      const vectors = ordered.map((row: any) => row.embedding.map(Number));
      const dimensions = vectors[0].length;
      if (!dimensions || vectors.some((vector: number[]) => vector.length !== dimensions || vector.some((value) => !Number.isFinite(value)))) {
        throw new Error('Embedding API 返回的向量维度无效');
      }
      return vectors;
    } catch (error: any) {
      if (String(error?.message || '').startsWith('Embedding API 返回')) throw error;
      throw new Error(publicApiError(error), { cause: error });
    }
  }

  async rerank(query: string, documents: string[], topN: number): Promise<Array<{ index: number; score: number }>> {
    const profile = this.getProfile(true);
    if (!profile.rerankerModel || !documents.length) {
      return documents.map((_, index) => ({ index, score: 0 })).slice(0, topN);
    }
    if (profile.provider === 'local') {
      return documents.map((_, index) => ({ index, score: 0 })).slice(0, topN);
    }
    if (!profile.apiKey) throw new Error('尚未配置知识检索 API Key');
    try {
      const response = await axios.post(endpoint(profile.baseUrl, 'rerank'), {
        model: profile.rerankerModel,
        query,
        documents,
        top_n: Math.max(1, Math.min(documents.length, topN)),
        return_documents: false,
      }, {
        headers: { Authorization: `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
        timeout: profile.timeoutMs,
      });
      const results = Array.isArray(response.data?.results) ? response.data.results : [];
      const ranked = results.map((row: any) => ({
        index: Number(row?.index),
        score: Number(row?.relevance_score),
      })).filter((row: any) => Number.isInteger(row.index) && row.index >= 0 && row.index < documents.length && Number.isFinite(row.score));
      if (!ranked.length) throw new Error('Reranker API 返回的排序结果无效');
      return ranked.slice(0, topN);
    } catch (error: any) {
      if (String(error?.message || '').startsWith('Reranker API 返回')) throw error;
      throw new Error(publicApiError(error), { cause: error });
    }
  }

  async testConnection(): Promise<{ success: true; message: string; latency_ms: number; dimensions: number; reranker_tested: boolean }> {
    const profile = this.getProfile(false);
    if (profile.provider === 'local') {
      const localRes = await localEmbedder.test();
      return {
        success: true,
        message: localRes.message,
        latency_ms: localRes.latency_ms,
        dimensions: localRes.dimensions,
        reranker_tested: false,
      };
    }
    if (!profile.apiKeyConfigured) {
      throw new Error('尚未配置 API Key，请先填写 Key 后再测试连接');
    }
    const started = Date.now();
    const vectors = await this.embed(['UniSearch 检索连接测试']);
    const hasRerank = Boolean(profile.rerankerModel.trim());
    if (hasRerank) {
      await this.rerank('苹果', ['苹果手机', '香蕉水果'], 1);
    }
    return {
      success: true,
      message: hasRerank ? '向量与重排模型连接成功' : '向量模型连接成功',
      latency_ms: Date.now() - started,
      dimensions: vectors[0].length,
      reranker_tested: hasRerank,
    };
  }
}

export const retrievalService = new RetrievalService();
