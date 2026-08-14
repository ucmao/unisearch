import { knowledgeIndex, type KnowledgeSearchOptions } from './knowledge-index';
import { modelService } from '../server/services/ModelService';

export interface RagAnswer {
  answer: string;
  retrieval: {
    mode: 'lexical' | 'semantic' | 'hybrid' | 'hybrid_reranked';
    warning?: string;
  };
  sources: Array<{
    id: string;
    chunkId: string;
    documentId: string;
    title: string;
    source: string;
    kind: string;
    keyword?: string;
    subject: { type: string; id?: string; name?: string };
    sourceUrl?: string;
    excerpt: string;
    content?: string;
    score: number;
  }>;
}

export function buildReferencesSection(sources: RagAnswer['sources']): string {
  if (!sources || sources.length === 0) return '';

  const listItems = sources.map((s, idx) => {
    const title = (s.title || '未命名资料').replace(/\r?\n/g, ' ');
    const link = s.sourceUrl ? `[${title}](${s.sourceUrl})` : `${title} [${s.id}]`;
    return `${idx + 1}. ${link} · ${s.source}/${s.kind}`;
  });

  return [
    '',
    '<details>',
    `<summary>检索知识库，参考 ${sources.length} 篇资料 ›</summary>`,
    '',
    ...listItems,
    '</details>',
  ].join('\n');
}

export class RagService {
  constructor(
    private readonly index = knowledgeIndex,
    private readonly model = modelService,
  ) {}

  async answer(
    question: string,
    options: KnowledgeSearchOptions = {},
    onDelta?: (delta: string) => void,
  ): Promise<RagAnswer> {
    const retrieval = await this.index.searchDetailed(question, { ...options, limit: options.limit || 8 });
    const results = retrieval.items;
    const sources = results.map((result, index) => ({
      id: `S${index + 1}`,
      chunkId: result.chunkId,
      documentId: result.documentId,
      title: result.title || '未命名资料',
      source: result.source,
      kind: result.kind,
      keyword: result.keyword,
      subject: result.subject,
      sourceUrl: result.sourceUrl,
      content: result.content,
      excerpt: result.content.length <= 300 ? result.content : `${result.content.slice(0, 300)}...`,
      score: result.score,
    }));
    if (!sources.length) {
      const warning = retrieval.warning ? `\n\n> ${retrieval.warning}` : '';
      return { answer: `知识库中没有检索到可以支持回答的资料。${warning}`, sources: [], retrieval: { mode: retrieval.mode, warning: retrieval.warning } };
    }

    const referencesSection = buildReferencesSection(sources);

    const profile = this.model.getProfile(false);
    if (!profile.apiKeyConfigured) {
      return {
        answer: [
          '当前未配置可用的 AI 模型，因此先返回最相关的知识库片段：',
          '',
          ...sources.slice(0, 5).map((source) => `- [${source.id}] ${source.title}：${source.excerpt.slice(0, 180)}`),
          referencesSection,
        ].join('\n'),
        sources,
        retrieval: { mode: retrieval.mode, warning: retrieval.warning },
      };
    }

    // Allocate dynamic context budget across materials (up to 12,000 characters)
    const MAX_TOTAL_CONTEXT_BUDGET = 12000;
    let accumulatedChars = 0;
    const texts = sources.flatMap((source) => {
      if (accumulatedChars >= MAX_TOTAL_CONTEXT_BUDGET) return [];
      const remainingBudget = MAX_TOTAL_CONTEXT_BUDGET - accumulatedChars;
      const fullText = source.content || source.excerpt;
      const textContent = fullText.length <= remainingBudget
        ? fullText
        : fullText.slice(0, remainingBudget);
      accumulatedChars += textContent.length;
      return [{
        label: `[${source.id}] ${source.title}`,
        content: [
          textContent,
          `平台：${source.source}`,
          `类型：${source.kind}`,
          `主体：${source.subject.name || source.subject.id || '未知'} (${source.subject.type})`,
          source.keyword ? `关键词：${source.keyword}` : '',
          `来源：${source.sourceUrl || source.source}`,
        ].filter(Boolean).join('\n'),
      }];
    });

    const materials = {
      texts,
      images: [],
    };
    const rawAnswer = await this.model.converse([
      {
        role: 'user',
        content: `${question}\n\n请只根据提供的知识库资料回答。每个关键事实后使用 [S1]、[S2] 格式标注来源；资料不足时明确说明，不要补造。`,
      },
    ], { materials, onDelta });

    const answer = retrieval.warning ? `${rawAnswer.trim()}\n\n> ${retrieval.warning}` : rawAnswer.trim();
    return { answer, sources, retrieval: { mode: retrieval.mode, warning: retrieval.warning } };
  }
}

export const ragService = new RagService();
