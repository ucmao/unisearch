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

/** id → 中文名。数据未就绪时返回空表，调用方用 platformLabel() 回落到 id。 */
export function usePlatformLabels(): Record<string, string> {
  const { data } = usePlatforms()
  return useMemo(
    () => Object.fromEntries((data || []).map((platform) => [platform.value, platform.label])),
    [data],
  )
}

const SKILL_ORDER: Record<string, number> = {
  // 4个搜索技能
  'web-search-research': 10,
  'social-search-research': 20,
  'ai-qa-research': 30,
  'job-search-research': 40,
  'academic-search-research': 50,
  'code-search-research': 60,
  // 2个工具技能
  'web-media-parser': 70,
  'creator-profile-collection': 75,
  // 3个深度业务研报技能
  'marketing-content-research': 80,
  'brand-geo-risk-monitor': 90,
  'hr-salary-benchmark': 100,
}

/** @ 菜单用的可调用业务技能与执行工具。 */
export function useSkillMentionEntities(): MentionEntity[] {
  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => (await agentApi.listSkills()).data.items,
    staleTime: Infinity,
  })
  return useMemo(() => (data || [])
    .filter((skill) => ['business', 'tool'].includes(skill.category) && skill.mentionable)
    .sort((left, right) => {
      const leftOrder = SKILL_ORDER[left.id] ?? (left.category === 'tool' ? 100 : 200)
      const rightOrder = SKILL_ORDER[right.id] ?? (right.category === 'tool' ? 100 : 200)
      return leftOrder - rightOrder
    })
    .map((skill) => ({
      id: skill.id,
      key: skill.id,
      name: skill.name,
      category: (skill.category === 'tool' ? 'tool' : 'skill') as MentionCategory,
      categoryLabel: skill.category === 'tool' ? '工具' : '技能',
      icon: skill.icon,
      description: skill.description,
    })), [data])
}

export function platformLabel(labels: Record<string, string>, id: string): string {
  return labels[id] || id
}
