import type { RawItem } from '../contracts/raw-item';
import { BaseOutputSink } from './types';

export class MemoryOutputSink extends BaseOutputSink {
  readonly items: RawItem[] = [];

  async write(item: RawItem): Promise<void> {
    this.items.push(item);
  }
}
