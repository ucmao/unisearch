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


// 从消息正文中还原出用户通过 @ 菜单选中过的 connector id。
// 选中时插入的是纯文本 "@名称 "，发送时并无结构化字段，因此按名称在文本中
// 反向匹配；要求 @ 前是句首或空白，避免误吃到句子中间的普通文字。
// entities 由 usePlatformMentionEntities() 提供（后端下发），这里不再自带平台表。
function extractMentionedIds(text: string, entities: MentionEntity[]): string[] {
  const found = new Set<string>()
  for (const entity of entities) {
    const pattern = new RegExp(`(^|\\s)@${entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`)
    if (pattern.test(text)) found.add(entity.id)
  }
  return Array.from(found)
}

export function extractMentionedConnectorIds(text: string, entities: MentionEntity[]): string[] {
  return extractMentionedIds(text, entities.filter((entity) => entity.category !== 'skill'))
}

export function extractMentionedSkillIds(text: string, entities: MentionEntity[]): string[] {
  return extractMentionedIds(text, entities.filter((entity) => entity.category === 'skill'))
}

export const SLASH_COMMANDS: MentionEntity[] = [
  { id: 'cmd_crawl', key: 'crawl', name: '/crawl', category: 'action', categoryLabel: '快捷指令', description: '发起多平台采集任务（例如: /crawl 极氪001）', command: '/crawl ' },
  { id: 'cmd_export', key: 'export', name: '/export', category: 'action', categoryLabel: '快捷指令', description: '快速导出当前任务结果数据', command: '/export' },
  { id: 'cmd_clear', key: 'clear', name: '/clear', category: 'action', categoryLabel: '快捷指令', description: '清空当前对话上下文记录', command: '/clear' },
]

export interface UseMentionCommandsOptions {
  value: string
  onChange: (newValue: string) => void
  onExecuteCommand?: (cmd: string) => void
  /** @ 菜单条目，可同时包含业务 Skill 与 Connector。 */
  mentionEntities: MentionEntity[]
}

export function useMentionCommands({ value, onChange, onExecuteCommand, mentionEntities }: UseMentionCommandsOptions) {
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

      if (triggerType === '/' && onExecuteCommand) {
        onExecuteCommand(item.key)
      }
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
