import { createHash } from 'crypto';
import type { RawItem } from '../../core/contracts/raw-item';
import {
  CANONICAL_DOCUMENT_SCHEMA_VERSION,
  canonicalDocumentSchema,
  type CanonicalDocument,
  type Citation,
  type SubjectType,
} from '../../core/documents/canonical';

type Payload = Record<string, any>;
type ConnectorFamily = 'social' | 'search' | 'ai_qa' | 'job' | 'complaint' | 'media' | 'comment';

export interface ConnectorMappingDefinition {
  family: Exclude<ConnectorFamily, 'comment'>;
  subjectType: SubjectType;
  metricAliases: Record<string, string[]>;
  attributeAliases: Record<string, string[]>;
}

const SOCIAL_METRICS: Record<string, string[]> = {
  likes: ['likes', 'liked_count', 'like_count', 'comment_like_count', 'voteup_count', 'total_liked', 'attitudes_count'],
  saves: ['saves', 'collected_count', 'video_favorite_count'],
  comments: ['comments', 'comment_count', 'comments_count', 'video_comment', 'total_replay_num', 'reply_count'],
  shares: ['shares', 'share_count', 'shared_count', 'video_share_count'],
  views: ['views', 'viewd_count', 'video_play_count', 'play_count'],
  replies: ['sub_comment_count'],
};

const SOCIAL_BASE: Omit<ConnectorMappingDefinition, 'attributeAliases'> = {
  family: 'social', subjectType: 'creator', metricAliases: SOCIAL_METRICS,
};

const SEARCH_DEFINITION: ConnectorMappingDefinition = {
  family: 'search', subjectType: 'publisher', metricAliases: {},
  attributeAliases: { domain: ['domain', 'site_name'] },
};

const AI_DEFINITION: ConnectorMappingDefinition = {
  family: 'ai_qa', subjectType: 'ai_platform', metricAliases: {},
  attributeAliases: { reasoningContent: ['reasoning_content'] },
};

/**
 * Executable mapping matrix for every registered connector. Raw aliases stay
 * here, at the ingestion boundary, rather than leaking into repositories/UI.
 */
