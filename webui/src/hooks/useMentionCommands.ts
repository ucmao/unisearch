import { useState, useCallback } from 'react'

export type MentionCategory = 'social' | 'search' | 'job_complaint' | 'ai_qa' | 'utility' | 'skill' | 'agent' | 'action'

export interface MentionEntity {
  id: string
  key: string
  name: string
  category: MentionCategory
  categoryLabel: string
  icon?: string
  description?: string
  command?: string
}


// 从消息正文中还原出用户通过 @ 菜单选中过的实体 id。
// 选中时插入的是纯文本 "@名称 "，发送时并无结构化字段，因此按名称在文本中
// 反向匹配；要求 @ 前是句首或空白，避免误吃到句子中间的普通文字。
// entities 由 useSkillMentionEntities() 提供（后端下发），这里不再自带 Skill 表。
function extractMentionedIds(text: string, entities: MentionEntity[]): string[] {
  const found = new Set<string>()
  for (const entity of entities) {
    const pattern = new RegExp(`(^|\\s)@${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`)
    if (pattern.test(text)) found.add(entity.id)
  }
  return Array.from(found)
}

export function extractMentionedSkillIds(text: string, entities: MentionEntity[]): string[] {
  return extractMentionedIds(text, entities.filter((entity) => entity.category === 'skill'))
}

export const SLASH_COMMANDS: MentionEntity[] = [
  { id: 'cmd_crawl', key: 'crawl', name: '/crawl', category: 'action', categoryLabel: '快捷指令', description: '按关键词规划并发起采集', command: '/crawl' },
  {
    id: 'cmd_report',
    key: 'report',
    name: '/report',
    category: 'action',
    categoryLabel: '快捷指令',
    description: '根据当前会话数据生成综合简报',
    command: '请基于当前会话抓取到的所有舆情与数据内容，生成一份结构化的《综合分析与舆情简报》，包含以下维度：\n1. 整体情感倾向与声量走向\n2. 核心争议与关注焦点（TOP 3）\n3. 核心平台讨论差异比较\n4. 代表性原帖/观点总结与建议',
  },
]

export interface UseMentionCommandsOptions {
  value: string
  onChange: (newValue: string) => void
  /** @ 菜单只接收可调用的业务 Skill。 */
  mentionEntities: MentionEntity[]
}

export function useMentionCommands({ value, onChange, mentionEntities }: UseMentionCommandsOptions) {
  const [isOpen, setIsOpen] = useState(false)
  const [triggerType, setTriggerType] = useState<'@' | '/' | null>(null)
  const [filterText, setFilterText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // 过滤后的实体列表
  const filteredEntities = useCallback(() => {
    if (!triggerType) return []
    const rawList = triggerType === '@' ? mentionEntities : SLASH_COMMANDS
    if (!filterText.trim()) return rawList
    const query = filterText.toLowerCase()
    return rawList.filter(
      (item) => item.name.toLowerCase().includes(query) || item.key.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query)
    )
  }, [triggerType, filterText, mentionEntities])

  const items = filteredEntities()

  // 处理输入变化，寻找最新的 @ 或 / 触发词
  const handleInputChange = (text: string, cursorPosition: number) => {
    onChange(text)

    const textBeforeCursor = text.slice(0, cursorPosition)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    const lastSlashIndex = textBeforeCursor.lastIndexOf('/')

    const activeTriggerIndex = Math.max(lastAtIndex, lastSlashIndex)

    if (activeTriggerIndex !== -1) {
      const char = textBeforeCursor[activeTriggerIndex]
      // 确认触发符前面是空格或位于句首
      const isStart = activeTriggerIndex === 0 || /\s/.test(textBeforeCursor[activeTriggerIndex - 1])
      const queryText = textBeforeCursor.slice(activeTriggerIndex + 1)
      // 如果查询文本中没有换行且没有被空格断开，开启 Popover
      if (isStart && !/\s/.test(queryText) && !queryText.includes('\n')) {
        setTriggerType(char as '@' | '/')
        setFilterText(queryText)
        setIsOpen(true)
        setSelectedIndex(0)
        return
      }
    }

    setIsOpen(false)
    setTriggerType(null)
    setFilterText('')
  }

  // 选中某一项
  const selectItem = (item: MentionEntity, cursorPosition: number) => {
    const textBeforeCursor = value.slice(0, cursorPosition)
    const textAfterCursor = value.slice(cursorPosition)

    const triggerChar = triggerType === '@' ? '@' : '/'
    const lastTriggerIndex = textBeforeCursor.lastIndexOf(triggerChar)

    if (lastTriggerIndex !== -1) {
      const beforeTrigger = value.slice(0, lastTriggerIndex)
      const insertedText = triggerType === '@' ? `@${item.name} ` : `${item.command || item.name} `
      const newText = beforeTrigger + insertedText + textAfterCursor

      onChange(newText)
      setIsOpen(false)
      setTriggerType(null)
      setFilterText('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, cursorPosition: number) => {
    if (!isOpen || items.length === 0) return false

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % items.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + items.length) % items.length)
      return true
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (!e.nativeEvent.isComposing) {
        e.preventDefault()
        selectItem(items[selectedIndex], cursorPosition)
        return true
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      setTriggerType(null)
      return true
    }
    return false
  }

  return {
    isOpen,
    triggerType,
    items,
    selectedIndex,
    setSelectedIndex,
    handleInputChange,
    selectItem,
    handleKeyDown,
    closePopover: () => setIsOpen(false),
  }
}
