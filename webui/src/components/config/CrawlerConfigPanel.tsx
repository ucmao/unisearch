import { useEffect, useMemo, type ComponentType, type ReactNode } from 'react'
import { Database, KeyRound, Monitor, RefreshCw, ShieldCheck } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useConnectors } from '@/hooks/useCrawler'
import { useCrawlerStore } from '@/store/crawlerStore'
import type { ConnectorCapability, ConnectorInputField, ConnectorManifest } from '@/types/crawler'

type FieldProps = { label: string; hint?: string; children: ReactNode }
const EMPTY_CONNECTOR_OPTIONS: Record<string, unknown> = {}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div>
        <Label className="text-[11px] font-mono uppercase tracking-wide text-cyber-text-secondary">{label}</Label>
        {hint ? <p className="text-[9px] leading-snug text-cyber-text-muted">{hint}</p> : null}
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

function ToggleCard({ title, description, icon: Icon, checked, disabled, onCheckedChange }: ToggleCardProps) {
  return (
    <div className={`flex min-h-[70px] items-start gap-3 rounded-lg border p-3 ${checked ? 'border-cyber-neon-cyan/45 bg-cyber-neon-cyan/5' : 'border-cyber-border-subtle/60 bg-cyber-bg-tertiary/10'} ${disabled ? 'opacity-45' : ''}`}>
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} disabled={disabled} className="mt-0.5" />
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${checked ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted'}`} />
      <div>
        <p className="text-xs font-mono font-medium text-cyber-text-primary">{title}</p>
        <p className="mt-1 text-[9px] leading-snug text-cyber-text-muted">{description}</p>
      </div>
    </div>
  )
}

function ConnectorField({
  connector,
  field,
  disabled,
}: {
  connector: ConnectorManifest
  field: ConnectorInputField
  disabled: boolean
}) {
  const storedValues = useCrawlerStore((state) => state.connectorOptions[connector.id])
  const setConnectorOption = useCrawlerStore((state) => state.setConnectorOption)
  const values = storedValues || EMPTY_CONNECTOR_OPTIONS
  const value = values[field.key] ?? field.default ?? (field.type === 'boolean' ? false : '')

  if (field.type === 'string_list') {
    return (
      <div className="rounded-lg border border-dashed border-cyber-border-subtle/60 p-3 text-[10px] text-cyber-text-muted">
        {field.label}请在页面顶部的目标输入区填写；系统会按 Connector 的规则解析。
      </div>
    )
  }
  if (field.type === 'boolean') {
    return (
      <ToggleCard
        title={field.label}
        description={field.description}
        icon={Database}
        checked={Boolean(value)}
        disabled={disabled || (field.key === 'enable_sub_comments' && !Boolean(values.enable_comments))}
        onCheckedChange={(checked) => setConnectorOption(connector.id, field.key, checked)}
      />
    )
  }
  if (field.type === 'select') {
    return (
      <Field label={field.label} hint={field.description}>
        <Select value={String(value)} onValueChange={(next) => setConnectorOption(connector.id, field.key, next)} disabled={disabled}>
          <SelectTrigger className="h-9 text-xs font-mono"><SelectValue /></SelectTrigger>
          <SelectContent>{field.options?.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    )
  }
  return (
    <Field label={field.label} hint={field.description}>
      <Input
        type={field.type === 'number' ? 'number' : field.type === 'secret' ? 'password' : 'text'}
        min={field.min}
        max={field.max}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => setConnectorOption(connector.id, field.key, field.type === 'number' ? Number(event.target.value) : event.target.value)}
        className="h-9 text-xs font-mono"
      />
    </Field>
  )
}

function capabilityIntersection(connectors: ConnectorManifest[]): ConnectorCapability[] {
  if (!connectors.length) return []
  return connectors[0].capabilities.filter((capability) =>
    connectors.every((connector) => connector.capabilities.some((candidate) => candidate.id === capability.id)),
  )
}

