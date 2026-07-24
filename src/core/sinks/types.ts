import type { RawItem } from '../contracts/raw-item';

export interface OutputSinkContext {
  runId: string;
  source: string;
  startedAt: string;
}

export interface OutputSinkResult {
  status: 'completed' | 'failed' | 'cancelled';
  itemCount: number;
  error?: string;
}

export interface OutputSink {
  open(context: OutputSinkContext): Promise<void>;
  write(item: RawItem): Promise<void>;
  close(result: OutputSinkResult): Promise<void>;
  abort(error: Error): Promise<void>;
}

export abstract class BaseOutputSink implements OutputSink {
  async open(_context: OutputSinkContext): Promise<void> {}
  abstract write(item: RawItem): Promise<void>;
  async close(_result: OutputSinkResult): Promise<void> {}
  async abort(_error: Error): Promise<void> {}
}
