import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRawItem } from '../src/connectors/output/connector-output';
import { mapRawItemToCanonicalDocument } from '../src/connectors/mappers/canonical-document-mapper';
import { canonicalDocumentsToXlsx, renderCanonicalExport } from '../src/exporters/canonical-export';

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

test('canonical unified export renders a user-facing CSV with populated business columns', () => {
  const rendered = renderCanonicalExport('csv', [document()]);
  assert.equal(rendered.extension, 'csv');
  assert.match(rendered.content, /薪资/);
  assert.match(rendered.content, /25-40K/);
  assert.match(rendered.content, /示例科技/);
  assert.doesNotMatch(rendered.content, /文档 ID/);
  assert.doesNotMatch(rendered.content, /资源 JSON/);
});

test('canonical CSV can export only the fields currently visible in the workbench', () => {
  const rendered = renderCanonicalExport('csv', [document()], {
    fieldMode: 'visible',
    fields: ['title', 'attributes.salary', 'sourceUrl'],
  });
  const [header] = rendered.content.replace(/^\ufeff/, '').split('\n');
  assert.equal(header, '"标题","薪资","内容链接"');
});

test('canonical Excel export includes a workbook payload', async () => {
  const rendered = await canonicalDocumentsToXlsx([document()], { fieldMode: 'recommended' });
  assert.equal(rendered.subarray(0, 2).toString(), 'PK');
  assert.ok(rendered.length > 1_000);
});

test('canonical unified export renders complete JSON from the document contract', () => {
  const json = renderCanonicalExport('json', [document()]);
  assert.equal(JSON.parse(json.content).schemaVersion, 2);
  assert.equal(JSON.parse(json.content).documents[0].subject.type, 'company');
});
