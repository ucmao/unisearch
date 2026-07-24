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

export const CONNECTOR_ENTITIES: MentionEntity[] = [
  // 社交平台
  { id: 'xhs', key: 'xhs', name: '小红书', category: 'social', categoryLabel: '社交平台', description: '作品、创作者及评论采集' },
  { id: 'douyin', key: 'douyin', name: '抖音', category: 'social', categoryLabel: '社交平台', description: '短视频、图文及回复采集' },
  { id: 'kuaishou', key: 'kuaishou', name: '快手', category: 'social', categoryLabel: '社交平台', description: '视频及评论采集' },
  { id: 'bili', key: 'bili', name: '哔哩哔哩', category: 'social', categoryLabel: '社交平台', description: 'B站视频、弹幕及评论采集' },
  { id: 'weibo', key: 'weibo', name: '微博', category: 'social', categoryLabel: '社交平台', description: '博文及转发评论采集' },
  { id: 'tieba', key: 'tieba', name: '百度贴吧', category: 'social', categoryLabel: '社交平台', description: '主题帖及楼层回复采集' },
  { id: 'zhihu', key: 'zhihu', name: '知乎', category: 'social', categoryLabel: '社交平台', description: '问题、回答与文章采集' },

  // 搜索引擎
  { id: 'baidu', key: 'baidu', name: '百度搜索', category: 'search', categoryLabel: '搜索引擎', description: '百度 SERP 网页检索' },
  { id: 'bing', key: 'bing', name: '必应中国', category: 'search', categoryLabel: '搜索引擎', description: 'Bing 全球/国内网页检索' },
  { id: 'so360', key: 'so360', name: '360搜索', category: 'search', categoryLabel: '搜索引擎', description: '360 网页搜索结果提取' },
  { id: 'sogou', key: 'sogou', name: '搜狗搜索', category: 'search', categoryLabel: '搜索引擎', description: '搜狗网页及微信内容检索' },

  // 招聘与投诉
  { id: 'zhaopin', key: 'zhaopin', name: '智联招聘', category: 'job_complaint', categoryLabel: '招聘与投诉', description: '招聘岗位列表与 JD 详情解析' },
  { id: 'heimao', key: 'heimao', name: '黑猫投诉', category: 'job_complaint', categoryLabel: '招聘与投诉', description: '维权投诉单与涉诉商家解析' },

  // AI 智能问答与联网
  { id: 'deepseek', key: 'deepseek', name: 'DeepSeek', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: '网页端 R1/V3 思考过程及深度问答' },
  { id: 'kimi', key: 'kimi', name: 'Kimi', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: 'Moonshot 长文本及联网检索问答' },
  { id: 'doubao', key: 'doubao', name: '豆包', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: '字节豆包 AI 智能问答' },
  { id: 'qwen', key: 'qwen', name: '通义千问', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: '阿里通义千问对话采集' },
  { id: 'yuanbao', key: 'yuanbao', name: '腾讯元宝', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: '腾讯元宝 AI 对话及参考资料' },
  { id: 'nami', key: 'nami', name: '纳米AI', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: '纳米 AI 搜索与总结' },
  { id: 'wenxin', key: 'wenxin', name: '文心一言', category: 'ai_qa', categoryLabel: 'AI 问答/联网', description: '百度文心一言智能对话' },

  // 工具解析
  { id: 'media_parser', key: 'media_parser', name: '综合无水印解析', category: 'utility', categoryLabel: '工具解析', description: '多平台公开无水印音视频提取' },
]

export const SLASH_COMMANDS: MentionEntity[] = [
  { id: 'cmd_crawl', key: 'crawl', name: '/crawl', category: 'action', categoryLabel: '快捷指令', description: '发起多平台采集任务（例如: /crawl 极氪001）', command: '/crawl ' },
  { id: 'cmd_export', key: 'export', name: '/export', category: 'action', categoryLabel: '快捷指令', description: '快速导出当前任务结果数据', command: '/export' },
  { id: 'cmd_clear', key: 'clear', name: '/clear', category: 'action', categoryLabel: '快捷指令', description: '清空当前对话上下文记录', command: '/clear' },
]

export interface UseMentionCommandsOptions {
  value: string
  onChange: (newValue: string) => void
  onExecuteCommand?: (cmd: string) => void
}

export function useMentionCommands({ value, onChange, onExecuteCommand }: UseMentionCommandsOptions) {
  const [isOpen, setIsOpen] = useState(false)
  const [triggerType, setTriggerType] = useState<'@' | '/' | null>(null)
  const [filterText, setFilterText] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  // 过滤后的实体列表
  const filteredEntities = useCallback(() => {
    if (!triggerType) return []
    const rawList = triggerType === '@' ? CONNECTOR_ENTITIES : SLASH_COMMANDS
    if (!filterText.trim()) return rawList
    const query = filterText.toLowerCase()
    return rawList.filter(
      (item) => item.name.toLowerCase().includes(query) || item.key.toLowerCase().includes(query) || item.description?.toLowerCase().includes(query)
    )
  }, [triggerType, filterText])

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
