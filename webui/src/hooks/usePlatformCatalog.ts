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

/** @ 菜单用的可调用业务技能与执行工具。 */
export function useSkillMentionEntities(): MentionEntity[] {
  const { data } = useQuery({
    queryKey: ['skills'],
    queryFn: async () => (await agentApi.listSkills()).data.items,
    staleTime: Infinity,
  })
  return useMemo(() => (data || [])
    .filter((skill) => ['business', 'tool'].includes(skill.category) && skill.mentionable)
    .sort((left, right) => (left.category === right.category ? 0 : left.category === 'business' ? -1 : 1))
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
