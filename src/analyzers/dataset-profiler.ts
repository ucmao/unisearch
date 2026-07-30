import type { CanonicalDocument } from '../core/documents/canonical';

export interface DistributionValue {
  value: string;
  count: number;
  percentage: number;
}

export interface CountDistribution {
  total: number;
  distinct: number;
  values: DistributionValue[];
}

export interface NumericSummary {
  validCount: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p25: number;
  p75: number;
}

export interface FieldProfile {
  presentCount: number;
  missingCount: number;
  coverageRate: number;
  types: Record<string, number>;
  distinctValueCount?: number;
  topValues?: DistributionValue[];
  numeric?: NumericSummary;
}

export interface DatasetProfile {
  documentCount: number;
  distributions: {
    platform: CountDistribution;
    kind: CountDistribution;
    keyword: CountDistribution;
    subjectType: CountDistribution;
  };
  timeRange: {
    publishedAt: { validCount: number; start?: string; end?: string };
    fetchedAt: { validCount: number; start?: string; end?: string };
  };
  fieldCoverage: Record<string, FieldProfile>;
  metrics: Record<string, FieldProfile>;
  attributes: Record<string, FieldProfile>;
  quality: {
    emptyTextDocumentCount: number;
    missingSourceUrlCount: number;
    invalidPublishedAtCount: number;
    duplicateCanonicalKeyCount: number;
    duplicateContentHashCount: number;
  };
}

function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percentage(count: number, total: number): number {
  return total ? round(count / total, 4) : 0;
}

