import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import Database from 'better-sqlite3';
import { initSchema } from '../src/database/schema';
import { ExportService } from '../src/exporters/registry';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { DocumentEngine } from '../src/document/document-engine';

test('ExportService.run filters documents by platform and keyword correctly', async () => {
  const db = new Database(':memory:');
  initSchema(db);

  const engine = new DocumentEngine(() => db);

  // Ingest 2 items: 1 from xhs, 1 from zhihu
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO agent_threads (thread_id, title, created_at, updated_at)
    VALUES ('th-1', '测试会话', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT OR IGNORE INTO workflow_runs (workflow_id, thread_id, skill_id, skill_version, goal, status, input_json, output_json, created_at, updated_at)
    VALUES ('wf-1', 'th-1', 'test', '1', '测试目标', 'completed', '{}', '{}', ?, ?)
  `).run(now, now);
  db.prepare(`
    INSERT INTO crawl_runs (run_id, thread_id, workflow_id, task_title, task_name, platform, crawler_type, status, started_at)
    VALUES ('run-xhs', 'th-1', 'wf-1', '小红书测试', 'run-xhs', 'xhs', 'search', 'completed', ?)
  `).run(now);
  db.prepare(`
    INSERT INTO crawl_runs (run_id, thread_id, workflow_id, task_title, task_name, platform, crawler_type, status, started_at)
    VALUES ('run-zhihu', 'th-1', 'wf-1', '知乎测试', 'run-zhihu', 'zhihu', 'search', 'completed', ?)
  `).run(now);

  await engine.ingest(buildRawItem('emitXhsNote', {
    note_id: 'xhs-123',
    title: '小红书AI训练师笔记',
    desc: '这是关于AI训练师的小红书笔记正文内容',
    note_url: 'https://xhs.com/123',
    nickname: '小红书作者',
  }), 'run-xhs');

  await engine.ingest(buildRawItem('emitZhihuContent', {
    content_id: 'zh-456',
    title: '知乎数据标注员深度剖析',
    content: '知乎关于数据标注员的专业探讨正文',
    url: 'https://zhihu.com/456',
    author: '知乎大V',
  }), 'run-zhihu');

  const exportService = new ExportService(() => db);

  // 1. Export all (no filter) -> should have 2 items
  const allRecord = await exportService.run('obsidian', { workflowId: 'wf-1' });
  assert.equal(allRecord.item_count, 2);
  assert.ok(fs.existsSync(allRecord.output_path));

  // 2. Export filtered by platform 'xhs' -> should have exactly 1 item
  const xhsRecord = await exportService.run('obsidian', {
    workflowId: 'wf-1',
    filterParams: { workflow_id: 'wf-1', platform: 'xhs' },
  });
  assert.equal(xhsRecord.item_count, 1);
  const files = fs.readdirSync(xhsRecord.output_path);
  assert.ok(files.some((f) => f.includes('小红书AI训练师笔记')));
  assert.ok(!files.some((f) => f.includes('知乎数据标注员')));

  // 3. Export filtered by keyword '标注员' -> should have exactly 1 item (zhihu)
  const zhihuRecord = await exportService.run('dify', {
    workflowId: 'wf-1',
    filterParams: { workflow_id: 'wf-1', query: '标注员' },
  });
  assert.equal(zhihuRecord.metadata.documentCount, 1);

  // 4. Export Markdown collection with filter
  const mdRecord = await exportService.run('markdown', {
    workflowId: 'wf-1',
    filterParams: { workflow_id: 'wf-1', platform: 'xhs' },
  });
  assert.equal(mdRecord.item_count, 1);
  const mdContent = fs.readFileSync(mdRecord.output_path, 'utf8');
  assert.match(mdContent, /小红书AI训练师笔记/);
  assert.doesNotMatch(mdContent, /知乎数据标注员/);
});
