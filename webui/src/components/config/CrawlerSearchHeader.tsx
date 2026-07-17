import { useEffect, useState, KeyboardEvent } from 'react'
import {
  BookOpen,
  Music,
  Video,
  Tv,
  MessageCircle,
  MessagesSquare,
  HelpCircle,
  Search,
  Play,
  Square,
  X,
  Check,
  Zap,
  Globe,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useCrawlerStore } from '@/store/crawlerStore'
import { usePlatforms, useStartCrawler, useStopCrawler } from '@/hooks/useCrawler'
import { toast } from 'sonner'
import { ParsedIdList } from './ParsedIdList'
import { detectPlatform } from '@/lib/urlParser'
import { useTranslation } from 'react-i18next'

const ICON_MAP: { [key: string]: any } = {
  'book-open': BookOpen,
  'music': Music,
  'video': Video,
  'tv': Tv,
  'message-circle': MessageCircle,
  'messages-square': MessagesSquare,
  'help-circle': HelpCircle,
}

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: '哔哩哔哩',
  wb: '微博',
  tieba: '百度贴吧',
  zhihu: '知乎',
}

export function CrawlerSearchHeader() {
  const { t } = useTranslation('config')
  const config = useCrawlerStore((state) => state.config)
  const updateConfig = useCrawlerStore((state) => state.updateConfig)
  const statuses = useCrawlerStore((state) => state.statuses)
  const selectedPlatforms = useCrawlerStore((state) => state.selectedPlatforms)
  const setSelectedPlatforms = useCrawlerStore((state) => state.setSelectedPlatforms)
  const platformCookies = useCrawlerStore((state) => state.platformCookies)

  const { data: platforms } = usePlatforms()
  const { mutate: startCrawler } = useStartCrawler()
  const { mutate: stopCrawler } = useStopCrawler()

  const [inputValue, setInputValue] = useState('')
  const isDisabled = Object.values(statuses).some((status) => status === 'running' || status === 'stopping')
  const targetValue = config.crawler_type === 'detail' ? config.specified_ids : config.creator_ids
  const idParserPlatform = selectedPlatforms[0] || ''

  useEffect(() => {
    if (config.crawler_type === 'search') return
    const detectedPlatform = detectPlatform(targetValue)
    const nextPlatforms = detectedPlatform ? [detectedPlatform] : []
    if (selectedPlatforms.join(',') !== nextPlatforms.join(',')) {
      setSelectedPlatforms(nextPlatforms)
    }
  }, [config.crawler_type, targetValue, selectedPlatforms, setSelectedPlatforms])

  // Keywords conversion
  const keywordsList = config.keywords
    ? config.keywords.split(',').map((k) => k.trim()).filter(Boolean)
    : []

  const addKeyword = () => {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    if (keywordsList.includes(trimmed)) {
      setInputValue('')
      return
    }
    const nextKeywords = [...keywordsList, trimmed].join(',')
    updateConfig({ keywords: nextKeywords })
    setInputValue('')
  }

  const removeKeyword = (keywordToRemove: string) => {
    const nextKeywords = keywordsList.filter((k) => k !== keywordToRemove).join(',')
    updateConfig({ keywords: nextKeywords })
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addKeyword()
    }
  }

  const handlePlatformToggle = (platformVal: string) => {
    const isSelected = selectedPlatforms.includes(platformVal)
    let nextSelection: string[]
    if (isSelected) {
      nextSelection = selectedPlatforms.filter((p) => p !== platformVal)
    } else {
      nextSelection = [...selectedPlatforms, platformVal]
    }
    setSelectedPlatforms(nextSelection)
  }

  const isAnyRunning = Object.values(statuses).some((s) => s === 'running')
  const isAnyStopping = Object.values(statuses).some((s) => s === 'stopping')

  const handleStartAll = () => {
    // If input is not empty, commit it first
    let finalKeywords = config.keywords
    if (inputValue.trim()) {
      const trimmed = inputValue.trim()
      if (!keywordsList.includes(trimmed)) {
        finalKeywords = [...keywordsList, trimmed].join(',')
        updateConfig({ keywords: finalKeywords })
      }
      setInputValue('')
    }

    if (!finalKeywords && config.crawler_type === 'search') {
      toast.error('请至少输入一个关键词')
      return
    }

    const targetValue = config.crawler_type === 'detail' ? config.specified_ids : config.creator_ids
    if (config.crawler_type !== 'search' && !targetValue.trim()) {
      toast.error('请先粘贴需要采集的平台链接')
      return
    }

    if (selectedPlatforms.length === 0) {
      toast.error(config.crawler_type === 'search' ? '请至少选择一个平台' : '无法识别平台，请粘贴完整的平台链接')
      return
    }

    if (config.login_type === 'cookie') {
      const missingCookiePlatform = selectedPlatforms.find((platform) => !platformCookies[platform]?.trim())
      if (missingCookiePlatform) {
        toast.error(`请填写 ${PLATFORM_LABELS[missingCookiePlatform] || missingCookiePlatform} 的 Cookie`)
        return
      }
    }

    selectedPlatforms.forEach((p) => {
      if (statuses[p] !== 'running' && statuses[p] !== 'stopping') {
        startCrawler({
          ...config,
          platform: p,
          keywords: finalKeywords,
          cookies: config.login_type === 'cookie' ? platformCookies[p] || '' : '',
        })
      }
    })
  }

  const handleStopAll = () => {
    stopCrawler(undefined)
  }

  return (
    <div className="w-full rounded-xl glass-panel p-4 space-y-4 float-panel border border-cyber-border-subtle bg-cyber-bg-panel/40 relative overflow-hidden">
      {/* Background cyber accent line */}
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-cyber-neon-cyan via-cyber-neon-purple to-cyber-neon-pink shadow-[0_0_8px_rgba(0,255,255,0.5)]" />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-end">
        {/* Keyword Search Input Bar */}
        <div className="space-y-2">
          <label className="text-xs text-cyber-text-secondary font-mono tracking-wider flex items-center gap-1.5 uppercase">
            <Zap className="w-3.5 h-3.5 text-cyber-neon-cyan animate-pulse" />
            {config.crawler_type === 'search' ? '扫描目标关键词' : '扫描目标配置'}
          </label>
          
          {config.crawler_type === 'search' ? (
            <div className="relative flex items-center">
              <Search className="absolute left-4 w-5 h-5 text-cyber-text-muted" />
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入关键词后按回车键或逗号添加..."
                className="pl-12 pr-4 h-12 text-sm font-mono bg-cyber-bg-tertiary/20 border-cyber-border-default/60 focus:border-cyber-neon-cyan focus:ring-1 focus:ring-cyber-neon-cyan shadow-inner rounded-xl transition-all"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <textarea
                  value={targetValue}
                  onChange={(event) => updateConfig(config.crawler_type === 'detail'
                    ? { specified_ids: event.target.value }
                    : { creator_ids: event.target.value })}
                  disabled={isDisabled}
                  placeholder={config.crawler_type === 'detail'
                    ? t('field.specifiedIdsPlaceholder.default')
                    : t('field.creatorIdsPlaceholder.default')}
                  className="min-h-[88px] w-full resize-y rounded-xl border border-cyber-border-default/60 bg-cyber-bg-tertiary/20 px-4 py-3 pr-32 text-xs font-mono text-cyber-text-primary placeholder:text-cyber-text-muted focus-visible:border-cyber-neon-cyan focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyber-neon-cyan disabled:cursor-not-allowed disabled:opacity-50"
                />
                {selectedPlatforms[0] ? (
                  <span className="absolute right-3 top-3 rounded-full border border-cyber-neon-cyan/30 bg-cyber-bg-panel px-3 py-1 text-[10px] font-mono text-cyber-neon-cyan">
                    {PLATFORM_LABELS[selectedPlatforms[0]] || selectedPlatforms[0]}
                  </span>
                ) : (
                  <span className="absolute right-3 top-3 rounded-full border border-cyber-neon-orange/30 bg-cyber-bg-panel px-3 py-1 text-[10px] font-mono text-cyber-neon-orange">
                    等待识别
                  </span>
                )}
              </div>
              <ParsedIdList
                value={targetValue}
                platform={idParserPlatform}
                type={config.crawler_type === 'detail' ? 'detail' : 'creator'}
                disabled={isDisabled}
              />
              {selectedPlatforms.includes('xhs') && config.crawler_type === 'detail' && (
                <div className="rounded-lg border border-cyber-neon-orange/30 bg-cyber-neon-orange/5 p-2 text-[10px] font-mono text-cyber-neon-orange">
                  {t('warning.xhsToken')}
                </div>
              )}
            </div>
          )}

          {/* Keyword tags */}
          {config.crawler_type === 'search' && keywordsList.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {keywordsList.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyber-neon-cyan/10 border border-cyber-neon-cyan/30 text-cyber-neon-cyan text-xs font-mono font-medium shadow-glow-cyan-xs animate-fade-in"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeKeyword(tag)}
                    className="hover:text-cyber-neon-pink transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Global Controls */}
        <div className="flex gap-3">
          {isAnyRunning ? (
            <Button
              onClick={handleStopAll}
              disabled={isAnyStopping}
              className="h-12 px-8 bg-cyber-neon-pink text-white font-mono font-bold text-sm tracking-widest rounded-xl hover:bg-cyber-neon-pink/90 hover:shadow-glow-pink-sm transition-all flex items-center gap-2"
            >
              <Square className="w-4 h-4 fill-white" />
              {isAnyStopping ? '正在停止...' : '终止扫描'}
            </Button>
          ) : (
            <Button
              onClick={handleStartAll}
              disabled={selectedPlatforms.length === 0}
              className="h-12 px-8 bg-cyber-neon-cyan text-cyber-bg-primary font-mono font-bold text-sm tracking-widest rounded-xl hover:bg-cyber-neon-cyan/90 hover:shadow-glow-cyan-sm transition-all flex items-center gap-2"
            >
              <Play className="w-4 h-4 fill-cyber-bg-primary" />
              开始扫描
            </Button>
          )}
        </div>
      </div>

      {/* Only keyword search can intentionally fan out to multiple platforms. */}
      {config.crawler_type === 'search' && <div className="space-y-2.5">
        <label className="text-xs text-cyber-text-secondary font-mono tracking-wider uppercase">
          目标媒体渠道（多选）
        </label>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {platforms?.map((platform) => {
            const isSelected = selectedPlatforms.includes(platform.value);
            const isRunning = statuses[platform.value] === 'running';
            const IconComponent = ICON_MAP[platform.icon] || Globe;

            return (
              <button
                key={platform.value}
                type="button"
                onClick={() => handlePlatformToggle(platform.value)}
                className={`relative flex flex-col items-center justify-center p-2.5 rounded-xl border text-center transition-all duration-300 font-mono select-none ${
                  isSelected
                    ? 'bg-cyber-neon-cyan/5 border-cyber-neon-cyan/60 text-cyber-text-primary shadow-glow-cyan-xs'
                    : 'bg-cyber-bg-tertiary/10 border-cyber-border-subtle/50 text-cyber-text-muted hover:border-cyber-border-default/80 hover:text-cyber-text-secondary'
                }`}
              >
                {/* Active check indicator */}
                {isSelected && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-cyber-neon-cyan text-cyber-bg-primary rounded-full flex items-center justify-center text-[10px] font-bold">
                    <Check className="w-2.5 h-2.5 stroke-[3px]" />
                  </span>
                )}

                {/* Running status blinker */}
                {isRunning && (
                  <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 bg-cyber-neon-green rounded-full shadow-glow-green-sm animate-pulse-fast" />
                )}

                <IconComponent className={`w-5 h-5 mb-1.5 transition-transform duration-300 ${isSelected ? 'text-cyber-neon-cyan scale-110' : 'text-cyber-text-muted'}`} />
                <span className="text-xs font-semibold">{platform.label}</span>
                
                {/* Micro-status label */}
                {isRunning && (
                  <span className="text-[9px] text-cyber-neon-green mt-1 font-bold tracking-tighter uppercase animate-pulse">运行中</span>
                )}
              </button>
            )
          })}
        </div>
      </div>}
    </div>
  )
}
