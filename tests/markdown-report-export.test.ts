import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, parseInline } from '../src/analyzers/markdown-ast';
import { formalReportRenderer } from '../src/analyzers/formal-report-renderer';

test('parseInline parses bold, italic, code, links, and citations correctly', () => {
  const text = '这是 **加粗** 和 *斜体* 以及 `const a = 1;`，还有 [S1] 证据和 [链接](https://example.com)';
  const tokens = parseInline(text);

  assert.equal(tokens.some((t) => t.type === 'bold' && t.text === '加粗'), true);
  assert.equal(tokens.some((t) => t.type === 'italic' && t.text === '斜体'), true);
  assert.equal(tokens.some((t) => t.type === 'code' && t.text === 'const a = 1;'), true);
  assert.equal(tokens.some((t) => t.type === 'citation' && t.citationId === 'S1'), true);
  assert.equal(tokens.some((t) => t.type === 'link' && t.text === '链接' && t.url === 'https://example.com'), true);
});

test('parseMarkdown parses headings, tables, code blocks, lists, and quotes', () => {
  const sampleMarkdown = `
# 行业调研报告

这是引言段落，包含 **重要结论** 与 [S1] 引用。

| 平台 | 采集条数 | 覆盖率 |
| :--- | :---: | ---: |
| 抖音 | 120 | 85% |
| 小红书 | 240 | 92% |

> 这是核心摘要引用块

- 关键发现 1
- 关键发现 2

1. 第一步动作
2. 第二步动作

\`\`\`typescript
const metric = 42;
\`\`\`
`;

  const blocks = parseMarkdown(sampleMarkdown);

  // 1. Heading
  const heading = blocks.find((b) => b.type === 'heading' && b.level === 1);
  assert.ok(heading, 'Heading 1 should be parsed');
  assert.equal(heading.text, '行业调研报告');

  // 2. Table
  const table = blocks.find((b) => b.type === 'table');
  assert.ok(table, 'Table should be parsed');
  if (table && table.type === 'table') {
    assert.deepEqual(table.rawHeaders, ['平台', '采集条数', '覆盖率']);
    assert.deepEqual(table.alignments, ['left', 'center', 'right']);
    assert.equal(table.rows.length, 2);
    assert.deepEqual(table.rawRows[0], ['抖音', '120', '85%']);
    assert.deepEqual(table.rawRows[1], ['小红书', '240', '92%']);
  }

  // 3. Blockquote
  const quote = blocks.find((b) => b.type === 'blockquote');
  assert.ok(quote, 'Blockquote should be parsed');

  // 4. Lists
  const bulletList = blocks.find((b) => b.type === 'bullet_list');
  assert.ok(bulletList, 'Bullet list should be parsed');
  if (bulletList && bulletList.type === 'bullet_list') {
    assert.equal(bulletList.items.length, 2);
  }

  const orderedList = blocks.find((b) => b.type === 'ordered_list');
  assert.ok(orderedList, 'Ordered list should be parsed');
  if (orderedList && orderedList.type === 'ordered_list') {
    assert.equal(orderedList.items.length, 2);
  }

  // 5. Code Block
  const codeBlock = blocks.find((b) => b.type === 'code_block');
  assert.ok(codeBlock, 'Code block should be parsed');
  if (codeBlock && codeBlock.type === 'code_block') {
    assert.equal(codeBlock.lang, 'typescript');
    assert.match(codeBlock.code, /const metric = 42;/);
  }
});

test('formalReportRenderer renders DOCX with Table and styled runs without errors', async () => {
  const artifact = {
    artifactId: 'test-artifact-docx',
    title: '自动化测试研究报告',
    content: `
## 核心数据对比

| 指标维度 | 对比基线 | 本期结果 | 增幅 |
| :--- | :---: | :---: | ---: |
| 采集文档 | 1,000 | 1,500 | +50% |
| 实体数量 | 320 | 480 | +50% |

- 发现 **加粗结论** 与 \`代码示例\`
- 引用溯源 [S1]
`,
    citations: [
      { id: 'S1', title: '测试文档来源', source: 'bing', sourceUrl: 'https://example.com/source1', excerpt: '证据摘录' },
    ],
    graphId: 'graph-123',
    createdAt: new Date().toISOString(),
  };

  const docxBuffer = await formalReportRenderer.docx(artifact);
  assert.ok(docxBuffer instanceof Buffer);
  assert.ok(docxBuffer.length > 1000);
  // DOCX files are zip archives starting with PK (0x50 0x4B)
  assert.equal(docxBuffer[0], 0x50);
  assert.equal(docxBuffer[1], 0x4B);
});

