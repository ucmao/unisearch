import { randomUUID } from 'crypto';
import { RAW_ITEM_SCHEMA_VERSION, parseRawItem, type RawItem, type RawItemKind } from '../../core/contracts/raw-item';
import type { OutputSink, OutputSinkContext, OutputSinkResult } from '../../core/sinks/types';

type Payload = Record<string, any>;
type AiWebQaPlatform = 'yuanbao' | 'nami' | 'wenxin';

interface OperationDefinition {
  source: string | ((payload: Payload) => string);
  kind: RawItemKind;
}

const OPERATIONS: Record<string, OperationDefinition> = {
  storeXhsNote: { source: 'xhs', kind: 'post' },
  storeXhsComment: { source: 'xhs', kind: 'comment' },
  storeDouyinAweme: { source: 'douyin', kind: 'video' },
  storeDouyinComment: { source: 'douyin', kind: 'comment' },
  storeBilibiliVideo: { source: 'bili', kind: 'video' },
  storeBilibiliComment: { source: 'bili', kind: 'comment' },
  storeKuaishouVideo: { source: 'kuaishou', kind: 'video' },
  storeKuaishouComment: { source: 'kuaishou', kind: 'comment' },
  storeWeiboNote: { source: 'weibo', kind: 'post' },
  storeWeiboComment: { source: 'weibo', kind: 'comment' },
  storeTiebaNote: { source: 'tieba', kind: 'post' },
  storeTiebaComment: { source: 'tieba', kind: 'comment' },
  storeZhihuContent: { source: 'zhihu', kind: 'article' },
  storeZhihuComment: { source: 'zhihu', kind: 'comment' },
  storeSearchEngineResult: {
    source: (payload) => payload.search_engine || payload.engine || 'web_search',
    kind: 'search_result',
  },
  storeMediaParsedResult: { source: 'media_parser', kind: 'video' },
  storeDeepSeekResult: { source: 'deepseek', kind: 'ai_answer' },
  storeKimiResult: { source: 'kimi', kind: 'ai_answer' },
  storeDoubaoResult: { source: 'doubao', kind: 'ai_answer' },
  storeQwenResult: { source: 'qwen', kind: 'ai_answer' },
  storeZhaopinResult: { source: 'zhaopin', kind: 'job' },
  storeHeimaoResult: { source: 'heimao', kind: 'complaint' },
};

const SOURCE_ID_KEYS = [
  'note_id',
  'aweme_id',
  'video_id',
  'content_id',
  'comment_id',
  'job_id',
  'id',
];

const SOURCE_URL_KEYS = [
  'content_url',
  'note_url',
  'aweme_url',
  'video_url',
  'job_url',
  'real_url',
  'url',
];

function firstString(payload: Payload, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return undefined;
}

function mediaUrls(payload: Payload): string[] {
  const result = new Set<string>();
  const candidates = [
    payload.media_urls,
    payload.images,
    payload.image_list,
    payload.video_download_url,
    payload.video_play_url,
    payload.video_url,
    payload.audio_url,
    payload.music_download_url,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      for (const value of candidate) if (typeof value === 'string' && value.trim()) result.add(value);
    } else if (typeof candidate === 'string') {
      for (const value of candidate.split(',')) if (/^https?:\/\//.test(value.trim())) result.add(value.trim());
    }
  }
  return [...result];
}

function timestampHint(payload: Payload): string | number | undefined {
  const value = payload.published_at ?? payload.publish_time ?? payload.create_time ?? payload.time;
  return typeof value === 'string' || typeof value === 'number' ? value : undefined;
}

