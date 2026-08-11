import { z } from 'zod';
import { directWebReadService } from '../services/DirectWebReadService';
import { liveSearchService } from '../services/LiveSearchService';
import { knowledgeIndex } from '../../knowledge/knowledge-index';
import { AgentToolExecutor, AgentToolRegistry } from './AgentToolRegistry';
import {
  ReadOnlyPolicyHook,
  RetryPolicyHook,
  SensitiveDataRedactionHook,
  ToolAuditHook,
} from './AgentToolHooks';

export interface KnowledgeToolEvidence {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  source: string;
  kind: string;
  score: number;
}

export const agentToolRegistry = new AgentToolRegistry();

agentToolRegistry.register({
  name: 'live_search',
  description: '对公开网页执行一次只读实时检索，返回临时证据。',
  readOnly: true,
  inputSchema: z.object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(20).default(8),
    readMode: z.enum(['snippet', 'auto']).default('snippet'),
    maxReadItems: z.number().int().min(0).max(10).default(0),
  }).strict(),
  execute: (input, context) => liveSearchService.search(input.query, {
    limit: input.limit,
    signal: context.signal,
    readMode: input.readMode,
    maxReadItems: input.maxReadItems,
  }),
  summarizeInput: (input) => `query=${JSON.stringify(input.query)}，limit=${input.limit}，readMode=${input.readMode}`,
  summarizeOutput: (output) => `检索到 ${output.length} 条临时证据`,
});

agentToolRegistry.register({
  name: 'direct_web_read',
  description: '读取用户明确提供的公开网页 URL，返回临时正文。',
  readOnly: true,
  inputSchema: z.object({
    urls: z.array(z.string().url()).min(1).max(3),
    timeoutMs: z.number().int().min(1_000).max(30_000).default(20_000),
  }).strict(),
  execute: (input, context) => directWebReadService.read(input.urls, {
    timeoutMs: input.timeoutMs,
    signal: context.signal,
  }),
  summarizeInput: (input) => `读取 ${input.urls.length} 个网页 URL`,
  summarizeOutput: (output) => `读取成功 ${output.articles.length} 个，失败 ${output.failures.length} 个`,
});

agentToolRegistry.register({
  name: 'knowledge_query',
  description: '查询 UniSearch 本地知识库中的已采集资料，不修改索引或文档。',
  readOnly: true,
  inputSchema: z.object({
    query: z.string().trim().min(1).max(300),
    limit: z.number().int().min(1).max(12).default(8),
    scope: z.enum(['global', 'thread']).default('thread'),
  }).strict(),
  execute: async (input, context): Promise<KnowledgeToolEvidence[]> => {
    const items = await knowledgeIndex.search(input.query, {
      limit: input.limit,
      ...(input.scope === 'thread' ? { threadId: context.threadId } : {}),
    });
    return items.map((item) => ({
      chunkId: item.chunkId,
      documentId: item.documentId,
      title: item.title,
      content: item.content.slice(0, 2_000),
      sourceUrl: item.sourceUrl,
      source: item.source,
      kind: item.kind,
      score: item.score,
    }));
  },
  summarizeInput: (input) => `query=${JSON.stringify(input.query)}，scope=${input.scope}，limit=${input.limit}`,
  summarizeOutput: (output) => `知识库返回 ${output.length} 条证据`,
});

export const agentToolExecutor = new AgentToolExecutor(agentToolRegistry, [
  new ReadOnlyPolicyHook(),
  new SensitiveDataRedactionHook(),
  new ToolAuditHook(),
  new RetryPolicyHook(),
]);
