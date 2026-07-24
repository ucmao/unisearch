import type { ProcessorResourceClass } from './types';

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class ProcessorResourceScheduler {
  private readonly active: Record<ProcessorResourceClass, number> = { io: 0, cpu: 0, gpu: 0 };
  private readonly queues: Record<ProcessorResourceClass, Waiter[]> = { io: [], cpu: [], gpu: [] };

  constructor(private readonly limits: Record<ProcessorResourceClass, number> = { io: 4, cpu: 1, gpu: 1 }) {}

  acquire(resourceClass: ProcessorResourceClass, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error('Processor job cancelled'));
    if (this.active[resourceClass] < this.limit(resourceClass)) {
      this.active[resourceClass]++;
      return Promise.resolve(this.releaseOnce(resourceClass));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, signal };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.queues[resourceClass].indexOf(waiter);
          if (index >= 0) this.queues[resourceClass].splice(index, 1);
          reject(new Error('Processor job cancelled'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.queues[resourceClass].push(waiter);
    });
  }

  snapshot(): Record<ProcessorResourceClass, { active: number; queued: number; limit: number }> {
    return {
      io: { active: this.active.io, queued: this.queues.io.length, limit: this.limit('io') },
      cpu: { active: this.active.cpu, queued: this.queues.cpu.length, limit: this.limit('cpu') },
      gpu: { active: this.active.gpu, queued: this.queues.gpu.length, limit: this.limit('gpu') },
    };
  }

  private limit(resourceClass: ProcessorResourceClass): number {
    return Math.max(1, Math.floor(this.limits[resourceClass] || 1));
  }

  private releaseOnce(resourceClass: ProcessorResourceClass): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.queues[resourceClass].shift();
      if (waiter) {
        if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
        waiter.resolve(this.releaseOnce(resourceClass));
        return;
      }
      this.active[resourceClass] = Math.max(0, this.active[resourceClass] - 1);
    };
  }
}

