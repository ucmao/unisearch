import type { DocumentProcessor, ProcessorContext, ProcessorResult } from './types';
import type { Artifact, Document } from '../documents/types';

export class ProcessorRegistry {
  private readonly processors = new Map<string, DocumentProcessor>();

  register(processor: DocumentProcessor): void {
    if (this.processors.has(processor.id)) throw new Error(`Processor already registered: ${processor.id}`);
    this.processors.set(processor.id, processor);
  }

  get(id: string): DocumentProcessor {
    const processor = this.processors.get(id);
    if (!processor) throw new Error(`Unknown processor: ${id}`);
    return processor;
  }

  list(): DocumentProcessor[] {
    return [...this.processors.values()];
  }

  async runPipeline(ids: string[], document: Document, context: ProcessorContext): Promise<ProcessorResult> {
    let current = document;
    const artifacts: Artifact[] = [];
    for (const id of ids) {
      if (context.signal?.aborted) throw new Error('Processor pipeline cancelled');
      const result = await this.get(id).process(current, context);
      current = result.document;
      if (result.artifacts?.length) artifacts.push(...result.artifacts);
    }
    return { document: current, artifacts };
  }
}
