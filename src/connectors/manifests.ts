import type { ConnectorCapability, ConnectorManifest, ConnectorOutputField } from './types';

const SOCIAL_OUTPUTS: ConnectorOutputField[] = [
  { key: 'content_id', label: '平台内容 ID', type: 'string', required: true },
  { key: 'title', label: '标题', type: 'string' },
  { key: 'description', label: '正文', type: 'string' },
  { key: 'creator_name', label: '作者', type: 'string' },
  { key: 'content_url', label: '作品链接', type: 'string' },
  { key: 'published_at', label: '发布时间', type: 'number' },
  { key: 'likes', label: '点赞数', type: 'number' },
  { key: 'comments', label: '评论数', type: 'number' },
  { key: 'shares', label: '分享数', type: 'number' },
];

const searchCapability = (platformName: string, comments = false): ConnectorCapability => ({
  id: 'keyword_search',
  label: '关键词搜索',
  description: `按关键词发现并采集${platformName}公开内容。`,
  legacyCrawlerType: 'search',
  inputFields: [
    {
      key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的内容数。', type: 'number',
      default: 15, min: 1, max: 500, legacyConfigKey: 'crawler_max_notes_count',
    },
    ...(comments ? [
      {
        key: 'enable_comments', label: '采集一级评论', description: '同时采集作品一级评论。', type: 'boolean' as const,
        default: false, legacyConfigKey: 'enable_comments',
      },
      {
        key: 'enable_sub_comments', label: '采集二级评论', description: '一级评论开启后采集回复。', type: 'boolean' as const,
        default: false, legacyConfigKey: 'enable_sub_comments',
      },
    ] : []),
  ],
  outputType: 'social_content',
  outputFields: SOCIAL_OUTPUTS,
  limitations: [
    '仅采集当前登录态可见的公开内容。',
    '平台页面或接口调整时需要升级该 Connector。',
    ...(comments ? [] : ['当前版本未实现评论详情采集。']),
  ],
});

const xhsDetail: ConnectorCapability = {
  id: 'content_detail', label: '作品详情', description: '解析小红书作品链接或 ID，并采集详情。', legacyCrawlerType: 'detail',
  inputFields: [{ key: 'specified_ids', label: '作品链接或 ID', description: '支持逗号分隔的多个目标。', type: 'string_list', required: true, legacyConfigKey: 'specified_ids' }],
  outputType: 'social_content', outputFields: SOCIAL_OUTPUTS,
  limitations: ['部分分享链接需要先展开重定向。', '仅支持当前登录态可以访问的作品。'],
};

const xhsCreator: ConnectorCapability = {
  id: 'creator_profile', label: '创作者主页', description: '按创作者 ID 采集主页公开作品。', legacyCrawlerType: 'creator',
  inputFields: [{ key: 'creator_ids', label: '创作者 ID', description: '支持逗号分隔的多个创作者 ID。', type: 'string_list', required: true, legacyConfigKey: 'creator_ids' }],
  outputType: 'creator_content', outputFields: SOCIAL_OUTPUTS,
  limitations: ['当前版本仅支持小红书创作者主页采集。'],
};

const social = (
  id: string,
  name: string,
  icon: string,
  options: { comments?: boolean; cookieAuth?: boolean; extraCapabilities?: ConnectorCapability[] } = {},
): ConnectorManifest => ({
  id, version: '1.0.0', name, icon, category: 'social_media',
  description: `${name}公开内容采集连接器。`,
  auth: {
    required: true,
    methods: options.cookieAuth ? ['qrcode', 'cookie'] : ['qrcode'],
    description: '使用平台独立登录态；Cookie 只随本次任务传入子进程。',
  },
  runtime: { engine: 'playwright', isolatedProcess: true, supportsHeadless: true },
  capabilities: [searchCapability(name, options.comments), ...(options.extraCapabilities || [])],
});

export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  social('xhs', '小红书', 'book-open', { comments: true, cookieAuth: true, extraCapabilities: [xhsDetail, xhsCreator] }),
  social('dy', '抖音', 'music', { cookieAuth: true }),
  social('ks', '快手', 'video'),
  social('bili', '哔哩哔哩', 'tv'),
  social('wb', '微博', 'message-circle'),
  social('tieba', '百度贴吧', 'messages-square'),
  social('zhihu', '知乎', 'help-circle'),
];
