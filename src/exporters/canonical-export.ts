import type { CanonicalDocument } from '../core/documents/canonical';

export type CanonicalExportFormat = 'csv' | 'json' | 'markdown';

function scalar(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function csvCell(value: unknown): string {
  return `"${scalar(value).replace(/"/g, '""')}"`;
}

function metricKeys(documents: CanonicalDocument[]): string[] {
  return [...new Set(documents.flatMap((document) => Object.keys(document.metrics)))].sort();
}

function attributeKeys(documents: CanonicalDocument[]): string[] {
  return [...new Set(documents.flatMap((document) => Object.keys(document.attributes)))].sort();
}

export function canonicalDocumentsToCsv(documents: CanonicalDocument[]): string {
  const metrics = metricKeys(documents);
  const attributes = attributeKeys(documents);
  const fixed = [
    ['documentId', '文档ID'], ['platform', '平台'], ['originalPlatform', '原始平台'],
    ['kind', '类型'], ['keyword', '关键词'], ['rank', '排名'], ['sourceItemId', '来源内容ID'],
    ['parentSourceItemId', '父级来源ID'], ['title', '标题'], ['summary', '摘要'], ['markdown', '正文'],
    ['subject.id', '主体ID'], ['subject.name', '主体名称'], ['subject.type', '主体类型'],
    ['publishedAt', '发布时间'], ['sourceUpdatedAt', '来源更新时间'], ['fetchedAt', '采集时间'],
    ['sourceUrl', '来源链接'], ['language', '语言'], ['citations', '引用JSON'], ['assets', '资源JSON'],
  ] as const;
  const columns = [
    ...fixed.map(([key, header]) => ({ key, header })),
    ...metrics.map((key) => ({ key: `metrics.${key}`, header: `指标:${key}` })),
    ...attributes.map((key) => ({ key: `attributes.${key}`, header: `属性:${key}` })),
  ];
  const read = (document: CanonicalDocument, key: string): unknown => {
    if (key.startsWith('metrics.')) return document.metrics[key.slice(8)];
    if (key.startsWith('attributes.')) return document.attributes[key.slice(11)];
    if (key === 'subject.id') return document.subject.id;
    if (key === 'subject.name') return document.subject.name;
    if (key === 'subject.type') return document.subject.type;
    return (document as unknown as Record<string, unknown>)[key];
  };
  return [
    `\ufeff${columns.map((column) => csvCell(column.header)).join(',')}`,
    ...documents.map((document) => columns.map((column) => csvCell(read(document, column.key))).join(',')),
  ].join('\n');
}

export function canonicalDocumentsToMarkdown(documents: CanonicalDocument[]): string {
  return documents.map((document) => {
    const facts = {
      platform: document.platform,
      originalPlatform: document.originalPlatform,
      kind: document.kind,
      keyword: document.keyword,
      subject: document.subject,
      publishedAt: document.publishedAt,
      sourceUrl: document.sourceUrl,
      metrics: document.metrics,
      attributes: document.attributes,
      citations: document.citations,
    };
    return [
      `# ${document.title || '无标题文档'}`,
      '',
      document.summary ? `> ${document.summary.replace(/\n/g, '\n> ')}` : '',
      '',
      document.markdown,
      '',
      '## Canonical metadata',
      '',
      '```json',
      JSON.stringify(facts, null, 2),
      '```',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
  }).join('\n\n---\n\n');
}

export function renderCanonicalExport(format: CanonicalExportFormat, documents: CanonicalDocument[]): {
  content: string;
  contentType: string;
  extension: string;
} {
  if (format === 'json') {
    return {
      content: JSON.stringify({ schemaVersion: 2, count: documents.length, documents }, null, 2),
      contentType: 'application/json; charset=utf-8',
      extension: 'json',
    };
  }
  if (format === 'markdown') {
    return {
      content: canonicalDocumentsToMarkdown(documents),
      contentType: 'text/markdown; charset=utf-8',
      extension: 'md',
    };
  }
  return {
    content: canonicalDocumentsToCsv(documents),
    contentType: 'text/csv; charset=utf-8',
    extension: 'csv',
  };
}
