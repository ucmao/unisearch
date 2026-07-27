import { createHash } from 'crypto';
import type { CanonicalDocument } from '../core/documents/canonical';

export const KNOWLEDGE_PROJECTOR_VERSION = '2.0.0';

export interface KnowledgeProjectionMetadata {
  schemaVersion: 2;
  projectorVersion: string;
  documentId: string;
  canonicalKey: string;
  contentHash: string;
  kind: string;
  platform: string;
  originalPlatform?: string;
  sourceItemId?: string;
  parentSourceItemId?: string;
  sourceUrl?: string;
  keyword?: string;
  rank?: number;
  title: string;
  summary: string;
  subject: CanonicalDocument['subject'];
  publishedAt?: string | number;
  sourceUpdatedAt?: string | number;
  fetchedAt: string;
  language: string;
  metrics: Record<string, number | null>;
  attributes: Record<string, unknown>;
  citations: CanonicalDocument['citations'];
  assets: Array<Pick<CanonicalDocument['assets'][number], 'assetId' | 'kind' | 'url' | 'mimeType'>>;
}

export interface KnowledgeProjection {
  documentId: string;
  title: string;
  content: string;
  metadata: KnowledgeProjectionMetadata;
}

export interface KnowledgeChunkProjection {
  chunkId: string;
  documentId: string;
  ordinal: number;
  title: string;
  content: string;
  contentHash: string;
  tokenCount: number;
  metadata: KnowledgeProjectionMetadata & {
    ordinal: number;
    totalChunks: number;
    characterStart: number;
    characterEnd: number;
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function clean(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function readableFacts(record: Record<string, unknown>): string[] {
  return Object.entries(record).flatMap(([key, value]) => {
    if (value === undefined || value === null || value === '') return [];
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return [`- ${key}: ${text}`];
  });
}

export function knowledgeTokens(text: string): string[] {
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const words = normalized.match(/[a-z0-9_]+|[\u3400-\u9fff]/g) || [];
  const grams = [...words];
  for (let index = 0; index < words.length - 1; index++) grams.push(`${words[index]}${words[index + 1]}`);
  return grams;
}

export class KnowledgeProjector {
  project(document: CanonicalDocument): KnowledgeProjection {
    // Model reasoning is intentionally excluded from both retrieval text and
    // exported metadata. It is an implementation trace, not source knowledge.
    const { reasoningContent: _reasoningContent, ...attributes } = document.attributes;
    const metadata: KnowledgeProjectionMetadata = {
      schemaVersion: 2,
      projectorVersion: KNOWLEDGE_PROJECTOR_VERSION,
      documentId: document.documentId,
      canonicalKey: document.canonicalKey,
      contentHash: document.contentHash,
      kind: document.kind,
      platform: document.platform,
      ...(document.originalPlatform ? { originalPlatform: document.originalPlatform } : {}),
      ...(document.sourceItemId ? { sourceItemId: document.sourceItemId } : {}),
      ...(document.parentSourceItemId ? { parentSourceItemId: document.parentSourceItemId } : {}),
      ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
      ...(document.keyword ? { keyword: document.keyword } : {}),
      ...(document.rank !== undefined ? { rank: document.rank } : {}),
      title: document.title,
      summary: document.summary,
      subject: document.subject,
      ...(document.publishedAt !== undefined ? { publishedAt: document.publishedAt } : {}),
      ...(document.sourceUpdatedAt !== undefined ? { sourceUpdatedAt: document.sourceUpdatedAt } : {}),
      fetchedAt: document.fetchedAt,
      language: document.language,
      metrics: document.metrics,
      attributes,
      citations: document.citations,
      assets: document.assets.map(({ assetId, kind, url, mimeType }) => ({
        assetId, kind, url, ...(mimeType ? { mimeType } : {}),
      })),
    };
    const context = [
      `- platform: ${document.platform}`,
      `- kind: ${document.kind}`,
      `- subject: ${document.subject.name || document.subject.id || 'unknown'} (${document.subject.type})`,
      ...(document.keyword ? [`- keyword: ${document.keyword}`] : []),
      ...readableFacts(document.metrics),
      ...readableFacts(attributes),
    ];
    const sections = [
      document.title ? `# ${document.title}` : '',
      document.summary ? `## 摘要\n\n${document.summary}` : '',
      document.markdown ? `## 正文\n\n${document.markdown}` : '',
      context.length ? `## 结构化上下文\n\n${context.join('\n')}` : '',
      document.citations.length
        ? `## 引用\n\n${document.citations.map((citation) => `- ${citation.title || citation.source || citation.url}: ${citation.url}`).join('\n')}`
        : '',
    ].filter(Boolean);
    return { documentId: document.documentId, title: document.title, content: clean(sections.join('\n\n')), metadata };
  }

  chunks(document: CanonicalDocument, maxLength = 800, overlap = 120): KnowledgeChunkProjection[] {
    const projection = this.project(document);
    if (!projection.content) return [];
    const ranges: Array<{ start: number; end: number; content: string }> = [];
    let start = 0;
    while (start < projection.content.length) {
      let end = Math.min(projection.content.length, start + maxLength);
      if (end < projection.content.length) {
        const boundary = projection.content.lastIndexOf('\n\n', end);
        if (boundary > start + Math.floor(maxLength * 0.55)) end = boundary;
      }
      const content = projection.content.slice(start, end).trim();
      if (content) ranges.push({ start, end, content });
      if (end >= projection.content.length) break;
      start = Math.max(start + 1, end - Math.min(overlap, Math.floor(maxLength / 3)));
    }
    return ranges.map((range, ordinal) => ({
      chunkId: hash(`${document.documentId}:${projection.metadata.contentHash}:${ordinal}:${range.content}`),
      documentId: document.documentId,
      ordinal,
      title: document.title,
      content: range.content,
      contentHash: hash(range.content),
      tokenCount: knowledgeTokens(range.content).length,
      metadata: {
        ...projection.metadata,
        ordinal,
        totalChunks: ranges.length,
        characterStart: range.start,
        characterEnd: range.end,
      },
    }));
  }
}

export const knowledgeProjector = new KnowledgeProjector();
