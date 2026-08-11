import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { getDatabasePath } from '../database/connection';

export type RetrievalProvider = 'siliconflow' | 'custom';

export interface RetrievalProfile {
  provider: RetrievalProvider;
  baseUrl: string;
  apiKey?: string;
  apiKeyConfigured: boolean;
  embeddingModel: string;
  rerankerEnabled: boolean;
  rerankerBaseUrl: string;
  rerankerModel: string;
  timeoutMs: number;
}

interface StoredRetrievalProfile extends Omit<RetrievalProfile, 'apiKeyConfigured'> {
  version: 1;
}

const DEFAULT_PROFILE: StoredRetrievalProfile = {
  version: 1,
  provider: 'siliconflow',
  baseUrl: 'https://api.siliconflow.cn/v1',
  embeddingModel: 'BAAI/bge-m3',
  rerankerEnabled: false,
  rerankerBaseUrl: 'https://api.siliconflow.cn/v1',
  rerankerModel: 'BAAI/bge-reranker-v2-m3',
  timeoutMs: 60000,
};

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
  if ([401, 403].includes(status)) return 'API Key 无效、无权限或已失效';
  if (status === 404) return 'API 地址或模型名称不存在';
  if (status === 429) return 'API 请求超出频率限制';
  if (/timeout|timed out|ETIMEDOUT/i.test(raw)) return '检索模型服务连接超时';
  if (/ENOTFOUND|ECONNREFUSED|network|socket/i.test(raw)) return '无法连接检索模型服务';
  return raw.slice(0, 180);
}

export class RetrievalService {
  constructor(private readonly configFilePath?: string) {}

  private get configPath(): string {
    return this.configFilePath || path.join(path.dirname(getDatabasePath()), 'retrieval-profile.json');
  }

  private readStored(): StoredRetrievalProfile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<StoredRetrievalProfile>;
      if (parsed.version !== 1) return { ...DEFAULT_PROFILE };
      return {
        ...DEFAULT_PROFILE,
        ...parsed,
        version: 1,
        provider: parsed.provider === 'custom' ? 'custom' : 'siliconflow',
        baseUrl: normalizedBaseUrl(String(parsed.baseUrl || DEFAULT_PROFILE.baseUrl)),
        embeddingModel: String(parsed.embeddingModel || DEFAULT_PROFILE.embeddingModel).trim(),
        rerankerBaseUrl: normalizedBaseUrl(String(parsed.rerankerBaseUrl || parsed.baseUrl || DEFAULT_PROFILE.rerankerBaseUrl)),
        rerankerModel: String(parsed.rerankerModel || DEFAULT_PROFILE.rerankerModel).trim(),
        timeoutMs: Math.max(5000, Math.min(180000, Number(parsed.timeoutMs) || DEFAULT_PROFILE.timeoutMs)),
        apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
      };
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }

  getProfile(includeSecret = false): RetrievalProfile {
    const stored = this.readStored();
    return {
      provider: stored.provider,
      baseUrl: stored.baseUrl,
      ...(includeSecret ? { apiKey: stored.apiKey || '' } : {}),
      apiKeyConfigured: Boolean(stored.apiKey),
      embeddingModel: stored.embeddingModel,
      rerankerEnabled: stored.rerankerEnabled,
      rerankerBaseUrl: stored.rerankerBaseUrl,
      rerankerModel: stored.rerankerModel,
      timeoutMs: stored.timeoutMs,
    };
  }

  saveProfile(input: Partial<RetrievalProfile> & { clearApiKey?: boolean }): RetrievalProfile {
    const previous = this.readStored();
    const provider = input.provider === 'custom' ? 'custom' : input.provider === 'siliconflow' ? 'siliconflow' : previous.provider;
    const inputApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const next: StoredRetrievalProfile = {
      version: 1,
      provider,
      baseUrl: normalizedBaseUrl(input.baseUrl === undefined ? previous.baseUrl : String(input.baseUrl)),
      embeddingModel: String(input.embeddingModel === undefined ? previous.embeddingModel : input.embeddingModel).trim(),
      rerankerEnabled: input.rerankerEnabled === undefined ? previous.rerankerEnabled : Boolean(input.rerankerEnabled),
      rerankerBaseUrl: normalizedBaseUrl(input.rerankerBaseUrl === undefined ? previous.rerankerBaseUrl : String(input.rerankerBaseUrl)),
      rerankerModel: String(input.rerankerModel === undefined ? previous.rerankerModel : input.rerankerModel).trim(),
      timeoutMs: Math.max(5000, Math.min(180000, Number(input.timeoutMs) || previous.timeoutMs)),
      apiKey: input.clearApiKey ? undefined : inputApiKey || previous.apiKey,
    };
    if (!next.baseUrl || !next.embeddingModel) throw new Error('Embedding API 地址和模型名称不能为空');
    if (next.rerankerEnabled && (!next.rerankerBaseUrl || !next.rerankerModel)) {
      throw new Error('启用重排时，Reranker API 地址和模型名称不能为空');
    }
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(next, null, 2), { mode: 0o600 });
    return this.getProfile(false);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const profile = this.getProfile(true);
    if (!profile.apiKey) throw new Error('尚未配置语义检索 API Key');
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
    if (!profile.rerankerEnabled || !documents.length) {
      return documents.map((_, index) => ({ index, score: 0 })).slice(0, topN);
    }
    if (!profile.apiKey) throw new Error('尚未配置重排 API Key');
    try {
      const response = await axios.post(endpoint(profile.rerankerBaseUrl, 'rerank'), {
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
    const started = Date.now();
    const vectors = await this.embed(['UniSearch 语义检索连接测试']);
    const profile = this.getProfile(false);
    if (profile.rerankerEnabled) await this.rerank('苹果', ['苹果手机', '香蕉水果'], 1);
    return {
      success: true,
      message: profile.rerankerEnabled ? 'Embedding 与 Reranker 连接成功' : 'Embedding 连接成功',
      latency_ms: Date.now() - started,
      dimensions: vectors[0].length,
      reranker_tested: profile.rerankerEnabled,
    };
  }
}

export const retrievalService = new RetrievalService();
