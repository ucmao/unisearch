import type { ComponentType, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Database,
  KeyRound,
  Layers3,
  MessageSquare,
  Monitor,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useCrawlerStore } from '@/store/crawlerStore'
import { useConfigOptions } from '@/hooks/useCrawler'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: '哔哩哔哩',
  wb: '微博',
  tieba: '百度贴吧',
  zhihu: '知乎',
}

type FieldProps = {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}

function Field({ label, hint, children, className = '' }: FieldProps) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="min-h-8">
        <Label className="text-[11px] text-cyber-text-secondary font-mono uppercase tracking-wide">
          {label}
        </Label>
        {hint ? <p className="text-[9px] text-cyber-text-muted leading-snug">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

type ToggleCardProps = {
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}

type BrowserModeCardProps = {
  headless: boolean
  disabled: boolean
  onModeChange: (headless: boolean) => void
}

function BrowserModeCard({ headless, disabled, onModeChange }: BrowserModeCardProps) {
  const { t } = useTranslation('config')

  return (
    <div
      className={`min-h-[74px] rounded-lg border border-cyber-border-subtle/60 bg-cyber-bg-tertiary/10 p-3 transition-colors ${
        disabled ? 'opacity-45' : 'hover:border-cyber-border-default'
      }`}
    >
      <div className="flex items-start gap-3">
        <Monitor className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyber-neon-cyan" />
        <div className="min-w-0">
          <p className="text-xs font-mono font-medium text-cyber-text-primary">
            {t('field.browserMode')}
          </p>
          <p className="mt-1 text-[9px] leading-snug text-cyber-text-muted">
            {t('field.browserModeHint')}
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-cyber-bg-primary/50 p-1">
        <button
          type="button"
          aria-pressed={!headless}
          disabled={disabled}
          onClick={() => onModeChange(false)}
          className={`rounded px-2 py-1.5 text-[10px] font-mono transition-colors ${
            !headless
              ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan ring-1 ring-cyber-neon-cyan/35'
              : 'text-cyber-text-muted hover:text-cyber-text-secondary'
          } disabled:cursor-not-allowed`}
        >
          {t('field.headfulMode')}
        </button>
        <button
          type="button"
          aria-pressed={headless}
          disabled={disabled}
          onClick={() => onModeChange(true)}
          className={`rounded px-2 py-1.5 text-[10px] font-mono transition-colors ${
            headless
              ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan ring-1 ring-cyber-neon-cyan/35'
              : 'text-cyber-text-muted hover:text-cyber-text-secondary'
          } disabled:cursor-not-allowed`}
        >
          {t('field.headlessMode')}
        </button>
      </div>
    </div>
  )
}

function ToggleCard({
  title,
  description,
  icon: Icon,
  checked,
  disabled,
  onCheckedChange,
}: ToggleCardProps) {
  return (
    <div
      className={`flex min-h-[74px] items-start gap-3 rounded-lg border p-3 transition-colors ${
        checked
          ? 'border-cyber-neon-cyan/45 bg-cyber-neon-cyan/5'
          : 'border-cyber-border-subtle/60 bg-cyber-bg-tertiary/10'
      } ${disabled ? 'opacity-45' : 'hover:border-cyber-border-default'}`}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        className="mt-0.5"
      />
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${checked ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted'}`} />
      <div className="min-w-0">
        <p className="text-xs font-mono font-medium text-cyber-text-primary">{title}</p>
        <p className="mt-1 text-[9px] leading-snug text-cyber-text-muted">{description}</p>
      </div>
    </div>
  )
}

export function CrawlerConfigPanel() {
  const { t } = useTranslation('config')
  const config = useCrawlerStore((state) => state.config)
  const updateConfig = useCrawlerStore((state) => state.updateConfig)
  const statuses = useCrawlerStore((state) => state.statuses)
  const selectedPlatforms = useCrawlerStore((state) => state.selectedPlatforms)
  const platformCookies = useCrawlerStore((state) => state.platformCookies)
  const setPlatformCookie = useCrawlerStore((state) => state.setPlatformCookie)
  const { data: options } = useConfigOptions()

  const isDisabled = Object.values(statuses).some((status) => status === 'running' || status === 'stopping')

  return (
    <aside className="relative min-w-0 overflow-hidden rounded-xl border border-cyber-border-subtle bg-cyber-bg-panel/35 p-4 glass-panel float-panel xl:h-full xl:overflow-y-auto">
      <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-cyber-neon-purple via-cyber-neon-cyan to-transparent" />

      <Tabs defaultValue="execution" className="space-y-3">
        <div className="flex flex-col gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-cyber-neon-purple/30 bg-cyber-neon-purple/10">
              <ShieldCheck className="h-4 w-4 text-cyber-neon-purple" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.16em] text-cyber-text-primary">
                  统一采集参数
                </h2>
                <span className="rounded-full border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/5 px-2 py-0.5 text-[9px] font-mono text-cyber-neon-cyan">
                  {config.crawler_type === 'search'
                    ? `应用于 ${selectedPlatforms.length} 个已选平台`
                    : selectedPlatforms.length > 0 ? '已自动识别平台' : '等待识别平台'}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-cyber-text-muted">
                左侧设置采集方式，右侧填写目标并查看实时日志
              </p>
            </div>
          </div>

          <TabsList className="grid h-9 w-full grid-cols-3 bg-cyber-bg-tertiary/60 p-0.5">
            <TabsTrigger value="execution" className="text-[11px]">运行设置</TabsTrigger>
            <TabsTrigger value="auth" className="text-[11px]">登录配置</TabsTrigger>
            <TabsTrigger value="extraction" className="text-[11px]">采集范围</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="execution" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Field label={t('field.crawlType')} hint="统一决定所有平台的目标类型">
              <Select
                value={config.crawler_type}
                onValueChange={(value) => updateConfig({ crawler_type: value })}
                disabled={isDisabled}
              >
                <SelectTrigger className="h-9 text-xs font-mono">
                  <SelectValue placeholder={t('field.crawlTypePlaceholder')} />
                </SelectTrigger>
                <SelectContent className="font-mono text-xs">
                  {options?.crawler_types.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {config.crawler_type === 'search' && (
              <Field label={t('field.startPage')} hint="所有平台从相同页码开始">
                <Input
                  type="number"
                  min={1}
                  value={config.start_page}
                  onChange={(event) => updateConfig({ start_page: parseInt(event.target.value) || 1 })}
                  disabled={isDisabled}
                  className="h-9 text-xs font-mono"
                />
              </Field>
            )}

            <BrowserModeCard
              headless={config.headless}
              disabled={isDisabled}
              onModeChange={(headless) => updateConfig({ headless })}
            />
            <ToggleCard
              title="循环执行"
              description="一轮结束后自动等待并重新执行"
              icon={RefreshCw}
              checked={config.loop_execution}
              disabled={isDisabled}
              onCheckedChange={(checked) => updateConfig({ loop_execution: checked })}
            />

            <div className="hidden items-center gap-3 rounded-lg border border-dashed border-cyber-border-subtle/50 bg-cyber-bg-tertiary/5 px-4 sm:flex xl:hidden">
              <Layers3 className="h-5 w-5 text-cyber-neon-cyan/70" />
              <div>
                <p className="text-[10px] font-mono text-cyber-text-secondary">一致性任务</p>
                <p className="text-[9px] text-cyber-text-muted">每个平台独立运行，共享本组参数与关键词</p>
              </div>
            </div>

          </div>
        </TabsContent>

        <TabsContent value="auth" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
          <div className="grid grid-cols-1 gap-3">
            <Field label={t('field.loginMethod')} hint="统一选择登录方式，各平台仍会建立独立登录会话">
              <Select
                value={config.login_type}
                onValueChange={(value) => updateConfig({ login_type: value })}
                disabled={isDisabled}
              >
                <SelectTrigger className="h-9 text-xs font-mono">
                  <SelectValue placeholder={t('field.loginMethodPlaceholder')} />
                </SelectTrigger>
                <SelectContent className="font-mono text-xs">
                  {options?.login_types.map((type) => (
                    <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {config.login_type === 'cookie' ? (
              <div className="space-y-3">
                <div>
                  <Label className="text-[11px] font-mono uppercase tracking-wide text-cyber-text-secondary">平台 Cookies</Label>
                  <p className="text-[9px] leading-snug text-cyber-text-muted">每个平台使用自己的 Cookie；仅保存在当前页面内存中。</p>
                </div>
                {selectedPlatforms.length > 0 ? selectedPlatforms.map((platform) => (
                  <div key={platform} className="space-y-1.5 rounded-lg border border-cyber-border-subtle/60 bg-cyber-bg-tertiary/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-medium text-cyber-text-primary">
                        {PLATFORM_LABELS[platform] || platform}
                      </span>
                      <span className={`text-[9px] font-mono ${platformCookies[platform]?.trim() ? 'text-cyber-neon-green' : 'text-cyber-neon-orange'}`}>
                        {platformCookies[platform]?.trim() ? '已填写' : '待填写'}
                      </span>
                    </div>
                    <textarea
                      value={platformCookies[platform] || ''}
                      onChange={(event) => setPlatformCookie(platform, event.target.value)}
                      disabled={isDisabled}
                      placeholder={`${PLATFORM_LABELS[platform] || platform} Cookie`}
                      className="min-h-[72px] w-full resize-y rounded-md border border-cyber-border-default bg-cyber-bg-tertiary/20 px-3 py-2 text-[10px] font-mono text-cyber-text-primary placeholder:text-cyber-text-muted focus-visible:border-cyber-neon-cyan/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </div>
                )) : (
                  <div className="rounded-lg border border-dashed border-cyber-border-subtle px-3 py-4 text-center text-[10px] text-cyber-text-muted">
                    请先选择平台或填写可识别的平台链接
                  </div>
                )}
              </div>
            ) : (
              <div className="flex min-h-[72px] items-center gap-3 rounded-lg border border-dashed border-cyber-border-subtle/50 bg-cyber-bg-tertiary/5 px-4">
                <KeyRound className="h-5 w-5 text-cyber-neon-cyan/70" />
                <p className="text-[10px] text-cyber-text-muted">启动后，各平台会独立完成二维码登录或复用已保存的登录状态。</p>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="extraction" className="mt-0 focus-visible:ring-0 focus-visible:ring-offset-0">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <ToggleCard
              title={t('field.commentExtraction')}
              description="默认关闭；开启后抓取一级评论"
              icon={MessageSquare}
              checked={config.enable_comments}
              disabled={isDisabled}
              onCheckedChange={(checked) => updateConfig({
                enable_comments: checked,
                enable_sub_comments: checked ? config.enable_sub_comments : false,
              })}
            />
            <ToggleCard
              title={t('field.subComments')}
              description="仅在评论抓取开启时可用"
              icon={Database}
              checked={config.enable_sub_comments}
              disabled={isDisabled || !config.enable_comments}
              onCheckedChange={(checked) => updateConfig({ enable_sub_comments: checked })}
            />
          </div>
        </TabsContent>
      </Tabs>
    </aside>
  )
}
