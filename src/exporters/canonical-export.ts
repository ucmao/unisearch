import ExcelJS from 'exceljs';
import type { CanonicalDocument } from '../core/documents/canonical';

export type CanonicalExportFormat = 'xlsx' | 'csv' | 'json';
export type CanonicalExportFieldMode = 'recommended' | 'visible' | 'all';

interface ExportColumn {
  key: string;
  header: string;
  width?: number;
}

export interface CanonicalExportOptions {
  fieldMode?: CanonicalExportFieldMode;
  fields?: string[];
  metadata?: Record<string, string | number | undefined>;
}

const METRIC_LABELS: Record<string, string> = {
  likes: '点赞数', saves: '收藏数', comments: '评论数', shares: '分享数', views: '浏览/播放数',
  replies: '回复数', voteups: '赞同数', coins: '投币数', danmaku: '弹幕数',
  score: '热度分', sourceCount: '来源数', signalCount: '信号数', reportCount: '报道数',
  stars: 'Stars', forks: 'Forks', watchers: '关注数', openIssues: '开放议题数', subscribers: '订阅数',
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  salary: '薪资', city: '城市', experience: '经验', education: '学历', skills: '技能要求', welfare: '福利', status: '状态',
  companyIndustry: '公司行业', companyStage: '融资阶段', companyScale: '公司规模',
  amount: '金额', request: '诉求', domain: '域名', forumName: '社区', questionId: '问题 ID',
  forumUrl: '社区链接', mediaType: '媒体类型', tags: '标签', category: '分类',
  originalTitle: '原始标题', originalUrl: '原始链接', attribution: '信息来源', discoveredAt: '发现时间',
  contentMode: '内容模式', storyUrl: '事件链接', storyStatus: '事件状态', sourceNames: '来源列表',
  reports: '相关报道', storyline: '事件脉络', related: '相关内容', dailyDate: '日报日期',
  dailySection: '日报栏目', reportUrl: '报道链接', arxivId: 'arXiv ID', version: '论文版本',
  authors: '作者列表', categories: '分类列表', primaryCategory: '主分类', pdfUrl: 'PDF 链接',
  doi: 'DOI', journalRef: '期刊信息', comment: '备注', fullName: '仓库全名', creatorUrl: '作者主页',
  homepage: '项目主页', topics: '主题', licenseName: '许可证', sizeKb: '仓库大小（KB）',
  defaultBranch: '默认分支', createdAt: '创建时间', pushedAt: '最近推送时间', archived: '是否归档',
  isFork: '是否 Fork', visibility: '可见性', period: '时间范围', author: '作者', feedUrl: '订阅源链接',
  feedTitle: '订阅源名称', siteName: '网站名称',
};

const FIXED_COLUMNS: ExportColumn[] = [
  { key: 'schemaVersion', header: '数据版本', width: 12 },
  { key: 'documentId', header: '文档 ID', width: 28 },
  { key: 'canonicalKey', header: '规范键', width: 28 },
  { key: 'platform', header: '平台', width: 12 },
  { key: 'originalPlatform', header: '原始平台', width: 12 },
  { key: 'kind', header: '类型', width: 12 },
  { key: 'keyword', header: '关键词', width: 18 },
  { key: 'rank', header: '排名', width: 10 },
  { key: 'sourceItemId', header: '来源内容 ID', width: 24 },
  { key: 'parentSourceItemId', header: '父级来源 ID', width: 24 },
  { key: 'title', header: '标题', width: 36 },
  { key: 'summary', header: '摘要', width: 48 },
  { key: 'markdown', header: '正文', width: 64 },
  { key: 'subject.id', header: '主体 ID', width: 24 },
  { key: 'subject.name', header: '作者/主体', width: 20 },
  { key: 'subject.type', header: '主体类型', width: 14 },
  { key: 'publishedAt', header: '发布时间', width: 22 },
  { key: 'sourceUpdatedAt', header: '来源更新时间', width: 22 },
  { key: 'fetchedAt', header: '采集时间', width: 22 },
  { key: 'sourceUrl', header: '内容链接', width: 48 },
  { key: 'language', header: '语言', width: 10 },
  { key: 'citations', header: '引用 JSON', width: 40 },
  { key: 'assets', header: '资源 JSON', width: 40 },
  { key: 'provenance', header: '来源追踪 JSON', width: 40 },
  { key: 'contentHash', header: '内容哈希', width: 28 },
  { key: 'createdAt', header: '创建时间', width: 22 },
  { key: 'updatedAt', header: '更新时间', width: 22 },
];

const RECOMMENDED_FIXED_KEYS = [
  'title', 'summary', 'markdown', 'platform', 'kind', 'subject.name', 'keyword', 'rank',
  'publishedAt', 'sourceUrl', 'fetchedAt',
];

