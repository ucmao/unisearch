import type { RawItem } from '../contracts/raw-item';
import { BaseOutputSink } from './types';
import type { OutputSinkContext } from './types';
import { documentEngine } from '../../document/document-engine';

export class SqliteOutputSink extends BaseOutputSink {
  private runId: string | undefined;

  override async open(context: OutputSinkContext): Promise<void> {
    this.runId = context.runId;
  }

  async write(item: RawItem): Promise<void> {
    await documentEngine.ingest(item, this.runId);
  }
}
