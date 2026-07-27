import type { Artifact } from '../documents/types';
import type { CanonicalDocument as Document } from '../documents/canonical';

export type ProcessorResourceClass = 'io' | 'cpu' | 'gpu';

export interface ProcessorContext {
  runId?: string;
  signal?: AbortSignal;
  now: () => Date;
}

export interface ProcessorResult {
  document: Document;
  artifacts?: Artifact[];
}

export interface Processor<Input, Output> {
  id: string;
  version: string;
  resourceClass: ProcessorResourceClass;
  process(input: Input, context: ProcessorContext): Promise<Output>;
}

export interface DocumentProcessor extends Processor<Document, ProcessorResult> {}