export const CONNECTOR_MAPPING_MATRIX: Record<string, ConnectorMappingDefinition> = {
  xhs: { ...SOCIAL_BASE, attributeAliases: { tags: ['tag_list'] } },
  douyin: { ...SOCIAL_BASE, attributeAliases: {} },
  kuaishou: { ...SOCIAL_BASE, attributeAliases: {} },
  bili: {
    ...SOCIAL_BASE,
    metricAliases: {
      ...SOCIAL_METRICS,
      coins: ['coins', 'video_coin_count'],
      danmaku: ['danmaku', 'video_danmaku'],
    },
    attributeAliases: {},
  },
  weibo: { ...SOCIAL_BASE, attributeAliases: {} },
  tieba: {
    ...SOCIAL_BASE,
    attributeAliases: {
      forumName: ['forum_name'],
      forumUrl: ['forum_url'],
    },
  },
  zhihu: {
    ...SOCIAL_BASE,
    attributeAliases: { questionId: ['question_id'] },
  },
  baidu: SEARCH_DEFINITION,
  bing: SEARCH_DEFINITION,
  so360: SEARCH_DEFINITION,
  sogou: SEARCH_DEFINITION,
  toutiao: SEARCH_DEFINITION,
  aihot: {
    family: 'search', subjectType: 'publisher',
    metricAliases: {
      score: ['score'],
      sourceCount: ['source_count'],
      signalCount: ['signal_count'],
      reportCount: ['report_count'],
    },
    attributeAliases: {
      category: ['category'],
      selected: ['selected'],
      originalTitle: ['original_title'],
      originalUrl: ['original_url'],
      attribution: ['attribution'],
      discoveredAt: ['discovered_at'],
      contentMode: ['content_mode'],
      storyUrl: ['story_url'],
      storyStatus: ['story_status'],
      sourceNames: ['source_names'],
      reports: ['reports'],
      storyline: ['storyline'],
      related: ['related'],
      dailyDate: ['daily_date'],
      dailySection: ['daily_section'],
      reportUrl: ['report_url'],
    },
  },
  arxiv: {
    family: 'search', subjectType: 'creator', metricAliases: {},
    attributeAliases: {
      arxivId: ['arxiv_id'],
      version: ['version'],
      authors: ['authors'],
      categories: ['categories'],
      primaryCategory: ['primary_category'],
      pdfUrl: ['pdf_url'],
      doi: ['doi'],
      journalRef: ['journal_ref'],
      comment: ['comment'],
    },
  },
  github_repositories: {
    family: 'search', subjectType: 'creator',
    metricAliases: {
      stars: ['stars', 'stargazers_count'],
      forks: ['forks', 'forks_count'],
      watchers: ['watchers', 'watchers_count'],
      openIssues: ['open_issues', 'open_issues_count'],
      subscribers: ['subscribers', 'subscribers_count'],
    },
    attributeAliases: {
      repositoryId: ['repository_id'],
      nodeId: ['node_id'],
      fullName: ['full_name'],
      creatorUrl: ['creator_url'],
      apiUrl: ['api_url'],
      homepage: ['homepage'],
      topics: ['topics'],
      license: ['license'],
      licenseName: ['license_name'],
      sizeKb: ['size_kb'],
      defaultBranch: ['default_branch'],
      createdAt: ['created_at'],
      pushedAt: ['pushed_at'],
      archived: ['archived'],
      disabled: ['disabled'],
      isFork: ['is_fork'],
      isPrivate: ['is_private'],
      visibility: ['visibility'],
      searchMode: ['search_mode'],
      period: ['period'],
    },
  },
  rss_news: {
    family: 'search', subjectType: 'publisher', metricAliases: {},
    attributeAliases: {
      guid: ['guid'],
      author: ['author'],
      feedUrl: ['feed_url'],
      feedTitle: ['feed_title'],
      categories: ['categories'],
    },
  },
  media_parser: {
    family: 'media', subjectType: 'creator', metricAliases: {},
    attributeAliases: { mediaType: ['media_type', 'type'] },
  },
  web_reader: {
    family: 'search', subjectType: 'publisher', metricAliases: {},
    attributeAliases: {
      siteName: ['site_name'],
    },
  },
  zhaopin: {
    family: 'job', subjectType: 'company', metricAliases: {},
    attributeAliases: {
      salary: ['salary', 'salary60'],
      city: ['work_city', 'city_name'],
      experience: ['job_experience', 'working_exp'],
      education: ['education', 'edu_level'],
    },
  },
  job51: {
    family: 'job', subjectType: 'company', metricAliases: {},
    attributeAliases: {
      salary: ['salary', 'providesalary_text'],
      city: ['work_city', 'workarea_text'],
      experience: ['job_experience', 'workyear_text'],
      education: ['education', 'degree_text'],
    },
  },
  liepin: {
    family: 'job', subjectType: 'company', metricAliases: {},
    attributeAliases: {
      salary: ['salary'],
      city: ['work_city'],
      experience: ['job_experience'],
      education: ['education'],
    },
  },
  boss: {
    family: 'job', subjectType: 'company', metricAliases: {},
    attributeAliases: {
      salary: ['salary', 'salary_desc', 'salaryDesc'],
      city: ['work_city', 'city_name', 'cityName'],
      experience: ['job_experience', 'experience', 'jobExperience'],
      education: ['education', 'degree_name', 'job_degree', 'jobDegree'],
      skills: ['skills', 'job_skills', 'jobSkills'],
      welfare: ['welfare', 'benefits', 'welfare_labels', 'welfareLabels'],
      companyIndustry: ['company_industry', 'industry_name', 'industryName'],
      companyStage: ['company_stage', 'stage_name', 'stageName'],
      companyScale: ['company_scale', 'scale_name', 'scaleName'],
    },
  },
  heimao: {
    family: 'complaint', subjectType: 'merchant', metricAliases: {},
    attributeAliases: {
      status: ['status', 'complaint_status'],
      amount: ['amount', 'complaint_amount'],
      request: ['request', 'appeal'],
    },
  },
  deepseek: AI_DEFINITION,
  kimi: AI_DEFINITION,
  doubao: AI_DEFINITION,
  qwen: AI_DEFINITION,
  yuanbao: AI_DEFINITION,
  nami: AI_DEFINITION,
  wenxin: AI_DEFINITION,
};

const AI_PLATFORM_NAMES: Record<string, string> = {
  deepseek: 'DeepSeek', kimi: 'Kimi', doubao: '豆包', qwen: '通义千问',
  yuanbao: '腾讯元宝', nami: '纳米AI', wenxin: '文心一言',
};

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function first(payload: Payload, keys: string[]): unknown {
  for (const key of keys) if (present(payload[key])) return payload[key];
  return undefined;
}

