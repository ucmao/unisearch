import { mkdir, appendFile } from 'fs/promises';
import path from 'path';
import type { RawItem } from '../contracts/raw-item';
import { BaseOutputSink } from './types';

export class JsonlOutputSink extends BaseOutputSink {
  constructor(private readonly filePath: string) {
    super();
  }

  override async open(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
  }

  async write(item: RawItem): Promise<void> {
    await appendFile(this.filePath, `${JSON.stringify(item)}\n`, 'utf8');
  }
}
