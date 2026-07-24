import readline from 'readline';
import { processorWorkerRequestSchema, processorWorkerResultSchema } from '../core/processors/worker-contract';
import { documentProcessorRegistry } from '../document/processor-registry';

async function main(): Promise<void> {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  let payload = '';
  for await (const line of input) payload += line;
  const request = processorWorkerRequestSchema.parse(JSON.parse(payload));
  const documents = [];
  const artifacts = [];
  for (const document of request.documents) {
    const result = await documentProcessorRegistry.runPipeline(request.processorIds, document, {
      runId: request.runId,
      now: () => new Date(),
    });
    documents.push(result.document);
    artifacts.push(...(result.artifacts || []));
  }
  const result = processorWorkerResultSchema.parse({
    schemaVersion: 1,
    jobId: request.jobId,
    documents,
    artifacts,
  });
  if (!process.send) throw new Error('Processor Worker IPC channel is unavailable');
  await new Promise<void>((resolve, reject) => {
    process.send!({ type: 'PROCESSOR_RESULT', result }, (error) => error ? reject(error) : resolve());
  });
}

main()
  .then(() => process.exit(0))
  .catch((error: any) => {
    if (process.send) process.send({
      type: 'PROCESSOR_ERROR',
      error: { message: error.message || 'Processor Worker failed', stack: error.stack || '' },
    });
    process.exit(1);
  });
