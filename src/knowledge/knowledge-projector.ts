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
  assets: Array<Pick<CanonicalDocument['assets'][number], 'assetId' | 'kind' | 'role' | 'url' | 'mimeType'>>;
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
  retrievalText: string;
  contentHash: string;
  tokenCount: number;
  metadata: KnowledgeProjectionMetadata & {
    ordinal: number;
    totalChunks: number;
    characterStart: number;
    characterEnd: number;
    breadcrumbs?: string[];
    retrievalText?: string;
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

let _segmenter: any = null;
function getSegmenter(): any {
  if (!_segmenter) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Segment, useDefault } = require('segmentit');
      _segmenter = useDefault(new Segment());
    } catch {
      _segmenter = null;
    }
  }
  return _segmenter;
}

export function knowledgeTokens(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const cjkChars = normalized.match(/[\u3400-\u9fff]/g) || [];
  const words = normalized.match(/[a-z0-9_]+/g) || [];
  const segmenter = getSegmenter();
  const segmented = segmenter
    ? (segmenter.doSegment(text) as Array<{ w: string }>)
        .map((item) => item.w.trim().toLocaleLowerCase())
        .filter(Boolean)
    : [];
  const grams: string[] = [];
  for (let index = 0; index < cjkChars.length - 1; index++) {
    grams.push(`${cjkChars[index]}${cjkChars[index + 1]}`);
  }
  return [...new Set([...segmented, ...words, ...cjkChars, ...grams])].filter((token) => token.length > 0);
}

export function knowledgeFtsTokens(text: string): string {
  return knowledgeTokens(text).join(' ');
}

interface HeadingEntry {
  level: number;
  text: string;
  index: number;
}

export function extractBreadcrumbs(text: string, start: number, end: number = start): string[] {
  const headingRegex = /^(#{1,6})\s+([^\n#]{1,80})$/gm;
  const headingsBeforeStart: HeadingEntry[] = [];
  const headingsInsideRange: HeadingEntry[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(text)) !== null) {
    const headingText = match[2].trim();
    if (!headingText) continue;
    if (match.index <= start) {
      headingsBeforeStart.push({
        level: match[1].length,
        text: headingText,
        index: match.index,
      });
    } else if (match.index < end) {
      headingsInsideRange.push({
        level: match[1].length,
        text: headingText,
        index: match.index,
      });
    } else {
      break;
    }
  }

  const stack: HeadingEntry[] = [];
  for (const h of headingsBeforeStart) {
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }
    stack.push(h);
  }

  const result = stack.map((h) => h.text);
  for (const h of headingsInsideRange) {
    if (!result.includes(h.text)) {
      result.push(h.text);
    }
  }
  return result;
}

export function findMultiLevelBoundary(text: string, start: number, maxLength: number): number {
  const maxEnd = Math.min(text.length, start + maxLength);
  if (maxEnd >= text.length) return maxEnd;

  const minEnd = start + Math.floor(maxLength * 0.45);
  const slice = text.slice(minEnd, maxEnd);

  // Priority 1: Markdown Header boundary (\n# )
  const headerIdx = slice.lastIndexOf('\n#');
  if (headerIdx !== -1) return minEnd + headerIdx;

  // Priority 2: Paragraph break (\n\n)
  const pIdx = slice.lastIndexOf('\n\n');
  if (pIdx !== -1) return minEnd + pIdx;

  // Priority 3: Single newline (\n)
  const lIdx = slice.lastIndexOf('\n');
  if (lIdx !== -1) return minEnd + lIdx;

  // Priority 4: Sentence end punctuation (。！？；!?;)
  const sMatches = [...slice.matchAll(/[。！？；!?;][”’"'\s]?/g)];
  if (sMatches.length > 0) {
    const last = sMatches[sMatches.length - 1];
    return minEnd + last.index + last[0].length;
  }

  // Priority 5: Clause punctuation (，,、：:\s)
  const cMatches = [...slice.matchAll(/[，,、：:\s]/g)];
  if (cMatches.length > 0) {
    const last = cMatches[cMatches.length - 1];
    return minEnd + last.index + last[0].length;
  }

  return maxEnd;
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
      assets: document.assets.map(({ assetId, kind, role, url, mimeType }) => ({
        assetId, kind, role, url, ...(mimeType ? { mimeType } : {}),
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

    // Kind-adaptive atomic preservation for short items
    const isAtomicKind = ['comment', 'search_result', 'job'].includes(document.kind);
    if (isAtomicKind && projection.content.length <= maxLength) {
      const headerContext = [
        `[平台: ${projection.metadata.platform || 'unknown'} | 类型: ${projection.metadata.kind || 'unknown'} | 主体: ${projection.metadata.subject?.name || projection.metadata.subject?.id || 'unknown'}${projection.metadata.keyword ? ` | 关键词: ${projection.metadata.keyword}` : ''}]`,
      ].join(' ');
      const retrievalText = `${headerContext}\n${document.title ? `# ${document.title}\n` : ''}${projection.content}`;
      return [{
        chunkId: hash(`${document.documentId}:${projection.metadata.contentHash}:0:${projection.content}`),
        documentId: document.documentId,
        ordinal: 0,
        title: document.title,
        content: projection.content,
        retrievalText,
        contentHash: hash(projection.content),
        tokenCount: knowledgeTokens(projection.content).length,
        metadata: {
          ...projection.metadata,
          ordinal: 0,
          totalChunks: 1,
          characterStart: 0,
          characterEnd: projection.content.length,
          breadcrumbs: [],
          retrievalText,
        },
      }];
    }

    const ranges: Array<{ start: number; end: number; content: string; breadcrumbs: string[] }> = [];
    let start = 0;
    while (start < projection.content.length) {
      const end = findMultiLevelBoundary(projection.content, start, maxLength);
      const content = projection.content.slice(start, end).trim();
      const breadcrumbs = extractBreadcrumbs(projection.content, start, end);
      if (content) ranges.push({ start, end, content, breadcrumbs });
      if (end >= projection.content.length) break;
      start = Math.max(start + 1, end - Math.min(overlap, Math.floor(maxLength / 3)));
    }

    return ranges.map((range, ordinal) => {
      const breadcrumbText = range.breadcrumbs.length ? ` | 章节: ${range.breadcrumbs.join(' > ')}` : '';
      const headerContext = `[平台: ${projection.metadata.platform || 'unknown'} | 类型: ${projection.metadata.kind || 'unknown'} | 主体: ${projection.metadata.subject?.name || projection.metadata.subject?.id || 'unknown'}${projection.metadata.keyword ? ` | 关键词: ${projection.metadata.keyword}` : ''}${breadcrumbText}]`;
      const retrievalText = `${headerContext}\n${document.title ? `# ${document.title}\n` : ''}${range.content}`;

      return {
        chunkId: hash(`${document.documentId}:${projection.metadata.contentHash}:${ordinal}:${range.content}`),
        documentId: document.documentId,
        ordinal,
        title: document.title,
        content: range.content,
        retrievalText,
        contentHash: hash(range.content),
        tokenCount: knowledgeTokens(range.content).length,
        metadata: {
          ...projection.metadata,
          ordinal,
          totalChunks: ranges.length,
          characterStart: range.start,
          characterEnd: range.end,
          breadcrumbs: range.breadcrumbs,
          retrievalText,
        },
      };
    });
  }
}

export const knowledgeProjector = new KnowledgeProjector();
