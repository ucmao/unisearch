import type { ConnectorCapability, ConnectorManifest, ConnectorOutputField } from './types';

const BASE_OUTPUTS: ConnectorOutputField[] = [
  { key: 'content_id', label: '平台内容 ID', type: 'string', required: true },
  { key: 'content_type', label: '内容类型', type: 'string' },
  { key: 'title', label: '标题', type: 'string' },
  { key: 'summary', label: '摘要', type: 'string' },
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
    { key: 'forum_name', label: '贴吧名称', type: 'string' },
    { key: 'forum_url', label: '贴吧链接', type: 'string' },
  ],
  zhihu: [
    { key: 'question_id', label: '问题 ID', type: 'string' },
    { key: 'updated_at', label: '更新时间', type: 'number' },
  ],
};

// One switch, not two. On every platform except Xiaohongshu the replies arrive
// inside the same response as the top-level comments, so a separate "collect
// replies" toggle only ever decided whether to throw away data already fetched.
const commentOptions = () => [
  {
    key: 'enable_comments', label: '采集评论', description: '采集当前内容的评论，含可见的楼中楼回复。',
    type: 'boolean' as const, default: false, runtimeConfigKey: 'enable_comments',
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

/**
 * Platform-specific caveats appended to every capability's limitations. Comment
 * collection is one switch now, so anywhere it delivers less than "评论含回复"
 * has to say so here rather than silently returning half the thread.
 */
const PLATFORM_LIMITS: Record<string, string[]> = {
  tieba: ['帖子楼层依赖页面滚动加载，超长帖按评论上限截断；楼中楼回复最多取前 10 页。'],
};

function capabilities(
  id: string,
  name: string,
  nouns: { content: string; creator: string; comment: string },
): ConnectorCapability[] {
  const outputs = [...BASE_OUTPUTS, ...(EXTRA_OUTPUTS[id] || [])];
  const commonLimits = ['仅处理当前登录态可见的公开内容。', '平台页面或接口调整后可能需要升级 Connector。',
    ...(PLATFORM_LIMITS[id] || [])];
  return [
    {
      id: 'keyword_search', label: '关键词搜索', description: `按关键词发现并采集${name}${nouns.content}。`, runtimeMode: 'search',
      budgetModel: 'scroll_count',
      // Infinite-scroll feeds stay relevant deep into the list, so 深度 is worth
      // a large share of the 500 ceiling rather than the old flat 100.
      depthBudget: { quick: 20, standard: 50, deep: 200 },
      inputFields: [
        { key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的内容数。', type: 'number', default: 15, min: 1, max: 500, runtimeConfigKey: 'crawler_max_notes_count' },
        ...commentOptions(),
      ],
      outputType: `${id}_content`, outputFields: outputs, limitations: commonLimits,
    },
    {
      id: 'content_detail', label: `${nouns.content}详情`, description: `根据 ID、链接或分享地址采集${name}${nouns.content}详情。`, runtimeMode: 'detail',
      budgetModel: 'single_target',
      inputFields: [targetField(`${nouns.content}链接或 ID`), ...commentOptions()],
      outputType: `${id}_content`, outputFields: outputs, limitations: commonLimits,
    },
    {
      id: 'creator_profile', label: `${nouns.creator}主页`, description: `采集${name}${nouns.creator}主页可见内容。`, runtimeMode: 'creator',
      budgetModel: 'single_target',
      inputFields: [creatorField(`${nouns.creator} ID 或主页`), ...commentOptions()],
      outputType: `${id}_creator_content`, outputFields: outputs, limitations: commonLimits,
    },
    {
      id: 'comments', label: nouns.comment, description: `采集指定${name}${nouns.content}的评论及可见回复。`, runtimeMode: 'detail',
      budgetModel: 'single_target',
      inputFields: [targetField(`${nouns.content}链接或 ID`),
        { key: 'enable_comments', label: '采集评论', description: '评论能力固定开启，含可见的楼中楼回复。', type: 'boolean', default: true, runtimeConfigKey: 'enable_comments' }],
      outputType: `${id}_comment`, outputFields: [
        { key: 'comment_id', label: '评论 ID', type: 'string', required: true },
        { key: 'content_id', label: '内容 ID', type: 'string' },
        { key: 'summary', label: '评论摘要', type: 'string' },
        { key: 'content', label: '评论内容', type: 'string' },
        { key: 'creator_id', label: '评论用户 ID', type: 'string' },
        { key: 'creator_name', label: '评论用户', type: 'string' },
        { key: 'parent_comment_id', label: '父评论 ID', type: 'string' },
        { key: 'likes', label: '评论点赞数', type: 'number' },
        { key: 'published_at', label: '评论时间', type: 'number' },
        { key: 'sub_comment_count', label: '回复数量', type: 'number' },
      ], limitations: commonLimits,
    },
    {
      id: 'url_resolve', label: 'URL解析', description: `展开${name}分享短链、识别真实${nouns.content} ID 并补采详情。`, runtimeMode: 'detail',
      budgetModel: 'single_target',
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
  runtime: { engine: 'hybrid', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '关键词全网搜索', description: `在${name}上按关键词进行网页搜索并提取结果摘要。`, runtimeMode: 'search',
      budgetModel: 'true_pagination',
      // SERP tails degrade into ads and near-duplicates, and most engines stop
      // serving useful results well before 100, so depth stays deliberately low.
      depthBudget: { quick: 10, standard: 30, deep: 80 },
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多采集的搜索结果条目数。',
          type: 'number', default: 15, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
        {
          key: 'start_page', label: '起始页', description: '从第几页开始采集，可用于跳过前若干页或断点续采。仅真实分页采集的连接器支持。',
          type: 'number', default: 1, min: 1, max: 20, runtimeConfigKey: 'start_page',
        },
      ],
      outputType: `${id}_search_result`, outputFields: [
        { key: 'content_id', label: '结果 URL/ID', type: 'string', required: true },
        { key: 'title', label: '网页标题', type: 'string' },
        { key: 'summary', label: '网页摘要', type: 'string' },
        { key: 'description', label: '网页摘要', type: 'string' },
        { key: 'content_url', label: '真实网页链接', type: 'string' },
        { key: 'creator_name', label: '来源/发布者', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'number' },
        { key: 'rank', label: '结果排名', type: 'number' },
        { key: 'images', label: '结果图片', type: 'string_list' },
      ], limitations: ['依靠公开 SERP 搜索结果 HTML。', '不受用户登录态限制。'],
    },
  ],
});

const ARXIV_OUTPUTS: ConnectorOutputField[] = [
  { key: 'content_id', label: 'arXiv 基础 ID', type: 'string', required: true },
  { key: 'arxiv_id', label: 'arXiv 版本 ID', type: 'string', required: true },
  { key: 'version', label: '论文版本号', type: 'number' },
  { key: 'title', label: '论文标题', type: 'string', required: true },
  { key: 'summary', label: '论文摘要', type: 'string' },
  { key: 'authors', label: '作者列表', type: 'string_list' },
  { key: 'categories', label: '分类列表', type: 'string_list' },
  { key: 'primary_category', label: '主分类', type: 'string' },
  { key: 'content_url', label: '摘要页', type: 'string' },
  { key: 'pdf_url', label: 'PDF 链接', type: 'string' },
  { key: 'published_at', label: '首次提交时间', type: 'string' },
  { key: 'updated_at', label: '最后更新时间', type: 'string' },
  { key: 'doi', label: 'DOI', type: 'string' },
  { key: 'journal_ref', label: '期刊引用', type: 'string' },
  { key: 'comment', label: '作者备注', type: 'string' },
  { key: 'rank', label: '结果排名', type: 'number' },
];

const arxiv: ConnectorManifest = {
  id: 'arxiv', version: '1.0.0', name: 'arXiv', icon: 'file-search', category: 'web_search',
  description: 'arXiv 官方元数据 API 论文搜索与指定论文详情连接器（国际学术预印本论文库，建议使用英文检索）。',
  auth: {
    required: false, methods: ['none'],
    description: '使用 arXiv 官方公开 Atom API，无需账号或 API Key。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '论文搜索', description: '按关键词、标题、作者、摘要或分类检索 arXiv 论文元数据（建议使用英文检索）。',
      runtimeMode: 'search', budgetModel: 'true_pagination',
      depthBudget: { quick: 10, standard: 30, deep: 100 },
      inputFields: [
        {
          key: 'search_scope', label: '检索字段', description: '选择关键词匹配的论文元数据字段。',
          type: 'select', default: 'all', runtimeConfigKey: 'arxiv_search_scope',
          options: [
            { value: 'all', label: '全部字段' },
            { value: 'title', label: '标题' },
            { value: 'author', label: '作者' },
            { value: 'abstract', label: '摘要' },
            { value: 'category', label: 'arXiv 分类' },
          ],
        },
        {
          key: 'sort_by', label: '排序字段', description: '默认按首次提交时间排序。',
          type: 'select', default: 'submittedDate', runtimeConfigKey: 'arxiv_sort_by',
          options: [
            { value: 'submittedDate', label: '首次提交时间' },
            { value: 'lastUpdatedDate', label: '最后更新时间' },
            { value: 'relevance', label: '相关性' },
          ],
        },
        {
          key: 'sort_order', label: '排序方向', description: '时间排序默认最新在前。',
          type: 'select', default: 'descending', runtimeConfigKey: 'arxiv_sort_order',
          options: [
            { value: 'descending', label: '降序' },
            { value: 'ascending', label: '升序' },
          ],
        },
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多采集的论文数。',
          type: 'number', default: 15, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
        {
          key: 'start_page', label: '起始页', description: '每页固定 25 条，从指定页开始采集。',
          type: 'number', default: 1, min: 1, max: 400, runtimeConfigKey: 'start_page',
        },
      ],
      outputType: 'arxiv_paper', outputFields: ARXIV_OUTPUTS,
      limitations: [
        'arXiv 为国际学术预印本论文库，建议使用英文关键词检索以获得更佳匹配结果。',
        '仅采集 arXiv 描述性元数据，不下载或存储论文 PDF 正文。',
        '遵守 arXiv API 限流：单连接运行，相邻请求至少间隔 3 秒。',
      ],
    },
    {
      id: 'content_detail', label: '论文详情', description: '根据 arXiv ID、摘要页或 PDF 链接获取论文元数据。',
      runtimeMode: 'detail', budgetModel: 'single_target',
      inputFields: [targetField('arXiv ID 或论文链接')],
      outputType: 'arxiv_paper', outputFields: ARXIV_OUTPUTS,
      limitations: [
        '仅接受标准 arXiv ID、/abs/ 链接或 /pdf/ 链接。',
        '仅采集 arXiv 描述性元数据，不下载或存储论文 PDF 正文。',
      ],
    },
  ],
};

const GITHUB_REPOSITORY_OUTPUTS: ConnectorOutputField[] = [
  { key: 'content_id', label: 'GitHub 仓库 ID', type: 'string', required: true },
  { key: 'full_name', label: '仓库全名', type: 'string', required: true },
  { key: 'title', label: '仓库名称', type: 'string', required: true },
  { key: 'summary', label: '仓库描述', type: 'string' },
  { key: 'creator_name', label: '所有者', type: 'string' },
  { key: 'content_url', label: '仓库链接', type: 'string' },
  { key: 'homepage', label: '项目主页', type: 'string' },
  { key: 'language', label: '主要语言', type: 'string' },
  { key: 'topics', label: 'Topics', type: 'string_list' },
  { key: 'license', label: 'SPDX 许可证', type: 'string' },
  { key: 'stars', label: 'Stars', type: 'number' },
  { key: 'forks', label: 'Forks', type: 'number' },
  { key: 'watchers', label: 'Watchers', type: 'number' },
  { key: 'open_issues', label: '开放 Issues', type: 'number' },
  { key: 'created_at', label: '创建时间', type: 'string' },
  { key: 'updated_at', label: '更新时间', type: 'string' },
  { key: 'pushed_at', label: '最后推送时间', type: 'string' },
  { key: 'archived', label: '已归档', type: 'boolean' },
  { key: 'is_fork', label: 'Fork 仓库', type: 'boolean' },
  { key: 'rank', label: '结果排名', type: 'number' },
];

const githubRepositories: ConnectorManifest = {
  id: 'github_repositories', version: '1.0.0', name: 'GitHub 仓库', icon: 'github', category: 'web_search',
  description: '合并 GitHub 通用热门项目与 AI/ML 趋势榜，支持仓库检索和指定仓库详情。',
  auth: {
    required: false, methods: ['none'],
    description: '使用 GitHub 官方公开 REST API 匿名只读查询，无需账号或 API Key。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '仓库搜索与趋势',
      description: '检索近期活跃的通用或 AI/ML GitHub 仓库；关键词为空时返回对应趋势榜。',
      runtimeMode: 'search', budgetModel: 'true_pagination',
      depthBudget: { quick: 20, standard: 50, deep: 100 },
      inputFields: [
        {
          key: 'mode', label: '仓库范围', description: '通用模式覆盖全部仓库；AI/ML 模式合并原 AI 趋势技能的主题范围。',
          type: 'select', default: 'general', runtimeConfigKey: 'github_repositories_mode',
          options: [
            { value: 'general', label: '通用仓库' },
            { value: 'ai', label: 'AI / ML 仓库' },
          ],
        },
        {
          key: 'period', label: '活跃周期', description: '仅返回该周期内有代码推送的仓库。',
          type: 'select', default: 'weekly', runtimeConfigKey: 'github_repositories_period',
          options: [
            { value: 'daily', label: '最近一天' },
            { value: 'weekly', label: '最近一周' },
            { value: 'monthly', label: '最近一月' },
          ],
        },
        {
          key: 'language', label: '编程语言', description: '可选 GitHub 编程语言过滤，例如 python、typescript、go。',
          type: 'string', default: '', runtimeConfigKey: 'github_repositories_language',
        },
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多采集的仓库数。',
          type: 'number', default: 20, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
        {
          key: 'start_page', label: '起始页', description: 'GitHub Search API 每页最多 30 条。',
          type: 'number', default: 1, min: 1, max: 34, runtimeConfigKey: 'start_page',
        },
      ],
      outputType: 'github_repository', outputFields: GITHUB_REPOSITORY_OUTPUTS,
      limitations: [
        '匿名 GitHub Search API 通常限制为每分钟 10 次请求；达到限额后需等待重置。',
        '趋势榜按近期有推送且累计 Star 较高近似计算，不等同于 github.com/trending 的内部算法。',
        '最多查询 GitHub Search API 可访问的前 1000 条结果，本连接器单次每关键词最多入库 100 条。',
      ],
    },
    {
      id: 'content_detail', label: '仓库详情', description: '根据 owner/repository 或 GitHub 仓库链接读取公开仓库元数据。',
      runtimeMode: 'detail', budgetModel: 'single_target',
      inputFields: [targetField('GitHub 仓库名称或链接')],
      outputType: 'github_repository', outputFields: GITHUB_REPOSITORY_OUTPUTS,
      limitations: [
        '仅支持 github.com 公开仓库；不访问私有仓库或用户登录态。',
        '仅采集仓库描述性元数据，不克隆代码、不下载 Release 或仓库文件。',
      ],
    },
  ],
};

