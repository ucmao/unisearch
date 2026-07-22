import type { ConnectorCapability, ConnectorManifest, ConnectorOutputField } from './types';

const BASE_OUTPUTS: ConnectorOutputField[] = [
  { key: 'content_id', label: '平台内容 ID', type: 'string', required: true },
  { key: 'content_type', label: '内容类型', type: 'string' },
  { key: 'title', label: '标题', type: 'string' },
  { key: 'description', label: '正文', type: 'string' },
  { key: 'creator_id', label: '作者 ID', type: 'string' },
  { key: 'creator_name', label: '作者', type: 'string' },
  { key: 'content_url', label: '作品链接', type: 'string' },
  { key: 'published_at', label: '发布时间', type: 'number' },
  { key: 'likes', label: '点赞数', type: 'number' },
  { key: 'comments', label: '评论数', type: 'number' },
];

const EXTRA_OUTPUTS: Record<string, ConnectorOutputField[]> = {
  xhs: [
    { key: 'saves', label: '收藏数', type: 'number' }, { key: 'shares', label: '分享数', type: 'number' },
    { key: 'images', label: '图片列表', type: 'string_list' }, { key: 'video_url', label: '视频地址', type: 'string' },
  ],
  dy: [
    { key: 'saves', label: '收藏数', type: 'number' }, { key: 'shares', label: '分享数', type: 'number' },
    { key: 'video_download_url', label: '视频地址', type: 'string' }, { key: 'music_download_url', label: '音乐地址', type: 'string' },
    { key: 'images', label: '图文图片', type: 'string_list' },
  ],
  ks: [
    { key: 'views', label: '播放数', type: 'number' }, { key: 'cover_url', label: '封面地址', type: 'string' },
    { key: 'video_play_url', label: '视频地址', type: 'string' },
  ],
  bili: [
    { key: 'views', label: '播放数', type: 'number' }, { key: 'saves', label: '收藏数', type: 'number' },
    { key: 'shares', label: '分享数', type: 'number' }, { key: 'coins', label: '投币数', type: 'number' },
    { key: 'danmaku', label: '弹幕数', type: 'number' }, { key: 'cover_url', label: '封面地址', type: 'string' },
  ],
  wb: [{ key: 'shares', label: '转发数', type: 'number' }],
  tieba: [
    { key: 'forum_name', label: '贴吧名称', type: 'string' }, { key: 'reply_count', label: '回复数', type: 'number' },
    { key: 'forum_url', label: '贴吧链接', type: 'string' },
  ],
  zhihu: [
    { key: 'question_id', label: '问题 ID', type: 'string' }, { key: 'voteup_count', label: '赞同数', type: 'number' },
    { key: 'updated_at', label: '更新时间', type: 'number' },
  ],
};

const commentOptions = () => [
  {
    key: 'enable_comments', label: '采集一级评论', description: '同步采集当前内容可见的一级评论。',
    type: 'boolean' as const, default: false, runtimeConfigKey: 'enable_comments',
  },
  {
    key: 'enable_sub_comments', label: '采集二级评论', description: '同时采集接口或页面直接返回的回复。',
    type: 'boolean' as const, default: false, runtimeConfigKey: 'enable_sub_comments',
  },
];

const targetField = (label: string) => ({
  key: 'specified_ids', label, description: '支持平台 ID、完整链接或分享短链，多个目标使用逗号或换行分隔。',
  type: 'string_list' as const, required: true, runtimeConfigKey: 'specified_ids',
});

const creatorField = (label: string) => ({
  key: 'creator_ids', label, description: '支持主体 ID 或主页链接，多个目标使用逗号或换行分隔。',
  type: 'string_list' as const, required: true, runtimeConfigKey: 'creator_ids',
});

