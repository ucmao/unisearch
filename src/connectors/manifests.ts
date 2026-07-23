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
  douyin: [
    { key: 'saves', label: '收藏数', type: 'number' }, { key: 'shares', label: '分享数', type: 'number' },
    { key: 'video_download_url', label: '视频地址', type: 'string' }, { key: 'music_download_url', label: '音乐地址', type: 'string' },
    { key: 'images', label: '图文图片', type: 'string_list' },
  ],
  kuaishou: [
    { key: 'views', label: '播放数', type: 'number' }, { key: 'cover_url', label: '封面地址', type: 'string' },
    { key: 'video_play_url', label: '视频地址', type: 'string' },
  ],
  bili: [
    { key: 'views', label: '播放数', type: 'number' }, { key: 'saves', label: '收藏数', type: 'number' },
    { key: 'shares', label: '分享数', type: 'number' }, { key: 'coins', label: '投币数', type: 'number' },
    { key: 'danmaku', label: '弹幕数', type: 'number' }, { key: 'cover_url', label: '封面地址', type: 'string' },
  ],
  weibo: [{ key: 'shares', label: '转发数', type: 'number' }],
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

const utilityParser = (
  id: string,
  name: string,
  icon: string,
): ConnectorManifest => ({
  id, version: '2.0.0', name, icon, category: 'utility',
  description: '全网综合无水印解析工具。支持小红书、抖音、快手、可灵、哔哩哔哩、好看视频、梨视频、皮皮搞笑、微视、腾讯频道、视频号、微博、知乎、西瓜视频、A站、最右、皮皮虾、逗拍、全民K歌、汽水音乐、网易云音乐、QQ音乐、绿洲、6间房、新片场、美拍、虎牙、豆包、Soul、千问、即梦、剪映、今日头条、闲鱼等数十个平台的视频、图集、实况无水印原画解析。',
  auth: {
    required: false, methods: ['none'],
    description: '免登录 API 接口，无需任何平台账号或登录态。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'url_resolve', label: '全网无水印解析', description: '输入任意支持平台的作品链接、分享短链或分享文案，自动解析无水印高清原视频、原图、音频与元数据。', runtimeMode: 'detail',
      inputFields: [
        {
          key: 'specified_ids', label: '目标链接或短链', description: '支持作品链接、短链或分享文本，多个目标使用逗号或换行分隔。',
          type: 'string_list', required: true, runtimeConfigKey: 'specified_ids',
        },
      ],
      outputType: `${id}_resolved_media`, outputFields: [
        { key: 'content_id', label: '作品 ID', type: 'string', required: true },
        { key: 'platform', label: '所属平台', type: 'string' },
        { key: 'title', label: '标题/文案', type: 'string' },
        { key: 'creator_name', label: '作者名称', type: 'string' },
        { key: 'cover_url', label: '封面地址', type: 'string' },
        { key: 'video_url', label: '无水印视频地址', type: 'string' },
        { key: 'images', label: '无水印原图列表', type: 'string_list' },
        { key: 'audio_url', label: '音频/音乐地址', type: 'string' },
      ], limitations: ['仅限有效公开作品或短链。'],
    },
  ],
});

const aiWebQA = (
  id: string,
  name: string,
  icon: string,
): ConnectorManifest => ({
  id, version: '1.0.0', name, icon, category: 'ai_web_qa',
  description: `${name} 网页端 AI 智能问答、深度思考与联网新闻/资料引用自动化采集连接器。`,
  auth: {
    required: false, methods: ['none', 'cookie'],
    description: '支持加载平台 Cookie 或自动打开内置浏览器免登录/自动登录使用。',
  },
  runtime: { engine: 'playwright', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: 'AI 搜索问答对比', description: `在 ${name} 网页端模拟提问并抓取思考过程、回答正文及新闻参考资料。`, runtimeMode: 'search',
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '向 AI 提交的问题词条数。',
          type: 'number', default: 15, min: 1, max: 500, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_qa_result`, outputFields: [
        { key: 'content_id', label: '问答 ID', type: 'string', required: true },
        { key: 'title', label: '提问词/关键词', type: 'string' },
        { key: 'description', label: '回答正文', type: 'string' },
        { key: 'reasoning_content', label: '深度思考过程', type: 'string' },
        { key: 'citations', label: '参考新闻/资料列表', type: 'string_list' },
        { key: 'content_url', label: '对话链接', type: 'string' },
        { key: 'creator_name', label: 'AI 平台', type: 'string' },
        { key: 'published_at', label: '响应时间', type: 'number' },
      ], limitations: ['依赖 Playwright 模拟 DOM 打字机输出渲染。', '思考过程与参考资料取决于平台当前是否提供相应模式。'],
    },
  ],
});

const jobPlatform = (
  id: string,
  name: string,
  icon: string,
): ConnectorManifest => ({
  id, version: '1.0.0', name, icon, category: 'job_platform',
  description: `${name}招聘岗位列表搜索与职位详情解析连接器。`,
  auth: {
    required: false, methods: ['none', 'cookie'],
    description: '支持公开职位搜索，遇风控滑块时自动接入人工验证/打码机制。',
  },
  runtime: { engine: 'playwright', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '岗位关键词搜索', description: `在${name}按关键词搜索招聘岗位信息。`, runtimeMode: 'search',
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的岗位数。',
          type: 'number', default: 20, min: 1, max: 200, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_job_list`, outputFields: [
        { key: 'content_id', label: '职位 ID', type: 'string', required: true },
        { key: 'title', label: '职位名称', type: 'string' },
        { key: 'description', label: '薪资与职位概述', type: 'string' },
        { key: 'creator_name', label: '招聘公司', type: 'string' },
        { key: 'content_url', label: '职位详情链接', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'number' },
      ], limitations: ['依靠公开 SERP 与网页全量 HTML/JSON 全局变量。'],
    },
    {
      id: 'content_detail', label: '职位详情解析', description: `根据 ID 或完整链接解析${name}职位详细 JD 描述及精准发布时间。`, runtimeMode: 'detail',
      inputFields: [targetField('职位详情链接或 ID')], outputType: `${id}_job_detail`, outputFields: [
        { key: 'content_id', label: '职位 ID', type: 'string', required: true },
        { key: 'title', label: '职位名称', type: 'string' },
        { key: 'description', label: '完整 JD 描述', type: 'string' },
        { key: 'creator_name', label: '公司名称', type: 'string' },
        { key: 'content_url', label: '职位链接', type: 'string' },
        { key: 'published_at', label: '精确发布时间', type: 'number' },
      ], limitations: ['解析 __INITIAL_STATE__ 里面的 JSON 元数据。'],
    },
  ],
});

