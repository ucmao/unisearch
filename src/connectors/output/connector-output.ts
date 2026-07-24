import { randomUUID } from 'crypto';
import { RAW_ITEM_SCHEMA_VERSION, parseRawItem, type RawItem, type RawItemKind } from '../../core/contracts/raw-item';
import type { OutputSink, OutputSinkContext, OutputSinkResult } from '../../core/sinks/types';

type Payload = Record<string, any>;
type AiWebQaPlatform = 'yuanbao' | 'nami' | 'wenxin';

interface OutputDefinition {
  source: string | ((payload: Payload) => string);
  kind: RawItemKind;
}

const OUTPUTS: Record<string, OutputDefinition> = {
  emitXhsNote: { source: 'xhs', kind: 'post' },
  emitXhsComment: { source: 'xhs', kind: 'comment' },
  emitDouyinAweme: { source: 'douyin', kind: 'video' },
  emitDouyinComment: { source: 'douyin', kind: 'comment' },
  emitBilibiliVideo: { source: 'bili', kind: 'video' },
  emitBilibiliComment: { source: 'bili', kind: 'comment' },
  emitKuaishouVideo: { source: 'kuaishou', kind: 'video' },
  emitKuaishouComment: { source: 'kuaishou', kind: 'comment' },
  emitWeiboNote: { source: 'weibo', kind: 'post' },
  emitWeiboComment: { source: 'weibo', kind: 'comment' },
  emitTiebaNote: { source: 'tieba', kind: 'post' },
  emitTiebaComment: { source: 'tieba', kind: 'comment' },
  emitZhihuContent: { source: 'zhihu', kind: 'article' },
  emitZhihuComment: { source: 'zhihu', kind: 'comment' },
  emitSearchEngineResult: {
    source: (payload) => payload.search_engine || payload.engine || 'web_search',
    kind: 'search_result',
  },
  emitMediaParsedResult: { source: 'media_parser', kind: 'video' },
  emitDeepSeekResult: { source: 'deepseek', kind: 'ai_answer' },
  emitKimiResult: { source: 'kimi', kind: 'ai_answer' },
  emitDoubaoResult: { source: 'doubao', kind: 'ai_answer' },
  emitQwenResult: { source: 'qwen', kind: 'ai_answer' },
  emitZhaopinResult: { source: 'zhaopin', kind: 'job' },
  emitHeimaoResult: { source: 'heimao', kind: 'complaint' },
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
    payload.cover_url,
    payload.video_cover_url,
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

function buildRawItem(outputType: string, payload: Payload, sourceOverride?: string): RawItem {
  const definition = OUTPUTS[outputType];
  if (!definition) throw new Error(`Unsupported connector output type: ${outputType}`);
  const source = sourceOverride || (typeof definition.source === 'function' ? definition.source(payload) : definition.source);
  const sourceItemId = firstString(payload, SOURCE_ID_KEYS);
  const sourceUrl = firstString(payload, SOURCE_URL_KEYS);
  const media = mediaUrls(payload);
  const kind = outputType === 'emitMediaParsedResult' && Array.isArray(payload.images) && payload.images.length && !payload.video_url
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
    metadata: {},
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

  private async emit(outputType: string, payload: Payload, sourceOverride?: string): Promise<void> {
    const item = buildRawItem(outputType, payload, sourceOverride);
    await this.requireSink().write(item);
    this.itemCount++;
  }

  emitXhsNote = (item: Payload) => this.emit('emitXhsNote', item);
  emitXhsComment = (item: Payload) => this.emit('emitXhsComment', item);
  emitDouyinAweme = (item: Payload) => this.emit('emitDouyinAweme', item);
  emitDouyinComment = (item: Payload) => this.emit('emitDouyinComment', item);
  emitBilibiliVideo = (item: Payload) => this.emit('emitBilibiliVideo', item);
  emitBilibiliComment = (item: Payload) => this.emit('emitBilibiliComment', item);
  emitKuaishouVideo = (item: Payload) => this.emit('emitKuaishouVideo', item);
  emitKuaishouComment = (item: Payload) => this.emit('emitKuaishouComment', item);
  emitWeiboNote = (item: Payload) => this.emit('emitWeiboNote', item);
  emitWeiboComment = (item: Payload) => this.emit('emitWeiboComment', item);
  emitTiebaNote = (item: Payload) => this.emit('emitTiebaNote', item);
  emitTiebaComment = (item: Payload) => this.emit('emitTiebaComment', item);
  emitZhihuContent = (item: Payload) => this.emit('emitZhihuContent', item);
  emitZhihuComment = (item: Payload) => this.emit('emitZhihuComment', item);
  emitSearchEngineResult = (item: Payload) => this.emit('emitSearchEngineResult', item);
  emitMediaParsedResult = (item: Payload) => this.emit('emitMediaParsedResult', item);
  emitDeepSeekResult = (item: Payload) => this.emit('emitDeepSeekResult', item);
  emitKimiResult = (item: Payload) => this.emit('emitKimiResult', item);
  emitDoubaoResult = (item: Payload) => this.emit('emitDoubaoResult', item);
  emitQwenResult = (item: Payload) => this.emit('emitQwenResult', item);
  emitAiWebQaResult = (platform: AiWebQaPlatform, item: Payload) => {
    return this.emit('emitSearchEngineResult', item, platform);
  };
  emitZhaopinResult = (item: Payload) => this.emit('emitZhaopinResult', item);
  emitHeimaoResult = (item: Payload) => this.emit('emitHeimaoResult', item);
}

export const connectorOutput = new ConnectorOutput();
export { buildRawItem };