export function CrawlerConfigPanel() {
  const config = useCrawlerStore((state) => state.config)
  const updateConfig = useCrawlerStore((state) => state.updateConfig)
  const statuses = useCrawlerStore((state) => state.statuses)
  const selectedPlatforms = useCrawlerStore((state) => state.selectedPlatforms)
  const platformCookies = useCrawlerStore((state) => state.platformCookies)
  const setPlatformCookie = useCrawlerStore((state) => state.setPlatformCookie)
  const { data: allConnectors = [] } = useConnectors()
  const selectedConnectors = useMemo(
    () => selectedPlatforms.map((id) => allConnectors.find((connector) => connector.id === id)).filter((connector): connector is ConnectorManifest => Boolean(connector)),
    [allConnectors, selectedPlatforms],
  )
  const capabilities = useMemo(() => capabilityIntersection(selectedConnectors), [selectedConnectors])
  const selectedCapability = capabilities.find((capability) => capability.id === config.capability) || capabilities[0]
  const isDisabled = Object.values(statuses).some((status) => status === 'running' || status === 'stopping')

  useEffect(() => {
    if (!selectedCapability || config.capability === selectedCapability.id) return
    updateConfig({ capability: selectedCapability.id, crawler_type: selectedCapability.runtimeMode })
  }, [config.capability, selectedCapability, updateConfig])

  const loginMethods = selectedConnectors.length
    ? selectedConnectors[0].auth.methods.filter((method) => selectedConnectors.every((connector) => connector.auth.methods.includes(method)))
    : []

  return (
    <aside className="relative min-w-0 overflow-hidden rounded-xl border border-cyber-border-subtle bg-cyber-bg-panel/35 p-4 glass-panel float-panel xl:h-full xl:overflow-y-auto">
      <div className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-cyber-neon-purple via-cyber-neon-cyan to-transparent" />
      <Tabs defaultValue="connector" className="space-y-3">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyber-neon-purple/30 bg-cyber-neon-purple/10">
              <ShieldCheck className="h-4 w-4 text-cyber-neon-purple" />
            </div>
            <div>
              <h2 className="text-xs font-mono font-semibold uppercase tracking-[0.16em] text-cyber-text-primary">Connector 任务配置</h2>
              <p className="mt-1 text-[10px] text-cyber-text-muted">参数、输出与边界由各平台 Manifest 提供</p>
            </div>
          </div>
          <TabsList className="grid h-9 w-full grid-cols-3 bg-cyber-bg-tertiary/60 p-0.5">
            <TabsTrigger value="connector" className="text-[11px]">平台能力</TabsTrigger>
            <TabsTrigger value="auth" className="text-[11px]">登录配置</TabsTrigger>
            <TabsTrigger value="advanced" className="text-[11px]">高级设置</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="connector" className="mt-0 space-y-3">
          {selectedConnectors.length ? (
            <>
              <Field label="执行能力" hint="多平台任务只展示所有已选 Connector 共同支持的能力">
                <Select
                  value={selectedCapability?.id || ''}
                  disabled={isDisabled || !capabilities.length}
                  onValueChange={(id) => {
                    const capability = capabilities.find((item) => item.id === id)
                    if (capability) updateConfig({ capability: capability.id, crawler_type: capability.runtimeMode })
                  }}
                >
                  <SelectTrigger className="h-9 text-xs font-mono"><SelectValue placeholder="无共同能力" /></SelectTrigger>
                  <SelectContent>{capabilities.map((capability) => <SelectItem key={capability.id} value={capability.id}>{capability.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>

              {selectedConnectors.map((connector) => {
                const capability = connector.capabilities.find((item) => item.id === selectedCapability?.id)
                if (!capability) return null
                return (
                  <section key={connector.id} className="space-y-3 rounded-lg border border-cyber-border-subtle/60 bg-cyber-bg-tertiary/10 p-3">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-mono font-medium text-cyber-text-primary">{connector.name} · {capability.label}</h3>
                        <span className="text-[9px] font-mono text-cyber-neon-cyan">v{connector.version}</span>
                      </div>
                      <p className="mt-1 text-[9px] text-cyber-text-muted">{capability.description}</p>
                    </div>
                    {capability.inputFields.map((field) => <ConnectorField key={field.key} connector={connector} field={field} disabled={isDisabled} />)}
                    <div className="rounded-md bg-cyber-bg-primary/35 p-2">
                      <p className="text-[9px] font-mono text-cyber-text-secondary">输出 · {capability.outputType}</p>
                      <p className="mt-1 text-[9px] leading-relaxed text-cyber-text-muted">{capability.outputFields.map((field) => field.label).join('、')}</p>
                    </div>
                    {capability.limitations.map((limit) => <p key={limit} className="text-[9px] leading-snug text-cyber-neon-orange">• {limit}</p>)}
                  </section>
                )
              })}
            </>
          ) : <p className="rounded-lg border border-dashed border-cyber-border-subtle p-4 text-center text-[10px] text-cyber-text-muted">请先选择平台</p>}
        </TabsContent>

        <TabsContent value="auth" className="mt-0 space-y-3">
          <Field label="登录方式" hint="仅展示所有已选 Connector 共同支持的方式">
            <Select value={config.login_type} onValueChange={(value) => updateConfig({ login_type: value })} disabled={isDisabled || !loginMethods.length}>
              <SelectTrigger className="h-9 text-xs font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                {loginMethods.map((method) => <SelectItem key={method} value={method}>{method === 'cookie' ? 'Cookie 登录' : '二维码登录'}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {config.login_type === 'cookie' ? selectedConnectors.map((connector) => (
            <Field key={connector.id} label={`${connector.name} Cookie`} hint={connector.auth.description}>
              <textarea
                value={platformCookies[connector.id] || ''}
                onChange={(event) => setPlatformCookie(connector.id, event.target.value)}
                disabled={isDisabled}
                className="min-h-[72px] w-full resize-y rounded-md border border-cyber-border-default bg-cyber-bg-tertiary/20 px-3 py-2 text-[10px] font-mono text-cyber-text-primary focus-visible:border-cyber-neon-cyan/50 focus-visible:outline-none"
              />
            </Field>
          )) : (
            <div className="flex items-center gap-3 rounded-lg border border-dashed border-cyber-border-subtle/50 p-4">
              <KeyRound className="h-5 w-5 text-cyber-neon-cyan/70" />
              <p className="text-[10px] text-cyber-text-muted">每个 Connector 使用独立浏览器会话完成二维码登录。</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="advanced" className="mt-0 space-y-3">
          <ToggleCard title="无头浏览器" description="后台运行浏览器；登录或验证码阶段建议关闭" icon={Monitor} checked={config.headless} disabled={isDisabled} onCheckedChange={(headless) => updateConfig({ headless })} />
          <ToggleCard title="循环执行" description="一轮结束后等待并重新执行，用于持续监测" icon={RefreshCw} checked={config.loop_execution} disabled={isDisabled} onCheckedChange={(loop_execution) => updateConfig({ loop_execution })} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
