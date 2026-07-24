import type { RawItem } from '../contracts/raw-item';
import { dbStore } from '../../crawler/store';
import { BaseOutputSink } from './types';
import type { OutputSinkContext } from './types';
import { documentEngine } from '../../document/document-engine';

type StoreOperation = keyof typeof dbStore;

export class SqliteOutputSink extends BaseOutputSink {
  private runId: string | undefined;

  override async open(context: OutputSinkContext): Promise<void> {
    this.runId = context.runId;
  }

  async write(item: RawItem): Promise<void> {
    const operation = item.metadata.operation;
    if (typeof operation !== 'string') throw new Error('RawItem is missing its storage operation');

    if (operation === 'storeSearchEngineResult' && ['yuanbao', 'nami', 'wenxin'].includes(item.source)) {
      await dbStore.storeAiWebQaResult(item.source as 'yuanbao' | 'nami' | 'wenxin', item.payload as Record<string, any>);
      await documentEngine.ingest(item, this.runId);
      return;
    }

    const writer = dbStore[operation as StoreOperation];
    if (typeof writer !== 'function') throw new Error(`Unsupported SQLite output operation: ${operation}`);
    await (writer as (payload: Record<string, any>) => Promise<void>).call(dbStore, item.payload as Record<string, any>);
    await documentEngine.ingest(item, this.runId);
  }
}