const complaintPlatform = (
  id: string,
  name: string,
  icon: string,
): ConnectorManifest => ({
  id, version: '1.0.0', name, icon, category: 'complaint_platform',
  description: `${name}维权投诉单搜索与投诉详情自动化解析连接器。`,
  auth: {
    required: false, methods: ['none', 'cookie'],
    description: '支持公开投诉搜寻，免登录抓取消费者投诉事件与涉诉商家。',
  },
  runtime: { engine: 'playwright', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '投诉关键词搜索', description: `在${name}按关键词搜索消费投诉事件与问题列表。`, runtimeMode: 'search',
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的投诉单数。',
          type: 'number', default: 20, min: 1, max: 200, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_complaint_list`, outputFields: [
        { key: 'content_id', label: '投诉单 ID', type: 'string', required: true },
        { key: 'title', label: '投诉标题', type: 'string' },
        { key: 'description', label: '投诉问题与诉求', type: 'string' },
        { key: 'creator_name', label: '投诉对象/商家', type: 'string' },
        { key: 'content_url', label: '投诉单详情链接', type: 'string' },
        { key: 'published_at', label: '投诉时间', type: 'number' },
      ], limitations: ['依赖公开搜索页面与 DOM/JSON 数据解析。'],
    },
    {
      id: 'content_detail', label: '投诉单详情解析', description: `根据 ID 或链接解析${name}完整投诉内容、涉诉金额与处理节点。`, runtimeMode: 'detail',
      inputFields: [targetField('投诉详情链接或 ID')], outputType: `${id}_complaint_detail`, outputFields: [
        { key: 'content_id', label: '投诉单 ID', type: 'string', required: true },
        { key: 'title', label: '投诉标题', type: 'string' },
        { key: 'description', label: '完整投诉问题与要求', type: 'string' },
        { key: 'creator_name', label: '被投诉商家', type: 'string' },
        { key: 'content_url', label: '投诉单链接', type: 'string' },
        { key: 'published_at', label: '精确投诉时间', type: 'number' },
      ], limitations: ['依赖单条投诉网页 DOM/JSON 元数据。'],
    },
  ],
});

export const CONNECTOR_MANIFESTS: ConnectorManifest[] = [
  social('xhs', '小红书', 'book-open', { content: '作品', creator: '创作者', comment: '评论与子评论' }),
  social('douyin', '抖音', 'music', { content: '作品', creator: '创作者', comment: '评论与回复' }),
  social('kuaishou', '快手', 'video', { content: '作品', creator: '创作者', comment: '可见评论' }),
  social('bili', '哔哩哔哩', 'tv', { content: '视频', creator: 'UP主', comment: '视频评论' }),
  social('weibo', '微博', 'message-circle', { content: '博文', creator: '用户', comment: '评论与回复' }),
  social('tieba', '百度贴吧', 'messages-square', { content: '帖子', creator: '吧/用户主体', comment: '楼层回复' }),
  social('zhihu', '知乎', 'help-circle', { content: '问题/回答/文章', creator: '作者', comment: '评论与回复' }),
  searchEngine('baidu', '百度', 'search'),
  searchEngine('bing', '必应中国', 'globe'),
  searchEngine('so360', '360搜索', 'compass'),
  searchEngine('sogou', '搜狗搜索', 'search'),
  utilityParser('media_parser', '综合无水印解析', 'link'),
  jobPlatform('zhaopin', '智联招聘', 'briefcase'),
  complaintPlatform('heimao', '黑猫投诉', 'shield-alert'),
  aiWebQA('deepseek', 'DeepSeek', 'brain'),
  aiWebQA('kimi', 'Kimi', 'sparkles'),
  aiWebQA('doubao', '豆包', 'bot'),
  aiWebQA('qwen', '通义千问', 'message-square-text'),
  aiWebQA('yuanbao', '腾讯元宝', 'gem'),
  aiWebQA('nami', '纳米AI', 'atom'),
  aiWebQA('wenxin', '文心一言', 'message-circle-heart'),
];
