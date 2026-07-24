import { useRef, useEffect } from 'react'
import { Sparkles, Terminal, BookOpen, Music, Video, Tv, MessageCircle, MessagesSquare, HelpCircle, Search, Globe, Compass, Briefcase, ShieldAlert, Brain, Bot, Atom, Gem, Link2 } from 'lucide-react'
import type { MentionEntity } from '@/hooks/useMentionCommands'

interface CommandPopoverProps {
  isOpen: boolean
  triggerType: '@' | '/' | null
  items: MentionEntity[]
  selectedIndex: number
  onSelect: (item: MentionEntity) => void
  onMouseEnterItem: (index: number) => void
}

const CATEGORY_ICONS: Record<string, any> = {
  social: BookOpen,
  search: Search,
  job_complaint: Briefcase,
  ai_qa: Brain,
  utility: Link2,
  action: Terminal,
}

const ENTITY_ICONS: Record<string, any> = {
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
  zhaopin: Briefcase,
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
}: CommandPopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null)

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
    <div className="absolute bottom-full left-0 z-50 mb-2 w-80 max-h-72 overflow-hidden rounded-xl border border-cyber-neon-cyan/30 bg-cyber-bg-panel/95 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.5)] transition-all animate-in fade-in slide-in-from-bottom-2">
      <div className="flex items-center justify-between border-b border-cyber-border-subtle bg-cyber-bg-tertiary/40 px-3 py-1.5 text-[10px] font-medium text-cyber-text-muted">
        <span className="flex items-center gap-1.5">
          {triggerType === '@' ? (
            <>
              <Sparkles className="h-3 w-3 text-cyber-neon-cyan" />
              <span>选择 Connector 目标平台 ({items.length})</span>
            </>
          ) : (
            <>
              <Terminal className="h-3 w-3 text-cyber-neon-cyan" />
              <span>快捷指令 ({items.length})</span>
            </>
          )}
        </span>
        <span className="font-mono text-[9px]">↑↓ 导航 · Enter 确认</span>
      </div>

      <div ref={containerRef} className="max-h-60 overflow-y-auto p-1 space-y-0.5 scrollbar-thin">
        {items.map((item, index) => {
          const isSelected = index === selectedIndex
          const IconComponent = ENTITY_ICONS[item.key] || CATEGORY_ICONS[item.category] || Sparkles

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              onMouseEnter={() => onMouseEnterItem(index)}
              className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all ${
                isSelected
                  ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan border border-cyber-neon-cyan/30 shadow-sm'
                  : 'text-cyber-text-primary hover:bg-cyber-bg-tertiary/60'
              }`}
            >
              <div
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${
                  isSelected
                    ? 'border-cyber-neon-cyan/40 bg-cyber-neon-cyan/20 text-cyber-neon-cyan'
                    : 'border-cyber-border-subtle bg-cyber-bg-secondary text-cyber-text-muted'
                }`}
              >
                <IconComponent className="h-3.5 w-3.5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium">{item.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.2 text-[9px] font-normal ${
                      item.category === 'social'
                        ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                        : item.category === 'ai_qa'
                        ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        : item.category === 'search'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}
                  >
                    {item.categoryLabel}
                  </span>
                </div>
                {item.description ? (
                  <p className="mt-0.5 truncate text-[10px] text-cyber-text-muted leading-tight">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
