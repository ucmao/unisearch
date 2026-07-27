import type { CanonicalDocument as Document } from '../documents/canonical';

export interface ExportContext {
  workflowId?: string;
  outputDirectory: string;
  now: () => Date;
}

export interface ExportResult {
  outputPath: string;
  itemCount: number;
  metadata: Record<string, unknown>;
}

export interface Exporter {
  id: string;
  version: string;
  name: string;
  export(documents: Document[], context: ExportContext): Promise<ExportResult>;
}
