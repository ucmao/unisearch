import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePlatforms } from './useCrawler'
import { agentApi } from '@/lib/api'
import type { MentionCategory, MentionEntity } from './useMentionCommands'

/**
 * 平台目录的唯一前端入口。数据来自 /api/config/platforms，后端又直接从
 * CONNECTOR_MANIFESTS 派生，因此平台中文名全应用只有一处定义。
 * 之前每个展示组件各维护一张 id→中文名的表，新增平台必须记得改八处，
 * toutiao 就是这样在「任务范围」「结果看板」里露出英文 id 的。
 */

/** connector 分类 → @ 菜单分组。 */
const MENTION_GROUPS: Record<string, { category: MentionCategory; label: string }> = {
  social_media: { category: 'social', label: '社交平台' },
  web_search: { category: 'search', label: '搜索引擎' },
  job_platform: { category: 'job_complaint', label: '招聘与投诉' },
  complaint_platform: { category: 'job_complaint', label: '招聘与投诉' },
  ai_web_qa: { category: 'ai_qa', label: 'AI 问答/联网' },
  utility: { category: 'utility', label: '工具解析' },
}

const GROUP_ORDER: MentionCategory[] = ['social', 'search', 'job_complaint', 'ai_qa', 'utility']

/**
 * @ 菜单里的一句话说明。manifest 的 description 面向连接器文档，偏长
 * （media_parser 那条列了几十个站点），菜单里放不下，所以这里保留一份精简
 * 文案——注意只写用途，不写平台名，名称仍然只有 manifest 一个来源。
 */
const MENTION_DESCRIPTIONS: Record<string, string> = {
  xhs: '作品、创作者及评论采集',
  douyin: '短视频、图文及回复采集',
  kuaishou: '视频及评论采集',
  bili: '视频、弹幕及评论采集',
  weibo: '博文及转发评论采集',
  tieba: '主题帖及楼层回复采集',
  zhihu: '问题、回答与文章采集',
  baidu: 'SERP 网页检索',
  bing: '全球/国内网页检索',
  so360: '网页搜索结果提取',
  sogou: '网页及微信内容检索',
  toutiao: '全网网页与资讯检索',
  zhaopin: '招聘岗位列表与 JD 详情解析',
  heimao: '维权投诉单与涉诉商家解析',
  deepseek: '思考过程及深度问答',
  kimi: '长文本及联网检索问答',
  doubao: 'AI 智能问答',
  qwen: '对话采集',
  yuanbao: 'AI 对话及参考资料',
  nami: 'AI 搜索与总结',
  wenxin: '智能对话采集',
  media_parser: '多平台公开无水印音视频提取',
}

/** id → 中文名。数据未就绪时返回空表，调用方用 platformLabel() 回落到 id。 */
export function usePlatformLabels(): Record<string, string> {
  const { data } = usePlatforms()
  return useMemo(
    () => Object.fromEntries((data || []).map((platform) => [platform.value, platform.label])),
    [data],
  )
}

/** @ 提及菜单用的平台条目，按分组排序。 */
export function usePlatformMentionEntities(): MentionEntity[] {
  const { data } = usePlatforms()
  return useMemo(() => {
    const entities = (data || []).map((platform) => {
      const group = MENTION_GROUPS[platform.category || ''] || { category: 'utility' as MentionCategory, label: '其他' }
      return {
        id: platform.value,
        key: platform.value,
        name: platform.label,
        category: group.category,
        categoryLabel: group.label,
        icon: platform.icon,
        description: MENTION_DESCRIPTIONS[platform.value] || platform.description,
      }
    })
    return entities.sort((a, b) => GROUP_ORDER.indexOf(a.category) - GROUP_ORDER.indexOf(b.category))
  }, [data])
}

/** @ 菜单用的可调用业务 Skill。 */
export function useSkillMentionEntities(): MentionEntity[] {
  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => (await agentApi.listSkills()).data.items,
    staleTime: Infinity,
  })
  return useMemo(() => (data || [])
    .filter((skill) => skill.category === 'business' && skill.mentionable)
    .map((skill) => ({
      id: skill.id,
      key: skill.id,
      name: skill.name,
      category: 'skill' as MentionCategory,
      categoryLabel: '业务 Skill',
      icon: skill.icon,
      description: skill.description,
    })), [data])
}

export function platformLabel(labels: Record<string, string>, id: string): string {
  return labels[id] || id
}