function buildRawItem(operation: string, payload: Payload, sourceOverride?: string): RawItem {
  const definition = OPERATIONS[operation];
  if (!definition) throw new Error(`Unsupported connector output operation: ${operation}`);
  const source = sourceOverride || (typeof definition.source === 'function' ? definition.source(payload) : definition.source);
  const sourceItemId = firstString(payload, SOURCE_ID_KEYS);
  const sourceUrl = firstString(payload, SOURCE_URL_KEYS);
  const media = mediaUrls(payload);
  const kind = operation === 'storeMediaParsedResult' && Array.isArray(payload.images) && payload.images.length && !payload.video_url
    ? 'image'
    : definition.kind;

  return parseRawItem({
    schemaVersion: RAW_ITEM_SCHEMA_VERSION,
    id: sourceItemId ? `${source}:${kind}:${sourceItemId}` : randomUUID(),
    source,
    kind,
    sourceItemId,
    sourceUrl,
    parentId: kind === 'comment'
      ? firstString(payload, ['parent_comment_id', 'parent_id', 'note_id', 'aweme_id', 'video_id'])
      : undefined,
    fetchedAt: new Date().toISOString(),
    hints: {
      title: firstString(payload, ['title', 'job_name', 'question']),
      text: firstString(payload, ['description', 'desc', 'content', 'snippet', 'answer']),
      author: firstString(payload, ['creator_name', 'nickname', 'user_nickname', 'publisher', 'company_name']),
      publishedAt: timestampHint(payload),
      mediaUrls: media.length ? media : undefined,
      coverUrl: firstString(payload, ['cover_url', 'video_cover_url']),
    },
    payload,
    metadata: { operation },
  });
}

class ConnectorOutput {
  private sink: OutputSink | null = null;
  private itemCount = 0;

  async open(sink: OutputSink, context: OutputSinkContext): Promise<void> {
    if (this.sink) throw new Error('Connector output is already open');
    this.sink = sink;
    this.itemCount = 0;
    await sink.open(context);
  }

  async close(result: Omit<OutputSinkResult, 'itemCount'>): Promise<number> {
    const sink = this.requireSink();
    const itemCount = this.itemCount;
    this.sink = null;
    await sink.close({ ...result, itemCount });
    return itemCount;
  }

  async abort(error: Error): Promise<void> {
    if (!this.sink) return;
    const sink = this.sink;
    this.sink = null;
    await sink.abort(error);
  }

  private requireSink(): OutputSink {
    if (!this.sink) throw new Error('Connector output sink has not been configured');
    return this.sink;
  }

  private async emit(operation: string, payload: Payload, sourceOverride?: string): Promise<void> {
    const item = buildRawItem(operation, payload, sourceOverride);
    await this.requireSink().write(item);
    this.itemCount++;
  }

  storeXhsNote = (item: Payload) => this.emit('storeXhsNote', item);
  storeXhsComment = (item: Payload) => this.emit('storeXhsComment', item);
  storeDouyinAweme = (item: Payload) => this.emit('storeDouyinAweme', item);
  storeDouyinComment = (item: Payload) => this.emit('storeDouyinComment', item);
  storeBilibiliVideo = (item: Payload) => this.emit('storeBilibiliVideo', item);
  storeBilibiliComment = (item: Payload) => this.emit('storeBilibiliComment', item);
  storeKuaishouVideo = (item: Payload) => this.emit('storeKuaishouVideo', item);
  storeKuaishouComment = (item: Payload) => this.emit('storeKuaishouComment', item);
  storeWeiboNote = (item: Payload) => this.emit('storeWeiboNote', item);
  storeWeiboComment = (item: Payload) => this.emit('storeWeiboComment', item);
  storeTiebaNote = (item: Payload) => this.emit('storeTiebaNote', item);
  storeTiebaComment = (item: Payload) => this.emit('storeTiebaComment', item);
  storeZhihuContent = (item: Payload) => this.emit('storeZhihuContent', item);
  storeZhihuComment = (item: Payload) => this.emit('storeZhihuComment', item);
  storeSearchEngineResult = (item: Payload) => this.emit('storeSearchEngineResult', item);
  storeMediaParsedResult = (item: Payload) => this.emit('storeMediaParsedResult', item);
  storeDeepSeekResult = (item: Payload) => this.emit('storeDeepSeekResult', item);
  storeKimiResult = (item: Payload) => this.emit('storeKimiResult', item);
  storeDoubaoResult = (item: Payload) => this.emit('storeDoubaoResult', item);
  storeQwenResult = (item: Payload) => this.emit('storeQwenResult', item);
  storeAiWebQaResult = (platform: AiWebQaPlatform, item: Payload) => {
    const operation = 'storeSearchEngineResult';
    return this.emit(operation, item, platform);
  };
  storeZhaopinResult = (item: Payload) => this.emit('storeZhaopinResult', item);
  storeHeimaoResult = (item: Payload) => this.emit('storeHeimaoResult', item);
}

export const connectorOutput = new ConnectorOutput();
export { buildRawItem };