const RSS_NEWS_OUTPUTS: ConnectorOutputField[] = [
  { key: 'content_id', label: 'Feed 条目 ID', type: 'string', required: true },
  { key: 'guid', label: 'RSS/Atom GUID', type: 'string' },
  { key: 'title', label: '标题', type: 'string', required: true },
  { key: 'summary', label: 'Feed 摘要', type: 'string' },
  { key: 'creator_name', label: '新闻源', type: 'string' },
  { key: 'author', label: '作者', type: 'string' },
  { key: 'content_url', label: '原文链接', type: 'string' },
  { key: 'feed_url', label: 'Feed URL', type: 'string', required: true },
  { key: 'feed_title', label: 'Feed 标题', type: 'string' },
  { key: 'categories', label: '分类', type: 'string_list' },
  { key: 'published_at', label: '发布时间', type: 'string' },
  { key: 'updated_at', label: '更新时间', type: 'string' },
  { key: 'language', label: '语言', type: 'string' },
  { key: 'rank', label: '结果排名', type: 'number' },
];

const rssNews: ConnectorManifest = {
  id: 'rss_news', version: '1.0.0', name: 'RSS 新闻', icon: 'rss', category: 'web_search',
  description: '合并国际新闻 RSS 摘要与通用 RSS/Atom 订阅源读取能力，采集标题、Feed 摘要和原文链接。',
  auth: {
    required: false, methods: ['none'],
    description: '读取发布方公开提供的 RSS/Atom URL，无需账号或 API Key。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: '最新新闻与关键词过滤',
      description: '从内置公开 Feed 读取最新条目，可按标题、摘要和分类进行本地关键词过滤。关键词为空时返回最新条目。',
      runtimeMode: 'search', budgetModel: 'scroll_count',
      depthBudget: { quick: 15, standard: 40, deep: 100 },
      inputFields: [
        {
          key: 'source', label: '新闻源', description: '平衡视角会读取 BBC World、NPR 与 Al Jazeera；也可只读取单一 Feed。',
          type: 'select', default: 'balanced', runtimeConfigKey: 'rss_news_source',
          options: [
            { value: 'balanced', label: '平衡视角（BBC + NPR + Al Jazeera）' },
            { value: 'bbc_world', label: 'BBC 世界新闻' },
            { value: 'bbc_top', label: 'BBC 头条' },
            { value: 'bbc_business', label: 'BBC 商业' },
            { value: 'bbc_technology', label: 'BBC 科技' },
            { value: 'npr_top', label: 'NPR 新闻' },
            { value: 'aljazeera_all', label: 'Al Jazeera' },
          ],
        },
        {
          key: 'period', label: '时间范围', description: '按 Feed 中的发布时间过滤；没有时间戳的条目仍会保留。',
          type: 'select', default: '7d', runtimeConfigKey: 'rss_news_period',
          options: [
            { value: '24h', label: '最近 24 小时' },
            { value: '7d', label: '最近 7 天' },
            { value: '30d', label: '最近 30 天' },
            { value: 'all', label: 'Feed 当前全部条目' },
          ],
        },
        {
          key: 'max_items', label: '最大采集数量', description: '全部选定 Feed 合并、去重后的最大入库条目数。',
          type: 'number', default: 20, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: 'rss_news_item', outputFields: RSS_NEWS_OUTPUTS,
      limitations: [
        '只保存 Feed 自带的标题、摘要、来源和原文链接，不抓取新闻正文、图片、音视频或付费内容。',
        'BBC Feed 仅适合个人非商业阅读并须保留 BBC News 署名与原文链接；商业使用需另行取得许可。',
        'NPR、Al Jazeera 及自定义 Feed 的再利用条件由各发布方决定，用户需遵守对应条款。',
        'Feed 是当前快照，不支持历史翻页；采集深度仅控制合并后的最大条目数。',
      ],
    },
    {
      id: 'content_detail', label: '读取自定义 Feed',
      description: '读取一个或多个公开 RSS、RDF 或 Atom URL，并按时间和关键词过滤条目。',
      runtimeMode: 'detail', budgetModel: 'single_target',
      inputFields: [
        targetField('公开 RSS/Atom URL'),
        {
          key: 'period', label: '时间范围', description: '按 Feed 中的发布时间过滤。',
          type: 'select', default: '7d', runtimeConfigKey: 'rss_news_period',
          options: [
            { value: '24h', label: '最近 24 小时' },
            { value: '7d', label: '最近 7 天' },
            { value: '30d', label: '最近 30 天' },
            { value: 'all', label: 'Feed 当前全部条目' },
          ],
        },
        {
          key: 'max_items', label: '最大采集数量', description: '多个 Feed 合并、去重后的最大入库条目数。',
          type: 'number', default: 20, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: 'rss_news_item', outputFields: RSS_NEWS_OUTPUTS,
      limitations: [
        '拒绝 localhost、私有 IP 和本地网络 URL，单个 Feed 响应最大 5 MB。',
        '仅解析 Feed 当前提供的元数据，不提供订阅状态、已读状态或历史监控数据库。',
        '使用自定义 Feed 前应确认发布方允许相应用途。',
      ],
    },
  ],
};

const aiHot: ConnectorManifest = {
  id: 'aihot', version: '1.0.0', name: 'AI HOT', icon: 'flame', category: 'web_search',
  description: 'AI HOT 精选资讯、当前多源热点、AI 日报与事件时间线连接器。',
  auth: {
    required: false, methods: ['none'],
    description: '官方公开 API v1，匿名只读，无需 API Key。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'keyword_search', label: 'AI 资讯与热点',
      description: '查询最近 AI 资讯，或直接采集当前热点和最新日报。资讯模式支持关键词、分类与时间窗口。',
      runtimeMode: 'search', budgetModel: 'true_pagination',
      depthBudget: { quick: 20, standard: 50, deep: 100 },
      inputFields: [
        {
          key: 'content_mode', label: '内容模式', description: '资讯查询使用关键词和筛选条件；热点与日报不需要关键词。',
          type: 'select', default: 'items', runtimeConfigKey: 'aihot_content_mode',
          options: [
            { value: 'items', label: '最近 AI 资讯' },
            { value: 'hot_topics', label: '当前多源热点' },
            { value: 'latest_daily', label: '最新 AI 日报' },
          ],
        },
        {
          key: 'items_mode', label: '资讯范围', description: '精选适合默认调研；公开池覆盖更多最近内容。仅资讯模式生效。',
          type: 'select', default: 'selected', runtimeConfigKey: 'aihot_items_mode',
          options: [
            { value: 'selected', label: '精选' },
            { value: 'all', label: '最近 7 天公开池' },
          ],
        },
        {
          key: 'window', label: '时间窗口', description: '仅资讯模式生效。',
          type: 'select', default: '24h', runtimeConfigKey: 'aihot_window',
          options: [
            { value: '24h', label: '最近 24 小时' },
            { value: '7d', label: '最近 7 天' },
          ],
        },
        {
          key: 'category', label: '内容分类', description: '仅资讯模式生效；论文需明确选择“论文研究”。',
          type: 'select', default: 'all', runtimeConfigKey: 'aihot_category',
          options: [
            { value: 'all', label: '全部分类' },
            { value: 'ai-models', label: 'AI 模型' },
            { value: 'ai-products', label: 'AI 产品' },
            { value: 'industry', label: '行业动态' },
            { value: 'paper', label: '论文研究' },
            { value: 'tip', label: '技巧与观点' },
          ],
        },
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多采集的资讯数；热点与日报按本次任务总量限制。',
          type: 'number', default: 20, min: 1, max: 100, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: 'aihot_article', outputFields: [
        { key: 'content_id', label: 'AI HOT 内容 ID', type: 'string', required: true },
        { key: 'title', label: '标题', type: 'string', required: true },
        { key: 'summary', label: 'AI 生成摘要', type: 'string' },
        { key: 'creator_name', label: '原始来源', type: 'string' },
        { key: 'content_url', label: 'AI HOT canonical', type: 'string' },
        { key: 'original_url', label: '原文链接', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'string' },
        { key: 'category', label: '分类', type: 'string' },
        { key: 'score', label: '精选评分', type: 'number' },
      ],
      limitations: [
        '摘要和翻译由 AI 生成，数字、政策与原话等重要事实需回原文核对。',
        '正文不在 items 响应中；输出保留 AI HOT attribution、canonical 与原文链接。',
        '热点与日报是当前快照，不包含 snapshot + changes 的长期镜像同步。',
      ],
    },
    {
      id: 'content_detail', label: '热点事件详情',
      description: '根据 AI HOT story publicId 或 /stories/ 链接获取事件摘要、报道时间线、同线事件与相关事件。',
      runtimeMode: 'detail', budgetModel: 'single_target',
      inputFields: [
        {
          key: 'specified_ids', label: 'Story ID 或链接', description: '填写 API 返回的 story publicId 或 AI HOT /stories/ 链接。',
          type: 'string_list', required: true, runtimeConfigKey: 'specified_ids',
        },
      ],
      outputType: 'aihot_story', outputFields: [
        { key: 'content_id', label: 'Story publicId', type: 'string', required: true },
        { key: 'title', label: '事件标题', type: 'string', required: true },
        { key: 'summary', label: '事件 AI 摘要', type: 'string' },
        { key: 'content_url', label: 'AI HOT 事件页', type: 'string' },
        { key: 'source_count', label: '独立来源数', type: 'number' },
        { key: 'report_count', label: '报道数', type: 'number' },
        { key: 'reports', label: '报道时间线', type: 'object' },
      ],
      limitations: [
        '只接受 API 实际返回的 story publicId；普通 /items/ 链接不能推导 story ID。',
        '事件合并时跟随 API 308 重定向；不存在或未公开的事件会返回 404。',
      ],
    },
  ],
};

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
      budgetModel: 'single_target',
      inputFields: [
        {
          key: 'specified_ids', label: '目标链接或短链', description: '支持作品链接、短链或分享文本，多个目标使用逗号或换行分隔。',
          type: 'string_list', required: true, runtimeConfigKey: 'specified_ids',
        },
      ],
      outputType: `${id}_resolved_media`, outputFields: [
        { key: 'content_id', label: '作品 ID', type: 'string', required: true },
        { key: 'original_platform', label: '原始所属平台', type: 'string' },
        { key: 'title', label: '标题/文案', type: 'string' },
        { key: 'summary', label: '内容摘要', type: 'string' },
        { key: 'creator_name', label: '作者名称', type: 'string' },
        { key: 'content_url', label: '原作品链接', type: 'string' },
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
      budgetModel: 'fixed_per_keyword',
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '向 AI 提交的问题词条数。',
          type: 'number', default: 15, min: 1, max: 500, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_qa_result`, outputFields: [
        { key: 'content_id', label: '问答 ID', type: 'string', required: true },
        { key: 'title', label: '提问词/关键词', type: 'string' },
        { key: 'summary', label: '回答摘要', type: 'string' },
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
      budgetModel: 'scroll_count',
      depthBudget: { quick: 20, standard: 50, deep: 150 },
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的岗位数。',
          type: 'number', default: 20, min: 1, max: 200, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_job_list`, outputFields: [
        { key: 'content_id', label: '职位 ID', type: 'string', required: true },
        { key: 'title', label: '职位名称', type: 'string' },
        { key: 'summary', label: '职位摘要', type: 'string' },
        { key: 'description', label: '薪资与职位概述', type: 'string' },
        { key: 'creator_name', label: '招聘公司', type: 'string' },
        { key: 'salary', label: '薪资', type: 'string' },
        { key: 'work_city', label: '工作城市', type: 'string' },
        { key: 'job_experience', label: '经验要求', type: 'string' },
        { key: 'education', label: '学历要求', type: 'string' },
        { key: 'rank', label: '搜索排名', type: 'number' },
        { key: 'content_url', label: '职位详情链接', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'number' },
      ], limitations: ['依靠公开 SERP 与网页全量 HTML/JSON 全局变量。'],
    },
    {
      id: 'content_detail', label: '职位详情解析', description: `根据 ID 或完整链接解析${name}职位详细 JD 描述及精准发布时间。`, runtimeMode: 'detail',
      budgetModel: 'single_target',
      inputFields: [targetField('职位详情链接或 ID')], outputType: `${id}_job_detail`, outputFields: [
        { key: 'content_id', label: '职位 ID', type: 'string', required: true },
        { key: 'title', label: '职位名称', type: 'string' },
        { key: 'summary', label: '职位摘要', type: 'string' },
        { key: 'description', label: '完整 JD 描述', type: 'string' },
        { key: 'creator_name', label: '公司名称', type: 'string' },
        { key: 'salary', label: '薪资', type: 'string' },
        { key: 'work_city', label: '工作城市', type: 'string' },
        { key: 'job_experience', label: '经验要求', type: 'string' },
        { key: 'education', label: '学历要求', type: 'string' },
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
      budgetModel: 'scroll_count',
      depthBudget: { quick: 20, standard: 50, deep: 150 },
      inputFields: [
        {
          key: 'max_items', label: '最大采集数量', description: '每个关键词最多入库的投诉单数。',
          type: 'number', default: 20, min: 1, max: 200, runtimeConfigKey: 'crawler_max_notes_count',
        },
      ],
      outputType: `${id}_complaint_list`, outputFields: [
        { key: 'content_id', label: '投诉单 ID', type: 'string', required: true },
        { key: 'title', label: '投诉标题', type: 'string' },
        { key: 'summary', label: '投诉摘要', type: 'string' },
        { key: 'description', label: '投诉问题与诉求', type: 'string' },
        { key: 'creator_name', label: '投诉对象/商家', type: 'string' },
        { key: 'status', label: '处理状态', type: 'string' },
        { key: 'rank', label: '搜索排名', type: 'number' },
        { key: 'content_url', label: '投诉单详情链接', type: 'string' },
        { key: 'published_at', label: '投诉时间', type: 'number' },
      ], limitations: ['依赖公开搜索页面与 DOM/JSON 数据解析。'],
    },
    {
      id: 'content_detail', label: '投诉单详情解析', description: `根据 ID 或链接解析${name}完整投诉内容、涉诉金额与处理节点。`, runtimeMode: 'detail',
      budgetModel: 'single_target',
      inputFields: [targetField('投诉详情链接或 ID')], outputType: `${id}_complaint_detail`, outputFields: [
        { key: 'content_id', label: '投诉单 ID', type: 'string', required: true },
        { key: 'title', label: '投诉标题', type: 'string' },
        { key: 'summary', label: '投诉摘要', type: 'string' },
        { key: 'description', label: '完整投诉问题与要求', type: 'string' },
        { key: 'creator_name', label: '被投诉商家', type: 'string' },
        { key: 'status', label: '处理状态', type: 'string' },
        { key: 'content_url', label: '投诉单链接', type: 'string' },
        { key: 'published_at', label: '精确投诉时间', type: 'number' },
      ], limitations: ['依赖单条投诉网页 DOM/JSON 元数据。'],
    },
  ],
});

const webReader: ConnectorManifest = {
  id: 'web_reader', version: '1.0.0', name: '通用网页阅读器', icon: 'file-text', category: 'utility',
  description: '全网通用网页正文与文章采集阅读器。支持输入任意公开网页 HTTP/HTTPS 链接，自动抽取网页标题、真实正文文本、发布时间、来源站点与核心图片。',
  auth: {
    required: false, methods: ['none'],
    description: '无需登录，直接抓取公开网页。',
  },
  runtime: { engine: 'http', isolatedProcess: true, supportsHeadless: true },
  capabilities: [
    {
      id: 'content_detail', label: '网页正文解析', description: '输入单个或多个网页链接，提取抓取其完整文章正文、标题与元数据。', runtimeMode: 'detail',
      budgetModel: 'single_target',
      inputFields: [
        {
          key: 'specified_ids', label: '网页 URL 列表', description: '支持任意 HTTP/HTTPS 网页链接，多个目标使用逗号或换行分隔。',
          type: 'string_list', required: true, runtimeConfigKey: 'specified_ids',
        },
        {
          key: 'timeout_ms_per_url', label: '单页超时', description: '读取单个网页的最长等待时间（毫秒）。',
          type: 'number', default: 15000, min: 1000, max: 30000, runtimeConfigKey: 'web_reader_timeout_ms',
        },
        {
          key: 'concurrency', label: '读取并发数', description: '同时读取的网页数量。',
          type: 'number', default: 3, min: 1, max: 8, runtimeConfigKey: 'web_reader_concurrency',
        },
      ],
      outputType: 'web_reader_content', outputFields: [
        { key: 'content_id', label: '网页 URL', type: 'string', required: true },
        { key: 'title', label: '网页标题', type: 'string' },
        { key: 'summary', label: '网页摘要', type: 'string' },
        { key: 'description', label: '网页正文', type: 'string' },
        { key: 'content_url', label: '网页链接', type: 'string' },
        { key: 'creator_name', label: '作者/来源', type: 'string' },
        { key: 'site_name', label: '站点名称', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'string' },
        { key: 'images', label: '网页图片', type: 'string_list' },
      ], limitations: ['依赖网页公开可见的 HTML DOM。'],
    },
    {
      id: 'url_resolve', label: '网页短链解析与提取', description: '展开重定向短链并解析提取网页正文。', runtimeMode: 'detail',
      budgetModel: 'single_target',
      inputFields: [
        {
          key: 'specified_ids', label: '目标链接或短链', description: '多个目标使用逗号或换行分隔。',
          type: 'string_list', required: true, runtimeConfigKey: 'specified_ids',
        },
        {
          key: 'timeout_ms_per_url', label: '单页超时', description: '读取单个网页的最长等待时间（毫秒）。',
          type: 'number', default: 15000, min: 1000, max: 30000, runtimeConfigKey: 'web_reader_timeout_ms',
        },
        {
          key: 'concurrency', label: '读取并发数', description: '同时读取的网页数量。',
          type: 'number', default: 3, min: 1, max: 8, runtimeConfigKey: 'web_reader_concurrency',
        },
      ],
      outputType: 'web_reader_content', outputFields: [
        { key: 'content_id', label: '网页 URL', type: 'string', required: true },
        { key: 'title', label: '网页标题', type: 'string' },
        { key: 'summary', label: '网页摘要', type: 'string' },
        { key: 'description', label: '网页正文', type: 'string' },
        { key: 'content_url', label: '网页链接', type: 'string' },
        { key: 'creator_name', label: '作者/来源', type: 'string' },
        { key: 'site_name', label: '站点名称', type: 'string' },
        { key: 'published_at', label: '发布时间', type: 'string' },
        { key: 'images', label: '网页图片', type: 'string_list' },
      ], limitations: ['依赖网页公开可见的 HTML DOM。'],
    },
  ],
};

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
  searchEngine('toutiao', '头条搜索', 'newspaper'),
  arxiv,
  githubRepositories,
  rssNews,
  aiHot,
  webReader,
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
