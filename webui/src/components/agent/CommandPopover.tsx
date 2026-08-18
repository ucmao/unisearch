import { useRef, useEffect } from 'react'
import { Sparkles, Terminal, BookOpen, Music, Video, Tv, MessageCircle, MessagesSquare, HelpCircle, Search, Globe, Compass, Briefcase, ShieldAlert, Brain, Bot, Atom, Gem, Link2, Zap, Shield, Newspaper, FileText } from 'lucide-react'
import type { MentionEntity } from '@/hooks/useMentionCommands'

interface CommandPopoverProps {
  isOpen: boolean
  triggerType: '@' | '/' | null
  items: MentionEntity[]
  selectedIndex: number
  onSelect: (item: MentionEntity) => void
  onMouseEnterItem: (index: number) => void
  onClose?: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}

const CATEGORY_ICONS: Record<string, any> = {
  social: BookOpen,
  search: Search,
  job_complaint: Briefcase,
  ai_qa: Brain,
  utility: Link2,
  skill: Sparkles,
  tool: Link2,
  action: Terminal,
}

const ENTITY_ICONS: Record<string, any> = {
  // Slash Commands
  crawl: Search,
  report: FileText,
  // Skills & Tools
  'web-search-research': Globe,
  'social-search-research': MessageCircle,
  'ai-qa-research': Brain,
  'job-search-research': Briefcase,
  'academic-search-research': BookOpen,
  'code-search-research': Terminal,
  'web-media-parser': Link2,
  'marketing-content-research': Sparkles,
  'brand-geo-risk-monitor': ShieldAlert,
  'hr-salary-benchmark': Briefcase,
  // Platforms & Connectors
  xhs: BookOpen,
  douyin: Music,
  kuaishou: Video,
  bili: Tv,
  weibo: MessageCircle,
  tieba: MessagesSquare,
  zhihu: HelpCircle,
  baidu: Search,
  bing: Globe,
  so360: Compass,
  sogou: Search,
  toutiao: Newspaper,
  quark: Zap,
  chinaso: Shield,
  boss: Briefcase,
  zhaopin: Briefcase,
  job51: Briefcase,
  liepin: Briefcase,
  heimao: ShieldAlert,
  media_parser: Link2,
  deepseek: Brain,
  kimi: Sparkles,
  doubao: Bot,
  qwen: MessageCircle,
  yuanbao: Gem,
  nami: Atom,
  wenxin: HeartIcon,
}

function HeartIcon(props: any) {
  return <Sparkles {...props} />
}

export function CommandPopover({
  isOpen,
  triggerType,
  items,
  selectedIndex,
  onSelect,
  onMouseEnterItem,
  onClose,
  anchorRef,
}: CommandPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen || !onClose) return

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        (!anchorRef?.current || !anchorRef.current.contains(target))
      ) {
        onClose()
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose, anchorRef])

  useEffect(() => {
    if (containerRef.current && selectedIndex >= 0) {
      const selectedEl = containerRef.current.children[selectedIndex] as HTMLElement
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  if (!isOpen || !items.length) return null

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 w-full max-h-80 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-700/80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-xl transition-all animate-in fade-in slide-in-from-bottom-2 p-1.5">
      <div className="px-2.5 pt-1 pb-1 text-[11px] font-normal text-slate-400 dark:text-slate-500 select-none">
        {triggerType === '@' ? '技能' : '快捷指令'}
      </div>
      <div
        ref={containerRef}
        className="max-h-[168px] overflow-y-auto space-y-0.5 scrollbar-thin"
      >
        {items.map((item, index) => {
          const isSelected = index === selectedIndex
          const IconComponent = ENTITY_ICONS[item.key] || CATEGORY_ICONS[item.category] || Sparkles

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              onMouseEnter={() => onMouseEnterItem(index)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                isSelected
                  ? 'bg-slate-100 dark:bg-slate-800/80 text-slate-900 dark:text-slate-100 font-medium'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                  isSelected
                    ? 'border-slate-300 dark:border-slate-600 bg-slate-200/80 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
                    : 'border-slate-200/70 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500'
                }`}
              >
                <IconComponent className="h-3 w-3" />
              </div>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className={`shrink-0 text-xs ${isSelected ? 'font-semibold text-slate-900 dark:text-slate-100' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
                  {item.name}
                </span>
                {item.description ? (
                  <span className="truncate text-xs text-slate-400 dark:text-slate-500 font-normal">
                    {item.description}
                  </span>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
