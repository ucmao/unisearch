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
    const summary = document.summary.replace(/\s+/g, ' ').trim();
    const subjectName = document.subject.name?.replace(/\s+/g, ' ').trim();
    const sourceUrl = normalizeUrl(document.sourceUrl);
    // Re-key only the documents that were identified by their URL in the first
    // place, so that stripping a fragment still dedups `…/research#section` onto
    // `…/research`. Comments are deliberately keyed by their own id because they
    // all share the URL of the note they hang off; re-keying them here collapsed a
    // whole thread of replies into a single row.
    const keyedByUrl = Boolean(document.sourceUrl) && document.canonicalKey === document.sourceUrl;
    const canonicalKey = keyedByUrl && sourceUrl ? sourceUrl : document.canonicalKey;
    const documentId = createHash('sha256').update(canonicalKey).digest('hex');
    return {
      document: {
        ...document,
        documentId,
        canonicalKey,
        title,
        summary,
        subject: {
          ...document.subject,
          ...(subjectName ? { name: subjectName } : { name: undefined }),
        },
        sourceUrl,
        assets: document.assets.map((asset) => ({ ...asset, documentId })),
      },
    };
  },
};
