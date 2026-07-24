import { createHash } from 'crypto';
import type { DocumentProcessor } from '../../core/processors/types';

function normalizeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
  } catch {
    return value.trim() || undefined;
  }
}

export const normalizeMetadataProcessor: DocumentProcessor = {
  id: 'metadata.normalize',
  version: '1.0.0',
  resourceClass: 'cpu',
  async process(document) {
    const title = document.title.replace(/\s+/g, ' ').trim();
    const author = document.author.replace(/\s+/g, ' ').trim();
    const sourceUrl = normalizeUrl(document.sourceUrl);
    const canonicalKey = sourceUrl || document.canonicalKey;
    const documentId = createHash('sha256').update(canonicalKey).digest('hex');
    return {
      document: {
        ...document,
        documentId,
        canonicalKey,
        title,
        author,
        sourceUrl,
        assets: document.assets.map((asset) => ({ ...asset, documentId })),
      },
    };
  },
};