function scalar(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function csvCell(value: unknown): string {
  return `"${scalar(value).replace(/"/g, '""')}"`;
}

function read(document: CanonicalDocument, key: string): unknown {
  if (key.startsWith('metrics.')) return document.metrics[key.slice(8)];
  if (key.startsWith('attributes.')) return document.attributes[key.slice(11)];
  if (key === 'subject.id') return document.subject.id;
  if (key === 'subject.name') return document.subject.name;
  if (key === 'subject.type') return document.subject.type;
  return (document as unknown as Record<string, unknown>)[key];
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function dynamicColumns(documents: CanonicalDocument[]): ExportColumn[] {
  const metrics = [...new Set(documents.flatMap((document) => Object.keys(document.metrics)))].sort();
  const attributes = [...new Set(documents.flatMap((document) => Object.keys(document.attributes)))].sort();
  return [
    ...metrics.map((key) => ({ key: `metrics.${key}`, header: METRIC_LABELS[key] || key, width: 14 })),
    ...attributes.map((key) => ({ key: `attributes.${key}`, header: ATTRIBUTE_LABELS[key] || key, width: 20 })),
  ];
}

function populated(documents: CanonicalDocument[], column: ExportColumn): boolean {
  return documents.some((document) => hasValue(read(document, column.key)));
}

export function selectCanonicalExportColumns(
  documents: CanonicalDocument[],
  options: CanonicalExportOptions = {},
): ExportColumn[] {
  const mode = options.fieldMode || 'recommended';
  const dynamic = dynamicColumns(documents);
  const all = [...FIXED_COLUMNS, ...dynamic];

  if (mode === 'all') return all;

  if (mode === 'visible') {
    const byKey = new Map(all.map((column) => [column.key, column]));
    return [...new Set(options.fields || [])]
      .map((key) => byKey.get(key))
      .filter((column): column is ExportColumn => Boolean(column));
  }

  const fixedByKey = new Map(FIXED_COLUMNS.map((column) => [column.key, column]));
  const fixed = RECOMMENDED_FIXED_KEYS
    .map((key) => fixedByKey.get(key))
    .filter((column): column is ExportColumn => Boolean(column))
    .filter((column) => populated(documents, column));
  const business = dynamic.filter((column) => {
    const [group, key] = column.key.split('.', 2);
    const isBusinessField = group === 'metrics' ? Boolean(METRIC_LABELS[key]) : Boolean(ATTRIBUTE_LABELS[key]);
    return isBusinessField && populated(documents, column);
  });
  return [...fixed.slice(0, 7), ...business, ...fixed.slice(7)];
}

export function canonicalDocumentsToCsv(documents: CanonicalDocument[], options: CanonicalExportOptions = {}): string {
  const columns = selectCanonicalExportColumns(documents, options);
  return [
    `\ufeff${columns.map((column) => csvCell(column.header)).join(',')}`,
    ...documents.map((document) => columns.map((column) => csvCell(read(document, column.key))).join(',')),
  ].join('\n');
}

export async function canonicalDocumentsToXlsx(
  documents: CanonicalDocument[],
  options: CanonicalExportOptions = {},
): Promise<Buffer> {
  const columns = selectCanonicalExportColumns(documents, options);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'UniSearch';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('数据明细', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key, width: column.width || 18 }));
  sheet.autoFilter = columns.length ? { from: 'A1', to: { row: 1, column: columns.length } } : undefined;

  const header = sheet.getRow(1);
  header.height = 24;
  header.eachCell((cell) => {
    cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF167D9A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  documents.forEach((document) => {
    const row = sheet.addRow(Object.fromEntries(columns.map((column) => [column.key, scalar(read(document, column.key))])));
    row.alignment = { vertical: 'top', wrapText: true };
    row.font = { name: 'Microsoft YaHei', size: 9 };
  });

  const info = workbook.addWorksheet('导出说明');
  info.columns = [{ width: 20 }, { width: 70 }];
  const metadata = {
    '数据条数': documents.length,
    '字段模式': options.fieldMode === 'all' ? '全部原始字段' : options.fieldMode === 'visible' ? '当前显示字段' : '推荐字段',
    '导出时间': new Date().toLocaleString('zh-CN'),
    ...options.metadata,
  };
  Object.entries(metadata).filter(([, value]) => value !== undefined).forEach(([key, value]) => info.addRow([key, value]));
  info.getColumn(1).font = { name: 'Microsoft YaHei', bold: true, size: 10 };
  info.getColumn(2).font = { name: 'Microsoft YaHei', size: 10 };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function renderCanonicalExport(format: Exclude<CanonicalExportFormat, 'xlsx'>, documents: CanonicalDocument[], options: CanonicalExportOptions = {}): {
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
  return {
    content: canonicalDocumentsToCsv(documents, options),
    contentType: 'text/csv; charset=utf-8',
    extension: 'csv',
  };
}
