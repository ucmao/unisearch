import type { Document } from '../documents/types';

export interface AnalysisReport {
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface Analyzer {
  id: string;
  version: string;
  name: string;
  analyze(documents: Document[], options?: Record<string, unknown>): Promise<AnalysisReport>;
}

