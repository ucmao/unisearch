import { applyConfig } from '../src/tools/config';
import { getDb, closeDb } from '../src/database/connection';
import { createConnectorExecutor } from '../src/connectors/executors';
import { normalizeConnectorRequest } from '../src/connectors/registry';

async function testConnector(platformId: string, keyword: string) {
  console.log(`\n================ Testing ${platformId.toUpperCase()} Connector ================`);
  const runId = `run-test-${platformId}-${Date.now()}`;
  process.env.UNISEARCH_RUN_ID = runId;

  const db = getDb();
  // Insert a parent crawl_runs entry to satisfy foreign key requirement
  db.prepare(`
    INSERT INTO crawl_runs (run_id, thread_id, plan_id, task_title, task_name, platform, crawler_type, keywords, status, started_at)
    VALUES (?, 't-1', 'p-1', 'Test Task', 'Test', ?, 'search', ?, 'running', ?)
  `).run(runId, platformId, keyword, new Date().toISOString());

  const req = normalizeConnectorRequest({
    platform: platformId,
    keywords: keyword,
    login_type: 'qrcode',
    crawler_type: 'search',
    start_page: 1,
    enable_comments: false,
    enable_sub_comments: false,
    cookies: '',
    headless: true,
    loop_execution: false,
    connector_options: {
      max_items: 3,
    },
  });

  applyConfig(req);

  const executor = createConnectorExecutor(platformId);
  await executor.start();

  const seResults = db.prepare('SELECT * FROM search_engine_result WHERE search_engine = ? ORDER BY id DESC LIMIT 3').all(platformId);
  console.log(`[DB Check] search_engine_result entries for ${platformId}:`, seResults.length);
  seResults.forEach((row: any, i: number) => {
    console.log(`  Row ${i + 1}: [${row.search_engine}] Title: "${row.title}" | Real URL: ${row.real_url}`);
  });

  const contentRecords = db.prepare('SELECT * FROM content_records WHERE platform = ? AND run_id = ? ORDER BY id DESC LIMIT 3').all(platformId, runId);
  console.log(`[DB Check] content_records entries for ${platformId}:`, contentRecords.length);
  contentRecords.forEach((row: any, i: number) => {
    console.log(`  Record ${i + 1}: Platform Label: [${row.platform_label}] | Title: "${row.title}" | URL: ${row.content_url}`);
  });
}

async function runE2ETest() {
  const keyword = 'DeepSeek 联网搜索';
  const platforms = ['baidu', 'bing', 'so360', 'sogou'];

  for (const pid of platforms) {
    await testConnector(pid, keyword);
  }

  closeDb();
  console.log('\n================ All 4 Connectors Tested E2E Successfully! ================');
}

runE2ETest().catch((err) => {
  console.error('E2E Test Error:', err);
  process.exit(1);
});
