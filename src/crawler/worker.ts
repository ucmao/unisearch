import readline from 'readline';
import { applyConfig, activeConfig } from '../tools/config';
import { getDb, closeDb } from '../database/connection';
import { createConnectorExecutor } from '../connectors/executors';
import { normalizeConnectorRequest } from '../connectors/registry';
import { connectorOutput } from '../connectors/output/connector-output';
import { CompositeOutputSink } from '../core/sinks/composite';
import { IpcOutputSink } from '../core/sinks/ipc';
import { SqliteOutputSink } from '../core/sinks/sqlite';
import { classifyConnectorError } from '../core/contracts/errors';

let activeCrawler: any = null;
let outputOpen = false;

async function cleanup(): Promise<void> {
  console.log('[Worker] Cleaning up crawler page...');
  // The page belongs to Electron's shared crawler window. Navigating it to
  // about:blank here leaves a user-opened window as a white screen and can also
  // interrupt a verification redirect that has just completed.
  closeDb();
  console.log('[Worker] Cleanup complete.');
}

async function run(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  // Read config from stdin (sent by CrawlerManager)
  let payload = '';
  for await (const line of rl) {
    payload += line;
  }

  if (!payload.trim()) {
    throw new Error('Worker received empty configuration payload.');
  }

  const config = normalizeConnectorRequest(JSON.parse(payload));
  applyConfig(config);

  // Initialize DB connection
  getDb();

  console.log(`[Worker] Running crawler for platform: ${activeConfig.PLATFORM}`);
  
  activeCrawler = createConnectorExecutor(activeConfig.PLATFORM);
  const runId = process.env.UNISEARCH_RUN_ID || `standalone-${Date.now()}`;
  await connectorOutput.open(
    new CompositeOutputSink([
      new SqliteOutputSink(),
      new IpcOutputSink(),
    ]),
    {
      runId,
      source: activeConfig.PLATFORM,
      startedAt: new Date().toISOString(),
    },
  );
  outputOpen = true;
  
  // Register IPC control listeners
  process.on('message', async (msg: any) => {
    if (msg && msg.type === 'SKIP_CONNECTOR') {
      console.log(`[Worker] Received SKIP_CONNECTOR request for platform ${activeConfig.PLATFORM}. Terminating task gracefully.`);
      if (outputOpen) {
        outputOpen = false;
        await connectorOutput.close({ status: 'cancelled' });
      }
      await cleanup();
      process.exit(0);
    }
  });

  // Register graceful exit handlers

  process.on('SIGTERM', async () => {
    console.log('[Worker] Received SIGTERM signal');
    if (outputOpen) {
      outputOpen = false;
      await connectorOutput.close({ status: 'cancelled' });
    }
    await cleanup();
    process.exit(143);
  });

  process.on('SIGINT', async () => {
    console.log('[Worker] Received SIGINT signal');
    if (outputOpen) {
      outputOpen = false;
      await connectorOutput.close({ status: 'cancelled' });
    }
    await cleanup();
    process.exit(130);
  });

  try {
    await activeCrawler.start();
    outputOpen = false;
    const itemCount = await connectorOutput.close({ status: 'completed' });
    console.log(`[Worker] Connector emitted ${itemCount} normalized raw items.`);
    await cleanup();
    process.exit(0);
  } catch (err: any) {
    const classified = classifyConnectorError(err);
    if (outputOpen) {
      outputOpen = false;
      await connectorOutput.abort(classified);
    }
    console.error(`[Worker] Crawler execution failed [${classified.code}]: ${classified.message}`, err.stack);
    await cleanup();
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[Worker] Worker runtime error:', err);
  process.exit(1);
});
