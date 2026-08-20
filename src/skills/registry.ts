import { skillDefinitionSchema, type SkillDefinition, type SkillDefinitionInput } from '../core/skills/types';
import { CREATOR_TARGET_GUIDANCE } from '../connectors/creator-targets';
import { listWebSearchConnectorIds } from '../connectors/registry';

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(value: SkillDefinitionInput): void {
    const skill = skillDefinitionSchema.parse(value);
    if (this.skills.has(skill.id)) throw new Error(`Skill already registered: ${skill.id}`);
    this.skills.set(skill.id, skill);
  }

  get(id: string): SkillDefinition {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Unknown Skill: ${id}`);
    return skill;
  }

  find(id: string | null | undefined): SkillDefinition | null {
    return id ? this.skills.get(id) || null : null;
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }
}

export const skillRegistry = new SkillRegistry();

skillRegistry.register({
  id: 'multi-source-research',
  version: '1.0.0',
  name: '多来源资料采集',
  description: '从一个或多个 Connector 获取资料，并统一归一化为 Document。',
  inputs: [
    { key: 'platforms', required: true, description: '目标 Connector 列表' },
    { key: 'keywords', required: false, description: '关键词列表' },
    { key: 'targets', required: false, description: '详情、主体或 URL 目标' },
    { key: 'capability', required: true, description: 'Connector Capability' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
});

skillRegistry.register({
  id: 'web-search-research',
  version: '1.0.0',
  name: '网页搜索',
  description: '聚合百度、必应、360、搜狗、头条、神马和中国搜索，支持读取正文',
  category: 'tool',
  icon: 'search',
  mentionable: true,
  inputs: [
    { key: 'keywords', required: true, description: '一个或多个搜索关键词' },
    { key: 'collectionDepth', required: false, description: '快速、标准或深度采集' },
    { key: 'readingMode', required: false, description: '只看摘要、自动阅读全文或尽量阅读全文' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail'],
    itemProcessors: ['search-results.select', 'metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: listWebSearchConnectorIds(),
    capability: 'keyword_search',
    collectionDepth: 'quick',
    contentEnrichment: {
      mode: 'auto', maxReadItems: 8, maxPerDomain: 2, concurrency: 2, timeoutMsPerUrl: 15_000,
    },
    analysis: [],
    outputs: ['markdown'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '只读取公开可访问的 HTML 网页。',
    '搜索结果与正文读取均受站点反爬和网络状态影响。',
    '神马搜索可能触发浏览器安全验证，需要用户在内置浏览器中手动完成。',
  ],
});

skillRegistry.register({
  id: 'social-search-research',
  version: '1.0.0',
  name: '社媒搜索',
  description: '聚合小红书、抖音、快手、B站、微博、贴吧和知乎的公开作品与讨论',
  category: 'tool',
  icon: 'search',
  mentionable: true,
  inputs: [
    { key: 'keywords', required: true, description: '一个或多个搜索关键词' },
    { key: 'collectionDepth', required: false, description: '快速、标准或深度采集' },
    { key: 'collectComments', required: false, description: '是否同时采集评论' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail', 'comments'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['csv', 'markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: ['xhs', 'douyin', 'kuaishou', 'bili', 'weibo', 'tieba', 'zhihu'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '各平台均依赖各自登录态，只采集当前账号可见的公开内容。',
  ],
});

skillRegistry.register({
  id: 'ai-qa-research',
  version: '1.0.0',
  name: 'AI搜索',
  description: '聚合DeepSeek、Kimi、豆包、千问、元宝、纳米AI和文心一言的问答结果',
  category: 'tool',
  icon: 'search',
  mentionable: true,
  inputs: [
    { key: 'keywords', required: true, description: '提问或查询主题' },
    { key: 'collectionDepth', required: false, description: '快速或标准采集' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['csv', 'markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    'AI 回答只代表特定提问时间点下的模型生成结果。',
  ],
});

skillRegistry.register({
  id: 'job-search-research',
  version: '1.0.0',
  name: '岗位搜索',
  description: '聚合智联招聘、前程无忧、猎聘和BOSS直聘的公开职位数据',
  category: 'tool',
  icon: 'search',
  mentionable: true,
  inputs: [
    { key: 'keywords', required: true, description: '岗位名称或搜索关键词' },
    { key: 'cities', required: false, description: '目标城市' },
    { key: 'collectionDepth', required: false, description: '采集深度' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['csv', 'markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: ['zhaopin', 'job51', 'liepin', 'boss'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '公开招聘薪资仅供市场参考；BOSS直聘需获得授权。',
  ],
});

skillRegistry.register({
  id: 'academic-search-research',
  version: '1.0.0',
  name: '学术搜索',
  description: '检索arXiv学术论文库，获取文献摘要、作者与发布信息',
  category: 'tool',
  icon: 'search',
  mentionable: false,
  inputs: [
    { key: 'keywords', required: true, description: '论文主题、关键词或学者姓名' },
    { key: 'collectionDepth', required: false, description: '采集深度' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: ['arxiv'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['markdown'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '仅检索 arXiv 公开学术论文库。',
  ],
});

skillRegistry.register({
  id: 'code-search-research',
  version: '1.0.0',
  name: '代码搜索',
  description: '检索GitHub开源仓库、热门项目与Star趋势',
  category: 'tool',
  icon: 'search',
  mentionable: false,
  inputs: [
    { key: 'keywords', required: true, description: '仓库名、技术关键词或项目主题' },
    { key: 'collectionDepth', required: false, description: '采集深度' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: ['github_repositories'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['markdown'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '检索公开可访问的 GitHub 仓库。',
  ],
});

skillRegistry.register({
  id: 'web-media-parser',
  version: '1.0.0',
  name: '无水印解析',
  description: '批量解析30+平台作品链接，提取无水印视频、原图与元数据',
  category: 'tool',
  icon: 'link',
  mentionable: true,
  inputs: [
    { key: 'targets', required: true, description: '作品链接、分享短链或分享文案；多个目标逐行填写。' },
    { key: 'intervalSeconds', required: false, description: '批量解析的请求间隔，当前固定不少于 1 秒。' },
  ],
  workflow: {
    connectorCapabilities: ['url_resolve'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['csv', 'markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: ['media_parser'],
    capability: 'url_resolve',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '仅支持解析服务已适配且公开可访问的作品。',
    '删除、私密、过期或受平台风控限制的链接可能解析失败。',
  ],
});

skillRegistry.register({
  id: 'creator-profile-collection',
  version: '1.1.0',
  name: '博主主页采集',
  description: '按主页链接或 ID，采集小红书、抖音、B站等博主的公开作品',
  category: 'tool',
  icon: 'link',
  mentionable: true,
  inputs: [
    { key: 'platforms', required: true, description: '仅可选择小红书、抖音、快手、哔哩哔哩、微博、百度贴吧或知乎；提供可识别域名的主页链接时可自动判断。' },
    { key: 'targets', required: true, description: '按下方平台契约提供主页链接、分享短链或账号标识；多个目标逐行填写，裸 ID 必须与平台对应。' },
    { key: 'maxItems', required: false, description: '每个主页最多采集的公开作品数；0 表示持续翻页到平台返回末页。' },
    { key: 'collectComments', required: false, description: '是否同时采集作品下当前可见的评论与回复。' },
  ],
  targetGuidance: CREATOR_TARGET_GUIDANCE,
  workflow: {
    connectorCapabilities: ['creator_profile'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'dataset.profile'],
    exporters: ['csv', 'markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
  defaults: {
    platforms: [],
    capability: 'creator_profile',
    collectionDepth: 'quick',
    analysis: [],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: false,
    autoAnalyzeOnCompletion: false,
  },
  limitations: [
    '此技能严格限定为七个社交平台，不适用于搜索引擎、AI 问答、招聘、资讯站点或任意网页的主页采集。',
    '各平台所需账号标识不同；优先提供完整主页链接，并按下方 targetGuidance 的推荐格式输入。',
    '各平台均依赖各自登录态，只采集当前账号可见的公开内容。',
    '平台页面、接口或风控调整后，链接解析与翻页能力可能需要升级 Connector。',
  ],
});

const BUSINESS_WORKFLOW = {
  connectorCapabilities: ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'],
  itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
  analyzers: ['knowledge.index', 'dataset.profile'],
  exporters: ['markdown', 'json', 'obsidian', 'ima'],
  outputs: ['documents'],
};

skillRegistry.register({
  id: 'marketing-content-research',
  version: '1.0.0',
  name: '新媒体内容调研',
  description: '采集社媒公开作品和评论，分析主题、爆款表达、互动与用户诉求',
  category: 'business',
  icon: 'sparkles',
  mentionable: true,
  inputs: [
    { key: 'subject', required: true, description: '关键词，或对标账号名称、主页链接与账号 ID' },
    { key: 'timeRange', required: false, description: '观察时间范围' },
    { key: 'focus', required: false, description: '主题、爆款表达、互动或评论诉求等重点' },
  ],
  workflow: BUSINESS_WORKFLOW,
  defaults: {
    platforms: ['xhs', 'douyin'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: ['内容主题与表达方式', '平台内互动表现', '代表性内容', '评论诉求与问题', '内容机会'],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: true,
  },
  analysisInstructions: '按新媒体内容调研口径分析。按平台分别说明样本量和指标覆盖，不直接比较不同平台的绝对互动数。缺失指标不得补零；高赞评论需给出点赞或排序依据，否则称为代表性评论。区分数据发现与内容建议，不承诺全部作品、全部搜索结果或全部评论。',
  limitations: ['只处理当前登录态可见的公开内容。', '不将互动量等同于成交量。', '第一阶段以高频词和主题排行替代视觉词云。'],
});

skillRegistry.register({
  id: 'brand-geo-risk-monitor',
  version: '1.0.0',
  name: '品牌GEO监测',
  description: '对比品牌在多个 AI 平台中的呈现，识别负面主题与待核验风险',
  category: 'business',
  icon: 'sparkles',
  mentionable: true,
  inputs: [
    { key: 'subject', required: true, description: '品牌正式名称、别名及监测问题或关键词' },
    { key: 'riskTerms', required: false, description: '退款、宣传、服务、合同等风险词' },
    { key: 'competitors', required: false, description: '对比品牌' },
  ],
  workflow: BUSINESS_WORKFLOW,
  defaults: {
    platforms: ['deepseek', 'kimi', 'doubao', 'qwen'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: ['品牌可见性与回答一致性', '信息准确性线索', '负面主题与风险等级', '引用来源'],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: true,
  },
  analysisInstructions: '按品牌 GEO 与风险监测口径分析。AI 回答统计并说明样本量；AI 回答只代表特定时间和提问下的结果。风险评级必须给出理由和来源，只作为内部优先级，不构成事实或法律定性。',
  limitations: ['不承诺 12315、监管或劳动部门直连。', '不自动对外回应、联系投诉人或执行处置。'],
});

skillRegistry.register({
  id: 'hr-salary-benchmark',
  version: '1.0.0',
  name: '招聘薪酬调研',
  description: '基于公开岗位数据分析薪资分布、城市差异、学历经验与定价参考',
  category: 'business',
  icon: 'sparkles',
  mentionable: true,
  inputs: [
    { key: 'subject', required: true, description: '标准岗位名称与常见别名' },
    { key: 'cities', required: true, description: '目标城市或地区' },
    { key: 'level', required: false, description: '岗位级别、经验或学历范围' },
    { key: 'internalRange', required: false, description: '我方拟定薪资区间' },
  ],
  workflow: BUSINESS_WORKFLOW,
  defaults: {
    platforms: ['zhaopin'],
    capability: 'keyword_search',
    collectionDepth: 'quick',
    analysis: ['样本质量与薪资口径', '薪资分布', '城市与经验差异', '岗位要求', '招聘定价参考'],
    outputs: ['csv'],
  },
  execution: {
    autoStartWhenExplicitlyInvoked: true,
    autoAnalyzeOnCompletion: true,
  },
  analysisInstructions: '按招聘岗位薪酬调研口径分析。保留薪资原文；只有单位和周期明确时才标准化。面议、单位缺失和异常值不纳入区间统计但保留说明。所有统计展示有效样本量与时间范围，不混合不同城市、级别和口径；公开招聘薪资只是市场参考，不是实际在职薪资。',
  limitations: [
    '默认数据源仍为智联招聘；前程无忧、猎聘和已获官方书面授权的 BOSS 直聘需由用户显式选择。',
    'BOSS 直聘任务必须提交官方授权依据，且不采集简历、联系方式或聊天数据。',
    '不生成权威 PR 值、候选人供需比或个人薪酬结论。',
  ],
});

skillRegistry.register({
  id: 'media-to-knowledge',
  version: '1.0.0',
  name: '媒体转知识文档',
  description: '下载媒体、提取音轨、语音转写并建立知识索引。',
  inputs: [
    { key: 'documentIds', required: true, description: '待处理 Document ID 列表' },
  ],
  workflow: {
    connectorCapabilities: [],
    itemProcessors: ['asset.download', 'ffmpeg.extract_audio', 'whisper.transcribe'],
    analyzers: ['knowledge.index'],
    exporters: ['markdown', 'obsidian', 'ima'],
    outputs: ['documents', 'transcripts', 'knowledge_chunks'],
  },
});