function firstString(payload: Payload, keys: string[]): string | undefined {
  const value = first(payload, keys);
  return value === undefined ? undefined : String(value).trim();
}

function parseMetric(value: unknown): number | undefined {
  if (!present(value)) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
  const text = String(value).trim().toLowerCase().replace(/,/g, '').replace(/\+/g, '');
  const suffix = text.at(-1) || '';
  const multiplier = suffix === '万' || suffix === 'w' ? 10_000 : suffix === '千' || suffix === 'k' ? 1_000 : 1;
  const parsed = Number.parseFloat(multiplier === 1 ? text : text.slice(0, -1));
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed * multiplier)) : undefined;
}

function compactText(value: string, maxLength = 180): string {
  const normalized = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trimEnd()}…` : normalized;
}

function canonicalMarkdown(item: RawItem, definition: ConnectorMappingDefinition): string {
  const value = String(item.hints.text || item.hints.title || '').trim();
  if (definition.family !== 'complaint') return value;
  // The legacy crawler prefixed these values into desc so the old social table
  // could display them. v2 stores them structurally and keeps markdown as body.
  return value.replace(/^(?:\[(?:投诉商家|被投诉方|状态):[^\]]*\]\s*)+/u, '').trim();
}

function definedRecord(aliases: Record<string, string[]>, payload: Payload): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [canonical, keys] of Object.entries(aliases)) {
    const value = first(payload, keys);
    if (value !== undefined) result[canonical] = value;
  }
  return result;
}

function metrics(definition: ConnectorMappingDefinition, payload: Payload): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [canonical, aliases] of Object.entries(definition.metricAliases)) {
    const value = parseMetric(first(payload, aliases));
    if (value !== undefined) result[canonical] = value;
  }
  return result;
}

function subject(item: RawItem, definition: ConnectorMappingDefinition): CanonicalDocument['subject'] {
  const payload = item.payload as Payload;
  const id = firstString(payload, [
    'creator_id', 'creator_hash', 'user_id', 'author_id', 'company_id', 'brand_id', 'brandId', 'merchant_id',
  ]);
  const payloadName = firstString(payload, [
    'creator_name', 'nickname', 'user_nickname', 'publisher', 'company_name', 'brand_name', 'brandName',
    'merchant_name', 'forum_name',
  ]);
  const name = definition.family === 'ai_qa'
    ? payloadName || AI_PLATFORM_NAMES[item.source] || item.source
    : payloadName || item.hints.author;
  return { ...(id ? { id } : {}), ...(name ? { name } : {}), type: definition.subjectType };
}

function citations(payload: Payload): Citation[] {
  const raw = payload.citations;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: Citation[] = [];
  for (const entry of raw) {
    const url = typeof entry === 'string' ? entry : firstString(entry || {}, ['url', 'href', 'link']);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = typeof entry === 'object' && entry ? firstString(entry, ['title', 'name']) : undefined;
    const source = typeof entry === 'object' && entry ? firstString(entry, ['source', 'publisher']) : undefined;
    result.push({ url, ...(title ? { title } : {}), ...(source ? { source } : {}) });
  }
  return result;
}

function inferAssetKind(url: string): 'image' | 'video' | 'audio' | 'file' | 'unknown' {
  const path = url.toLowerCase().split('?')[0];
  if (/\.(?:png|jpe?g|gif|webp|avif|bmp)$/.test(path)) return 'image';
  if (/\.(?:mp4|mov|m4v|webm|mkv|avi)$/.test(path)) return 'video';
  if (/\.(?:mp3|wav|m4a|aac|flac|ogg)$/.test(path)) return 'audio';
  return 'unknown';
}

function inferAssetRole(
  url: string,
  kind: ReturnType<typeof inferAssetKind>,
  coverUrl: string | undefined,
  definition: ConnectorMappingDefinition,
): 'cover' | 'content' | 'thumbnail' | 'attachment' | 'unknown' {
  if (coverUrl && url === coverUrl) return 'cover';
  if (kind === 'file') return 'attachment';
  if (definition.family === 'search' && kind === 'image') return 'thumbnail';
  if (kind === 'image' || kind === 'video' || kind === 'audio') return 'content';
  return 'unknown';
}

function buildSummary(item: RawItem, definition: ConnectorMappingDefinition, attributes: Record<string, any>, markdown: string): string {
  const payload = item.payload as Payload;
  if (definition.family === 'job') {
    const facts = [attributes.salary, attributes.city, attributes.experience, attributes.education,
      firstString(payload, ['company_name', 'brand_name', 'brandName'])].filter(present).map(String);
    if (facts.length) return facts.join(' · ');
  }
  if (definition.family === 'complaint') {
    const facts = [firstString(payload, ['merchant_name', 'creator_name']), attributes.status,
      attributes.amount, attributes.request].filter(present).map(String);
    if (facts.length) return facts.join(' · ');
  }
  return compactText(firstString(payload, ['summary', 'snippet', 'excerpt']) || markdown || item.hints.title || '');
}

function sourceUpdatedAt(payload: Payload): string | number | undefined {
  const value = first(payload, ['updated_at', 'update_time', 'updated_time']);
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function rank(payload: Payload): number | undefined {
  const value = parseMetric(first(payload, ['rank', 'position', 'result_rank', 'search_rank']));
  return value === undefined ? undefined : value;
}

export function mapRawItemToCanonicalDocument(item: RawItem, runId?: string): CanonicalDocument {
  const definition = CONNECTOR_MAPPING_MATRIX[item.source];
  if (!definition) throw new Error(`No canonical mapping registered for connector: ${item.source}`);
  const payload = item.payload as Payload;
  const effectiveDefinition = item.kind === 'comment'
    ? { ...definition, subjectType: 'creator' as const }
    : definition;
  const attributes = definedRecord(effectiveDefinition.attributeAliases, payload);
  const markdown = canonicalMarkdown(item, effectiveDefinition);
  const title = String(item.hints.title || compactText(markdown, 80) || '').trim();
  const canonicalKey = item.kind === 'comment' || (item.source === 'github_repositories' && item.sourceItemId)
    ? `${item.source}:${item.kind}:${item.sourceItemId || item.id}`
    : item.sourceUrl || `${item.source}:${item.kind}:${item.sourceItemId || item.id}`;
  const documentId = hash(canonicalKey);
  const originalPlatform = item.source === 'media_parser'
    ? firstString(payload, ['platform', 'source_platform'])
    : undefined;
  const keyword = firstString(payload, ['source_keyword', 'keyword', 'question']);
  const coverUrl = item.hints.coverUrl?.trim() || undefined;
  // Keep the explicitly identified cover first and preserve its semantic role.
  // Some custom RawItem producers only populate coverUrl, while the built-in
  // connector output also includes it in mediaUrls.
  const urls = [...new Set([coverUrl, ...(item.hints.mediaUrls || [])].filter((url): url is string => Boolean(url)))];
  const now = item.fetchedAt;
  const resultRank = rank(payload);
  const updatedAt = sourceUpdatedAt(payload);

  return canonicalDocumentSchema.parse({
    schemaVersion: CANONICAL_DOCUMENT_SCHEMA_VERSION,
    documentId,
    canonicalKey,
    kind: item.kind,
    platform: item.source,
    ...(originalPlatform ? { originalPlatform } : {}),
    ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
    ...(item.parentId ? { parentSourceItemId: item.parentId } : {}),
    ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
    ...(keyword ? { keyword } : {}),
    ...(resultRank !== undefined ? { rank: resultRank } : {}),
    title,
    summary: buildSummary(item, effectiveDefinition, attributes, markdown),
    markdown,
    subject: subject(item, effectiveDefinition),
    ...(item.hints.publishedAt !== undefined ? { publishedAt: item.hints.publishedAt } : {}),
    ...(updatedAt !== undefined ? { sourceUpdatedAt: updatedAt } : {}),
    fetchedAt: item.fetchedAt,
    language: firstString(payload, ['language', 'lang']) || 'und',
    metrics: metrics(effectiveDefinition, payload),
    attributes,
    citations: citations(payload),
    assets: urls.map((url) => {
      const kind = inferAssetKind(url);
      return {
        assetId: hash(`${documentId}:${url}`),
        documentId,
        kind,
        role: inferAssetRole(url, kind, coverUrl, effectiveDefinition),
        url,
        metadata: {},
      };
    }),
    provenance: {
      source: item.source,
      ...(item.sourceItemId ? { sourceItemId: item.sourceItemId } : {}),
      ...(item.sourceUrl ? { sourceUrl: item.sourceUrl } : {}),
      rawItemId: item.id,
      ...(runId ? { runId } : {}),
      fetchedAt: item.fetchedAt,
    },
    contentHash: hash(markdown),
    createdAt: now,
    updatedAt: now,
  });
}