function distribution(values: Array<string | undefined>, total = values.length): CountDistribution {
  const counts = new Map<string, number>();
  for (const rawValue of values) {
    const value = String(rawValue || '').trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const entries = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return {
    total,
    distinct: entries.length,
    values: entries.map(([value, count]) => ({ value, count, percentage: percentage(count, total) })),
  };
}

function quantile(sorted: number[], position: number): number {
  if (!sorted.length) return 0;
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function numericSummary(values: number[]): NumericSummary | undefined {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return undefined;
  return {
    validCount: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    median: round(quantile(sorted, 0.5)),
    p25: round(quantile(sorted, 0.25)),
    p75: round(quantile(sorted, 0.75)),
  };
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function categoricalValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return null;
}

function profileValues(values: unknown[], documentCount: number): FieldProfile {
  const present = values.filter(isPresent);
  const types = new Map<string, number>();
  const numbers: number[] = [];
  const categories: string[] = [];
  for (const value of present) {
    const type = valueType(value);
    types.set(type, (types.get(type) || 0) + 1);
    if (typeof value === 'number' && Number.isFinite(value)) numbers.push(value);
    const category = categoricalValue(value);
    if (category !== null) categories.push(category);
  }
  const categoryDistribution = distribution(categories, present.length);
  return {
    presentCount: present.length,
    missingCount: Math.max(0, documentCount - present.length),
    coverageRate: percentage(present.length, documentCount),
    types: Object.fromEntries([...types.entries()].sort(([left], [right]) => left.localeCompare(right))),
    ...(categories.length ? {
      distinctValueCount: categoryDistribution.distinct,
      topValues: categoryDistribution.values.slice(0, 10),
    } : {}),
    ...(numbers.length ? { numeric: numericSummary(numbers) } : {}),
  };
}

function timestamp(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = typeof value === 'number'
    ? (value < 1_000_000_000_000 ? value * 1000 : value)
    : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeRange(values: Array<string | number | undefined>): { validCount: number; start?: string; end?: string } {
  const timestamps = values.map(timestamp).filter((value): value is number => value !== null).sort((a, b) => a - b);
  return timestamps.length ? {
    validCount: timestamps.length,
    start: new Date(timestamps[0]).toISOString(),
    end: new Date(timestamps[timestamps.length - 1]).toISOString(),
  } : { validCount: 0 };
}

function repeatedValueCount(values: string[]): number {
  const unique = new Set(values.filter(Boolean));
  return Math.max(0, values.filter(Boolean).length - unique.size);
}

function dynamicProfiles(
  documents: CanonicalDocument[],
  select: (document: CanonicalDocument) => Record<string, unknown>,
): Record<string, FieldProfile> {
  const keys = new Set(documents.flatMap((document) => Object.keys(select(document))));
  return Object.fromEntries([...keys].sort().map((key) => [
    key,
    profileValues(documents.map((document) => select(document)[key]), documents.length),
  ]));
}

export function profileDataset(documents: CanonicalDocument[]): DatasetProfile {
  const documentCount = documents.length;
  const publishedRange = timeRange(documents.map((document) => document.publishedAt));
  const fetchedRange = timeRange(documents.map((document) => document.fetchedAt));
  return {
    documentCount,
    distributions: {
      platform: distribution(documents.map((document) => document.platform), documentCount),
      kind: distribution(documents.map((document) => document.kind), documentCount),
      keyword: distribution(documents.map((document) => document.keyword), documentCount),
      subjectType: distribution(documents.map((document) => document.subject.type), documentCount),
    },
    timeRange: { publishedAt: publishedRange, fetchedAt: fetchedRange },
    fieldCoverage: {
      title: profileValues(documents.map((document) => document.title), documentCount),
      summary: profileValues(documents.map((document) => document.summary), documentCount),
      markdown: profileValues(documents.map((document) => document.markdown), documentCount),
      sourceUrl: profileValues(documents.map((document) => document.sourceUrl), documentCount),
      keyword: profileValues(documents.map((document) => document.keyword), documentCount),
      publishedAt: profileValues(documents.map((document) => document.publishedAt), documentCount),
      subjectId: profileValues(documents.map((document) => document.subject.id), documentCount),
      subjectName: profileValues(documents.map((document) => document.subject.name), documentCount),
    },
    metrics: dynamicProfiles(documents, (document) => document.metrics),
    attributes: dynamicProfiles(documents, (document) => document.attributes),
    quality: {
      emptyTextDocumentCount: documents.filter((document) => !document.title.trim() && !document.summary.trim() && !document.markdown.trim()).length,
      missingSourceUrlCount: documents.filter((document) => !document.sourceUrl).length,
      invalidPublishedAtCount: documentCount - publishedRange.validCount - documents.filter((document) => document.publishedAt === undefined).length,
      duplicateCanonicalKeyCount: repeatedValueCount(documents.map((document) => document.canonicalKey)),
      duplicateContentHashCount: repeatedValueCount(documents.map((document) => document.contentHash)),
    },
  };
}

function distributionLines(label: string, value: CountDistribution): string[] {
  return [
    `### ${label}`,
    '',
    ...(value.values.length
      ? value.values.map((item) => `- ${item.value}: ${item.count}（${round(item.percentage * 100, 2)}%）`)
      : ['- 暂无有效值']),
    '',
  ];
}

export function renderDatasetProfile(profile: DatasetProfile): string {
  const metricLines = Object.entries(profile.metrics).map(([key, value]) => {
    const numeric = value.numeric;
    return numeric
      ? `- ${key}: 有效 ${numeric.validCount}，中位数 ${numeric.median}，P25–P75 ${numeric.p25}–${numeric.p75}，范围 ${numeric.min}–${numeric.max}`
      : `- ${key}: 覆盖 ${value.presentCount}/${profile.documentCount}`;
  });
  return [
    '# 数据集全量统计',
    '',
    `共对 ${profile.documentCount} 个去重文档执行确定性统计。`,
    '',
    ...distributionLines('平台分布', profile.distributions.platform),
    ...distributionLines('内容类型', profile.distributions.kind),
    ...distributionLines('关键词分布', profile.distributions.keyword),
    '### 数值指标',
    '',
    ...(metricLines.length ? metricLines : ['- 暂无数值指标']),
    '',
    '### 数据质量',
    '',
    `- 空文本：${profile.quality.emptyTextDocumentCount}`,
    `- 缺少来源链接：${profile.quality.missingSourceUrlCount}`,
    `- 无效发布时间：${profile.quality.invalidPublishedAtCount}`,
    `- 重复正文哈希：${profile.quality.duplicateContentHashCount}`,
  ].join('\n');
}
