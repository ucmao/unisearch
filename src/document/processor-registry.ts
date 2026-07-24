import { ProcessorRegistry } from '../core/processors/registry';
import { cleanMarkdownProcessor } from './processors/clean-markdown';
import { normalizeMetadataProcessor } from './processors/normalize-metadata';

export const documentProcessorRegistry = new ProcessorRegistry();
documentProcessorRegistry.register(normalizeMetadataProcessor);
documentProcessorRegistry.register(cleanMarkdownProcessor);

export const DEFAULT_INGESTION_PROCESSORS = [
  'metadata.normalize',
  'document.clean_markdown',
];
