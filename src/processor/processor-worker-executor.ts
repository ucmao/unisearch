import { fork, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Document, Artifact } from '../core/documents/types';
import type { ProcessorResourceClass } from '../core/processors/types';
import {
  processorWorkerRequestSchema,
  processorWorkerResultSchema,
  type ProcessorWorkerResult,
} from '../core/processors/worker-contract';
import { ProcessorResourceScheduler } from '../core/processors/resource-scheduler';
import { documentProcessorRegistry } from '../document/processor-registry';

function workerPath(): string {
  const packaged = process.env.NODE_ENV === 'production' || require('electron').app?.isPackaged;
  if (packaged) {
    const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked/dist/processor/worker.js');
    if (fs.existsSync(unpacked)) return unpacked;
    return path.join(__dirname, '../processor/worker.js');
  }
  return path.join(process.cwd(), 'dist/processor/worker.js');
}

function strongestResource(ids: string[]): ProcessorResourceClass {
  const classes = ids.map((id) => documentProcessorRegistry.get(id).resourceClass);
  if (classes.includes('gpu')) return 'gpu';
  if (classes.includes('cpu')) return 'cpu';
  return 'io';
}

export class ProcessorWorkerExecutor {
  private readonly children = new Map<string, ChildProcess>();

  constructor(private readonly scheduler = new ProcessorResourceScheduler()) {}

  async run(
    processorIds: string[],
    documents: Document[],
    options: { runId?: string; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<{ documents: Document[]; artifacts: Artifact[] }> {
    if (!documents.length) return { documents: [], artifacts: [] };
    const release = await this.scheduler.acquire(strongestResource(processorIds), options.signal);
    const jobId = randomUUID();
    try {
      const request = processorWorkerRequestSchema.parse({
        schemaVersion: 1,
        jobId,
        processorIds,
        documents,
        runId: options.runId,
      });
      return await new Promise((resolve, reject) => {
        const child = fork(workerPath(), [], {
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
          env: { ...process.env, NODE_ENV: process.env.NODE_ENV },
        });
        this.children.set(jobId, child);
        let settled = false;
        let stderr = '';
        const finish = (error?: Error, result?: ProcessorWorkerResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          options.signal?.removeEventListener('abort', abort);
          this.children.delete(jobId);
          if (error) reject(error);
          else resolve({ documents: result!.documents, artifacts: result!.artifacts });
        };
        const abort = () => {
          child.kill('SIGTERM');
          finish(new Error('Processor job cancelled'));
        };
        const timeout = setTimeout(() => {
          child.kill('SIGKILL');
          finish(new Error(`Processor job timed out after ${options.timeoutMs || 300_000}ms`));
        }, options.timeoutMs || 300_000);
        timeout.unref();
        options.signal?.addEventListener('abort', abort, { once: true });
        child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('message', (message: any) => {
          if (message?.type === 'PROCESSOR_RESULT') {
            try { finish(undefined, processorWorkerResultSchema.parse(message.result)); }
            catch (error: any) { finish(error); }
          } else if (message?.type === 'PROCESSOR_ERROR') {
            finish(new Error(message.error?.message || 'Processor Worker failed'));
          }
        });
        child.on('error', (error) => finish(error));
        child.on('exit', (code) => {
          if (!settled) finish(new Error(stderr.trim() || `Processor Worker exited without a result (code ${code})`));
        });
        child.stdin?.end(JSON.stringify(request));
      });
    } finally {
      release();
    }
  }

  cancelAll(): void {
    for (const child of this.children.values()) child.kill('SIGTERM');
  }

  resourceSnapshot() {
    return this.scheduler.snapshot();
  }
}

export const processorWorkerExecutor = new ProcessorWorkerExecutor();
