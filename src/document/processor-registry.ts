import { ProcessorRegistry } from '../core/processors/registry';
import { cleanMarkdownProcessor } from './processors/clean-markdown';
import { normalizeMetadataProcessor } from './processors/normalize-metadata';
import {
  assetDownloadProcessor,
  ffmpegExtractAudioProcessor,
  pandocConvertProcessor,
  whisperTranscribeProcessor,
} from './processors/media-processors';

export const documentProcessorRegistry = new ProcessorRegistry();
documentProcessorRegistry.register(normalizeMetadataProcessor);
documentProcessorRegistry.register(cleanMarkdownProcessor);
documentProcessorRegistry.register(assetDownloadProcessor);
documentProcessorRegistry.register(pandocConvertProcessor);
documentProcessorRegistry.register(ffmpegExtractAudioProcessor);
documentProcessorRegistry.register(whisperTranscribeProcessor);

export const DEFAULT_INGESTION_PROCESSORS = [
  'metadata.normalize',
  'document.clean_markdown',
];
