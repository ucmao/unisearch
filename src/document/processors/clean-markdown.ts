import { createHash } from 'crypto';
import type { DocumentProcessor } from '../../core/processors/types';

export function cleanMarkdown(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const cleanMarkdownProcessor: DocumentProcessor = {
  id: 'document.clean_markdown',
  version: '1.0.0',
  resourceClass: 'cpu',
  async process(document, context) {
    const markdown = cleanMarkdown(document.markdown);
    return {
      document: {
        ...document,
        markdown,
        contentHash: createHash('sha256').update(markdown).digest('hex'),
        updatedAt: context.now().toISOString(),
      },
    };
  },
};
