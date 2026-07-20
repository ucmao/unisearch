import readline from 'readline';
import { applyConfig, activeConfig } from '../tools/config';
import { getDb, closeDb } from '../database/connection';
import { createConnectorExecutor } from '../connectors/executors';
import { normalizeConnectorRequest } from '../connectors/registry';

let activeCrawler: any = null;

async function cleanup(): Promise<void> {
  console.log('[Worker] Cleaning up crawler browser...');
  if (activeCrawler) {
    try {
      if (activeCrawler.cdpManager) {
        await activeCrawler.cdpManager.cleanup(true);
      } else if (activeCrawler.browserContext) {
        await activeCrawler.browserContext.close();
      }
    } catch (err: any) {
      console.error('[Worker] Error during browser cleanup:', err.message);
    }
  }
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
  
  // Register IPC control listeners
  process.on('message', async (msg: any) => {
    if (msg && msg.type === 'SKIP_CONNECTOR') {
      console.log(`[Worker] Received SKIP_CONNECTOR request for platform ${activeConfig.PLATFORM}. Terminating task gracefully.`);
      await cleanup();
      process.exit(0);
    }
  });

  // Register graceful exit handlers

  process.on('SIGTERM', async () => {
    console.log('[Worker] Received SIGTERM signal');
    await cleanup();
    process.exit(143);
  });

  process.on('SIGINT', async () => {
    console.log('[Worker] Received SIGINT signal');
    await cleanup();
    process.exit(130);
  });

  try {
    await activeCrawler.start();
    await cleanup();
    process.exit(0);
  } catch (err: any) {
    console.error(`[Worker] Crawler execution failed: ${err.message}`, err.stack);
    await cleanup();
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('[Worker] Worker runtime error:', err);
  process.exit(1);
});