function capabilities(
  id: string,
  name: string,
  nouns: { content: string; creator: string; comment: string },
): ConnectorCapability[] {
  const outputs = [...BASE_OUTPUTS, ...(EXTRA_OUTPUTS[id] || [])];
  const commonLimits = ['仅处理当前登录态可见的公开内容。', '平台页面或接口调整后可能需要升级 Connector。'];
  return [
    {
      id: 'keyword_search', label: '关键词搜索', description: `按关键词发现并采集${name}${nouns.content}。`, runtimeMode: 'search',
      inputFields: [
        { key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的内容数。', type: 'number', default: 15, min: 1, max: 500, runtimeConfigKey: 'crawler_max_notes_count' },
        ...commentOptions(),
      ],
      outputType: `${id}_content`, outputFields: outputs, limitations: commonLimits,
    },
    {
      id: 'content_detail', label: `${nouns.content}详情`, description: `根据 ID、链接或分享地址采集${name}${nouns.content}详情。`, runtimeMode: 'detail',
      inputFields: [targetField(`${nouns.content}链接或 ID`), ...commentOptions()],
      outputType: `${id}_content`, outputFields: outputs, limitations: commonLimits,
    },
    {
      id: 'creator_profile', label: `${nouns.creator}主页`, description: `采集${name}${nouns.creator}主页可见内容。`, runtimeMode: 'creator',
      inputFields: [creatorField(`${nouns.creator} ID 或主页`), ...commentOptions()],
      outputType: `${id}_creator_content`, outputFields: outputs, limitations: commonLimits,
    },
    {
      id: 'comments', label: nouns.comment, description: `采集指定${name}${nouns.content}的评论及可见回复。`, runtimeMode: 'detail',
      inputFields: [targetField(`${nouns.content}链接或 ID`),
        { key: 'enable_comments', label: '采集一级评论', description: '评论能力固定开启。', type: 'boolean', default: true, runtimeConfigKey: 'enable_comments' },
        { key: 'enable_sub_comments', label: '采集二级评论', description: '采集可见回复。', type: 'boolean', default: true, runtimeConfigKey: 'enable_sub_comments' }],
      outputType: `${id}_comment`, outputFields: [
        { key: 'comment_id', label: '评论 ID', type: 'string', required: true },
        { key: 'content_id', label: '内容 ID', type: 'string' },
        { key: 'content', label: '评论内容', type: 'string' },
        { key: 'creator_name', label: '评论用户', type: 'string' },
        { key: 'parent_comment_id', label: '父评论 ID', type: 'string' },
        { key: 'likes', label: '评论点赞数', type: 'number' },
      ], limitations: commonLimits,
    },
    {
      id: 'url_resolve', label: 'URL解析', description: `展开${name}分享短链、识别真实${nouns.content} ID 并补采详情。`, runtimeMode: 'detail',
      inputFields: [targetField('分享链接或内容链接')], outputType: `${id}_resolved_content`, outputFields: outputs,
      limitations: ['短链必须能在当前网络环境中正常打开。', ...commonLimits],
    },
  ];
}

const social = (
  id: string,
  name: string,
  icon: string,
  nouns: { content: string; creator: string; comment: string },
): ConnectorManifest => ({
  id, version: '2.0.0', name, icon, category: 'social_media',
  description: `${name}公开内容发现、详情、主体、评论和 URL 解析连接器。`,
  auth: {
    required: true, methods: ['qrcode', 'cookie'],
    description: '使用平台独立登录态；Cookie 只随本次任务传入隔离子进程。',
  },
  runtime: { engine: 'playwright', isolatedProcess: true, supportsHeadless: true },
  capabilities: capabilities(id, name, nouns),
});

const searchEngine = (
  id: string,
  name: string,
  icon: string,
): ConnectorManifest => ({
  id, version: '1.0.0', name, icon, category: 'web_search',
  description: `${name}公开网页全网搜索与摘要数据采集连接器。`,
  auth: {
    required: false, methods: ['none'],
    description: '无需登录，直接通过 HTTP 接口免认证全网搜索。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '关键词全网搜索', description: `在${name}上按关键词进行网页搜索并提取结果摘要。`, runtimeMode: 'search',
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多采集的搜索结果条目数。',
          type: 'number', default: 15, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_search_result`, outputFields: [
        { key: 'content_id', label: '结果 URL/ID', type: 'string', required: true },
        { key: 'title', label: '网页标题', type: 'string' },
        { key: 'description', label: '网页摘要', type: 'string' },
        { key: 'content_url', label: '真实网页链接', type: 'string' },
        { key: 'creator_name', label: '来源/发布者', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'number' },
      ], limitations: ['依靠公开 SERP 搜索结果 HTML。', '不受用户登录态限制。'],
    },
  ],
});

export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  social('xhs', '小红书', 'book-open', { content: '作品', creator: '创作者', comment: '评论与子评论' }),
  social('dy', '抖音', 'music', { content: '作品', creator: '创作者', comment: '评论与回复' }),
  social('ks', '快手', 'video', { content: '作品', creator: '创作者', comment: '可见评论' }),
  social('bili', '哔哩哔哩', 'tv', { content: '视频', creator: 'UP主', comment: '视频评论' }),
  social('wb', '微博', 'message-circle', { content: '博文', creator: '用户', comment: '评论与回复' }),
  social('tieba', '百度贴吧', 'messages-square', { content: '帖子', creator: '吧/用户主体', comment: '楼层回复' }),
  social('zhihu', '知乎', 'help-circle', { content: '问题/回答/文章', creator: '作者', comment: '评论与回复' }),
  searchEngine('baidu', '百度', 'search'),
  searchEngine('bing', '必应中国', 'globe'),
  searchEngine('so360', '360搜索', 'compass'),
  searchEngine('sogou', '搜狗搜索', 'search'),
];
