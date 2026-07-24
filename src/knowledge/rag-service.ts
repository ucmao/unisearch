import { knowledgeIndex } from './knowledge-index';
import { modelService } from '../server/services/ModelService';

export interface RagAnswer {
  answer: string;
  sources: Array<{
    id: string;
    documentId: string;
    title: string;
    source: string;
    sourceUrl?: string;
    excerpt: string;
    score: number;
  }>;
}

export class RagService {
  constructor(
    private readonly index = knowledgeIndex,
    private readonly model = modelService,
  ) {}

  async answer(question: string, options: { workflowId?: string; threadId?: string; limit?: number } = {}): Promise<RagAnswer> {
    const results = this.index.search(question, options.limit || 8, options.workflowId, options.threadId);
    const sources = results.map((result, index) => ({
      id: `S${index + 1}`,
      documentId: result.documentId,
      title: result.title || '未命名资料',
      source: result.source,
      sourceUrl: result.sourceUrl,
      excerpt: result.content.slice(0, 500),
      score: result.score,
    }));
    if (!sources.length) return { answer: '知识库中没有检索到可以支持回答的资料。', sources: [] };

    const profile = this.model.getProfile(false);
    if (!profile.apiKeyConfigured) {
      return {
        answer: [
          '当前未配置可用的 AI 模型，因此先返回最相关的知识库片段：',
          '',
          ...sources.slice(0, 5).map((source) => `- [${source.id}] ${source.title}：${source.excerpt.slice(0, 180)}`),
        ].join('\n'),
        sources,
      };
    }

    const materials = {
      texts: sources.map((source) => ({
        label: `[${source.id}] ${source.title}`,
        content: `${source.excerpt}\n来源：${source.sourceUrl || source.source}`,
      })),
      images: [],
    };
    const answer = await this.model.converse([
      {
        role: 'user',
        content: `${question}\n\n请只根据提供的知识库资料回答。每个关键事实后使用 [S1]、[S2] 格式标注来源；资料不足时明确说明，不要补造。`,
      },
    ], { materials });
    return { answer, sources };
  }
}

export const ragService = new RagService();
