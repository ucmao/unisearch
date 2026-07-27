import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { renderCanonicalExport } from '../src/exporters/canonical-export';

function document() {
  return mapRawItemToCanonicalDocument(buildRawItem('emitZhaopinResult', {
    content_id: 'job-export-1',
    title: '后端工程师',
    company_name: '示例科技',
    salary: '25-40K',
    work_city: '上海',
    desc: '负责统一搜索服务。',
    content_url: 'https://example.com/jobs/1',
  }));
}

test('canonical unified export renders CSV with dynamic attribute columns', () => {
  const rendered = renderCanonicalExport('csv', [document()]);
  assert.equal(rendered.extension, 'csv');
  assert.match(rendered.content, /属性:salary/);
  assert.match(rendered.content, /25-40K/);
  assert.match(rendered.content, /示例科技/);
});

test('canonical unified export renders JSON and Markdown from the same document contract', () => {
  const json = renderCanonicalExport('json', [document()]);
  assert.equal(JSON.parse(json.content).schemaVersion, 2);
  assert.equal(JSON.parse(json.content).documents[0].subject.type, 'company');

  const markdown = renderCanonicalExport('markdown', [document()]);
  assert.equal(markdown.extension, 'md');
  assert.match(markdown.content, /Canonical metadata/);
  assert.match(markdown.content, /负责统一搜索服务/);
});
