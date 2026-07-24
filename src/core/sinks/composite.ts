import type { RawItem } from '../contracts/raw-item';
import type { OutputSink, OutputSinkContext, OutputSinkResult } from './types';

export class CompositeOutputSink implements OutputSink {
  constructor(private readonly sinks: OutputSink[]) {}

  async open(context: OutputSinkContext): Promise<void> {
    for (const sink of this.sinks) await sink.open(context);
  }

  async write(item: RawItem): Promise<void> {
    for (const sink of this.sinks) await sink.write(item);
  }

  async close(result: OutputSinkResult): Promise<void> {
    for (const sink of [...this.sinks].reverse()) await sink.close(result);
  }

  async abort(error: Error): Promise<void> {
    await Promise.allSettled([...this.sinks].reverse().map((sink) => sink.abort(error)));
  }
}