test('formalReportRenderer renders PDF with Table and vector elements without errors', async () => {
  const artifact = {
    artifactId: 'test-artifact-pdf',
    title: '自动化测试研究报告 (PDF)',
    content: `
## 核心数据对比

| 指标维度 | 对比基线 | 本期结果 | 增幅 |
| :--- | :---: | :---: | ---: |
| 采集文档 | 1,000 | 1,500 | +50% |
| 实体数量 | 320 | 480 | +50% |

> 这是引用说明

\`\`\`json
{ "status": "ok" }
\`\`\`
`,
    citations: [
      { id: 'S1', title: '测试文档来源', source: 'bing', sourceUrl: 'https://example.com/source1', excerpt: '证据摘录' },
    ],
    graphId: 'graph-123',
    createdAt: new Date().toISOString(),
  };

  const pdfBuffer = await formalReportRenderer.pdf(artifact);
  assert.ok(pdfBuffer instanceof Buffer);
  assert.ok(pdfBuffer.length > 500);
  // PDF files start with %PDF
  const header = pdfBuffer.slice(0, 5).toString('utf8');
  assert.equal(header.startsWith('%PDF'), true);

  // Assert page count does not have runaway blank pages
  const pageMatches = pdfBuffer.toString('binary').match(/\/Type\s*\/Page\b/g);
  assert.equal(pageMatches ? pageMatches.length : 0, 1);
});

test('reportArtifactService renders HTML with Table and rich elements', () => {
  const Database = require('better-sqlite3');
  const { initSchema } = require('../src/database/schema');
  const { ReportArtifactService } = require('../src/analyzers/report-artifact-service');

  const db = new Database(':memory:');
  initSchema(db);

  db.prepare(`
    INSERT OR IGNORE INTO agent_threads
      (thread_id, title, created_at, updated_at)
    VALUES ('th-1', 'th-1', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO workflow_runs
      (workflow_id, thread_id, skill_id, skill_version, goal, status, input_json, output_json, created_at, updated_at)
    VALUES ('wf-1', 'th-1', 'test', '1', 'goal', 'completed', '{}', '{}', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO analysis_reports
      (report_id, analyzer_id, analyzer_version, workflow_id, title, content, created_at)
    VALUES ('rep-1', 'test', '1', 'wf-1', '标题', '内容', datetime('now'))
  `).run();
  db.prepare(`
    INSERT OR IGNORE INTO graph_snapshots
      (graph_id, scope_type, scope_id, created_at)
    VALUES ('graph-test', 'workflow', 'wf-1', datetime('now'))
  `).run();

  const mockGraphService = {
    latest: () => ({ id: 'graph-test' }),
    rebuild: () => ({ id: 'graph-test' }),
  };

  const service = new ReportArtifactService(() => db, mockGraphService as any);

  const created = service.create({
    reportId: 'rep-1',
    threadId: 'th-1',
    title: 'HTML 测试报告',
    content: `
# 标题一

这是 **加粗重点** 和 [S1] 证据。

| 平台 | 数量 | 占比 |
| :--- | :---: | ---: |
| 抖音 | 100 | 50% |

\`\`\`javascript
console.log("hello");
\`\`\`
`,
    sources: [{ id: 'S1', title: '来源1', sourceUrl: 'https://example.com' }],
  });

  const rendered = service.render(created.artifactId, 'html');
  assert.equal(rendered.contentType, 'text/html; charset=utf-8');
  const html = rendered.body.toString('utf-8');

  // Verify HTML elements
  assert.match(html, /<table class="report-table">/);
  assert.match(html, /<th[^>]*>平台<\/th>/);
  assert.match(html, /<td[^>]*>抖音<\/td>/);
  assert.match(html, /<strong>加粗重点<\/strong>/);
  assert.match(html, /<span class="citation">\[S1\]<\/span>/);
  assert.match(html, /<pre><code class="language-javascript">/);
});

