import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Check, Database, Eye, EyeOff, Gauge, KeyRound, Loader2, Monitor, Moon, Palette, Pencil, RefreshCw, Settings2, Sun, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { agentApi, dataApi, type AgentMemory, type MemorySettings, type ModelProfile, type RuntimeSettings } from '@/lib/api'
import { useThemeStore } from '@/store/themeStore'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'

type Theme = 'light' | 'dark' | 'system'
export type SettingsSection = 'appearance' | 'models' | 'collection' | 'storage' | 'memory'
type ModelForm = Partial<ModelProfile> & { apiKey?: string; clearApiKey?: boolean }

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const MODEL_PROVIDER_DEFAULTS = {
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'DeepSeek-V4-Flash' },
  custom: { baseUrl: '', model: '' },
} satisfies Record<ModelProfile['provider'], { baseUrl: string; model: string }>

const sections: { value: SettingsSection; label: string; description: string; icon: typeof Palette }[] = [
  { value: 'appearance', label: '外观', description: '主题与显示', icon: Palette },
  { value: 'models', label: '模型', description: 'AI 服务与凭证', icon: KeyRound },
  { value: 'collection', label: '采集', description: '并发与资源', icon: Gauge },
  { value: 'storage', label: '存储', description: '看板数据清理', icon: Database },
  { value: 'memory', label: '记忆', description: '长期偏好与背景', icon: Brain },
]

const memoryCategoryLabels: Record<AgentMemory['category'], string> = {
  identity: '身份', preference: '偏好', context: '背景', rule: '规则',
}

function getError(error: any) {
  return error?.response?.data?.detail || error?.message || '操作失败'
}

function SettingToggle({ checked, disabled = false, onChange }: { checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-cyber-neon-cyan' : 'bg-cyber-bg-tertiary'} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
      <span className="sr-only">{checked ? '已开启' : '已关闭'}</span>
    </button>
  )
}

export function SettingsDialog({
  compact = false,
  open,
  onOpenChange,
  initialSection = 'appearance',
}: {
  compact?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  initialSection?: SettingsSection
}) {
  const queryClient = useQueryClient()
  const { theme, setTheme } = useThemeStore()
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)
  const [form, setForm] = useState<ModelForm>({})
  const [showApiKey, setShowApiKey] = useState(false)
  const [editMemoryId, setEditMemoryId] = useState<string | null>(null)
  const [editMemoryContent, setEditMemoryContent] = useState('')
  const providerDrafts = useRef<Partial<Record<ModelProfile['provider'], ModelForm>>>({})
  const dialogOpen = open ?? internalOpen

  const setDialogOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  useEffect(() => {
    if (dialogOpen) setActiveSection(initialSection)
  }, [dialogOpen, initialSection])

  const profilesQuery = useQuery({
    queryKey: ['agent-model-profiles'],
    queryFn: async () => (await agentApi.getModelProfiles()).data,
    enabled: dialogOpen && activeSection === 'models',
  })
  const memorySettingsQuery = useQuery({
    queryKey: ['agent-memory-settings'],
    queryFn: async () => (await agentApi.getMemorySettings()).data,
    enabled: dialogOpen && activeSection === 'memory',
  })
  const runtimeSettingsQuery = useQuery({
    queryKey: ['agent-runtime-settings'],
    queryFn: async () => (await agentApi.getRuntimeSettings()).data,
    enabled: dialogOpen && activeSection === 'collection',
  })
  const memoriesQuery = useQuery({
    queryKey: ['agent-memories'],
    queryFn: async () => (await agentApi.listMemories()).data.items,
    enabled: dialogOpen && activeSection === 'memory',
  })
  const storageQuery = useQuery({
    queryKey: ['storage-summary'],
    queryFn: async () => (await dataApi.getStorageSummary()).data,
    enabled: dialogOpen && activeSection === 'storage',
  })

  useEffect(() => {
    if (profilesQuery.data) {
      const drafts: Partial<Record<ModelProfile['provider'], ModelForm>> = {}
      for (const profile of profilesQuery.data.profiles) {
        drafts[profile.provider] = { ...profile, apiKey: profile.apiKey || '', clearApiKey: false }
      }
      providerDrafts.current = drafts
      setForm(drafts[profilesQuery.data.activeProvider] || {})
    }
  }, [profilesQuery.data])

  const save = useMutation({
    mutationFn: () => agentApi.saveModelProfile(form),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['agent-model-profile'], data)
      queryClient.invalidateQueries({ queryKey: ['agent-model-profiles'] })
      setForm({ ...data, apiKey: data.apiKey || '', clearApiKey: false })
      toast.success('模型配置已保存在本机')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const test = useMutation({
    mutationFn: async () => {
      await agentApi.saveModelProfile(form)
      return (await agentApi.testModelProfile()).data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-model-profile'] })
      queryClient.invalidateQueries({ queryKey: ['agent-model-profiles'] })
      toast.success(`${data.message} · ${data.latency_ms}ms`)
    },
    onError: (error) => toast.error(`连接失败：${getError(error)}`),
  })
  const saveMemorySettings = useMutation({
    mutationFn: (patch: Partial<MemorySettings>) => agentApi.saveMemorySettings(patch),
    onSuccess: ({ data }) => queryClient.setQueryData(['agent-memory-settings'], data),
    onError: (error) => toast.error(getError(error)),
  })
  const saveRuntimeSettings = useMutation({
    mutationFn: (patch: Partial<RuntimeSettings>) => agentApi.saveRuntimeSettings(patch),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['agent-runtime-settings'], data)
      toast.success('采集并发设置已保存')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const updateMemory = useMutation({
    mutationFn: ({ memoryId, patch }: { memoryId: string; patch: { content?: string; status?: AgentMemory['status'] } }) => agentApi.updateMemory(memoryId, patch),
    onSuccess: () => {
      setEditMemoryId(null)
      queryClient.invalidateQueries({ queryKey: ['agent-memories'] })
    },
    onError: (error) => toast.error(getError(error)),
  })
  const deleteMemory = useMutation({
    mutationFn: (memoryId: string) => agentApi.deleteMemory(memoryId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-memories'] }),
    onError: (error) => toast.error(getError(error)),
  })
  const clearMemories = useMutation({
    mutationFn: () => agentApi.clearMemories(),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['agent-memories'], [])
      toast.success(`已清除 ${data.deleted} 条记忆`)
    },
    onError: (error) => toast.error(getError(error)),
  })
  const cleanupStorage = useMutation({
    mutationFn: (mode: 'failed_empty' | 'older_than_30_days' | 'all') => dataApi.cleanupStorage(mode),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-contents'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-comments'] })
      toast.success(`已清理 ${data.deleted} 个看板执行记录`)
    },
    onError: (error) => toast.error(getError(error)),
  })

  const applyProvider = (provider: ModelProfile['provider']) => {
    setForm((current) => {
      if (current.provider) {
        providerDrafts.current[current.provider] = { ...current }
      }
      const providerValues = providerDrafts.current[provider]
      return providerValues || {
        provider,
        ...MODEL_PROVIDER_DEFAULTS[provider],
        temperature: current.temperature ?? 0.2,
        timeoutMs: current.timeoutMs ?? 120000,
        apiKey: '',
        apiKeyConfigured: false,
        connectionVerified: false,
        lastError: '',
        clearApiKey: false,
      }
    })
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-10 w-full text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary ${compact ? 'justify-center px-0' : 'justify-start gap-3 px-3'}`}
          title="设置"
          onClick={() => setActiveSection('appearance')}
        >
          <Settings2 className="h-4 w-4" />
          {!compact && <span className="text-sm">设置</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="h-[min(600px,calc(100vh-2rem))] w-[min(840px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden bg-cyber-bg-panel p-0 sm:rounded-2xl">
        <div className="flex h-full min-h-0">
          <aside className="w-44 shrink-0 border-r border-cyber-border-subtle bg-cyber-bg-secondary/75 p-3 sm:w-48 sm:p-4">
            <div className="mb-5 px-2 pt-1">
              <p className="text-base font-semibold text-cyber-text-primary">设置</p>
              <p className="mt-1 hidden text-xs text-cyber-text-muted sm:block">调整 UniSearch 使用偏好</p>
            </div>
            <nav className="space-y-1" aria-label="设置分类">
              {sections.map(({ value, label, description, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveSection(value)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${activeSection === value ? 'bg-cyber-bg-tertiary text-cyber-text-primary' : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary/60 hover:text-cyber-text-primary'}`}
                  aria-current={activeSection === value ? 'page' : undefined}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${activeSection === value ? 'text-cyber-neon-cyan' : ''}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="hidden truncate text-[10px] text-cyber-text-muted sm:block">{description}</span>
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          <section className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-7">
            {activeSection === 'appearance' ? (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">外观</DialogTitle>
                  <DialogDescription>选择最适合当前环境的界面显示方式。</DialogDescription>
                </DialogHeader>
                <div className="mt-7 flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                  <div>
                    <div className="text-sm font-medium text-cyber-text-primary">外观主题</div>
                    <div className="mt-1 text-xs text-cyber-text-muted">切换浅色、深色，或自动跟随系统</div>
                  </div>
                  <Select value={theme} onValueChange={(value: Theme) => setTheme(value)}>
                    <SelectTrigger className="h-9 w-32 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {themes.map(({ value, label, icon: Icon }) => (
                        <SelectItem key={value} value={value} className="text-xs">
                          <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{label}</div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : activeSection === 'models' ? (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">模型</DialogTitle>
                  <DialogDescription>配置 AI 服务、模型和本机凭证。采集数据只会在发起 AI 分析时发送。</DialogDescription>
                </DialogHeader>
                {profilesQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取模型配置…</div>
                ) : (
                  <div className="mt-7 space-y-5">
                    {form.lastError ? <p className="rounded-lg border border-cyber-neon-pink/30 bg-cyber-neon-pink/10 px-3 py-2 text-xs text-cyber-neon-pink">最近一次模型调用失败：{form.lastError}</p> : null}
                    <div>
                      <p className="mb-2 text-xs font-medium text-cyber-text-secondary">服务提供商</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {(['minimax', 'deepseek', 'custom'] as const).map((provider) => (
                          <button key={provider} type="button" onClick={() => applyProvider(provider)}
                            className={`rounded-lg border px-3 py-2.5 text-xs transition-colors ${form.provider === provider ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'border-cyber-border-subtle text-cyber-text-secondary hover:border-cyber-border-default hover:bg-cyber-bg-secondary/50'}`}>
                            {provider === 'minimax' ? 'MiniMax' : provider === 'deepseek' ? 'DeepSeek' : '自定义兼容接口'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-xs text-cyber-text-secondary">API Base URL</span>
                      <Input value={form.baseUrl || ''} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs text-cyber-text-secondary">模型名称</span>
                      <Input value={form.model || ''} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="模型 ID" />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="flex items-center justify-between text-xs text-cyber-text-secondary">
                        <span>API Key</span>
                        {form.apiKeyConfigured ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            已配置
                          </span>
                        ) : null}
                      </span>
                      <div className="relative flex items-center">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={form.apiKey || ''}
                          onChange={(event) => setForm({ ...form, apiKey: event.target.value, clearApiKey: false })}
                          placeholder="填写 API Key"
                          className={form.apiKey ? 'pr-9' : ''}
                        />
                        {form.apiKey ? (
                          <button
                            type="button"
                            title={showApiKey ? '隐藏 Key' : '显示 Key'}
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2.5 rounded-md p-1 text-cyber-text-muted transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"
                          >
                            {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        ) : null}
                      </div>
                    </label>
                    <DialogFooter className="gap-2 border-t border-cyber-border-subtle pt-5 sm:space-x-0">
                      <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || save.isPending}>
                        {test.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}测试连接
                      </Button>
                      <Button onClick={() => save.mutate()} disabled={save.isPending || test.isPending}>
                        {save.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}保存配置
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </div>
            ) : activeSection === 'collection' ? (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">采集</DialogTitle>
                  <DialogDescription>控制整个应用同时运行的平台采集数量。</DialogDescription>
                </DialogHeader>
                {runtimeSettingsQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取采集设置…</div>
                ) : runtimeSettingsQuery.data ? (
                  <div className="mt-7 flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                    <div>
                      <div className="text-sm font-medium text-cyber-text-primary">全局平台并发数</div>
                      <div className="mt-1 text-xs leading-5 text-cyber-text-muted">所有任务合计最多同时采集的平台数。默认 3，设备性能充足时可提高到 5。</div>
                    </div>
                    <Select
                      value={String(runtimeSettingsQuery.data.maxConcurrentCrawlers)}
                      onValueChange={(value) => saveRuntimeSettings.mutate({ maxConcurrentCrawlers: Number(value) })}
                      disabled={saveRuntimeSettings.isPending}
                    >
                      <SelectTrigger className="h-9 w-28 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs" aria-label="全局平台并发数">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)} className="text-xs">{value} 个平台</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
            ) : activeSection === 'storage' ? (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">存储管理</DialogTitle>
                  <DialogDescription>清理执行历史和看板分析数据。平台原始采集数据不会在这里删除。</DialogDescription>
                </DialogHeader>
                {storageQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在统计本地数据…</div>
                ) : storageQuery.data ? (
                  <div className="mt-7 space-y-5">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {[
                        ['执行记录', storageQuery.data.analytics_runs],
                        ['看板内容', storageQuery.data.analytics_records],
                        ['执行日志', storageQuery.data.log_records],
                        ['平台原始数据', storageQuery.data.raw_records],
                      ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 p-4"><p className="text-[10px] text-cyber-text-muted">{label}</p><p className="mt-1 text-xl font-semibold text-cyber-text-primary">{Number(value || 0).toLocaleString('zh-CN')}</p></div>)}
                    </div>
                    <div className="divide-y divide-cyber-border-subtle rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 px-4">
                      {[
                        { mode: 'failed_empty' as const, title: '清理失败或空结果执行', detail: '移除失败以及没有采集到内容的看板记录。', confirm: '清理失败或空结果执行？' },
                        { mode: 'older_than_30_days' as const, title: '清理30天前执行历史', detail: '移除30天前的执行记录、看板内容和日志。', confirm: '清理30天前的执行历史？' },
                        { mode: 'all' as const, title: '清空看板历史', detail: '清空全部非运行中的看板执行历史。', confirm: '清空全部看板历史？' },
                      ].map((item) => <div key={item.mode} className="flex items-center justify-between gap-5 py-4"><div><p className="text-sm font-medium text-cyber-text-primary">{item.title}</p><p className="mt-1 text-xs text-cyber-text-muted">{item.detail}</p></div><DeleteConfirmDialog
                        trigger={<Button size="sm" variant={item.mode === 'all' ? 'destructive' : 'outline'} disabled={cleanupStorage.isPending}>清理</Button>}
                        title={item.confirm}
                        description="对应看板分析数据和执行日志会一并删除，工作区任务与平台原始数据保持不变。"
                        confirmLabel="确认清理"
                        onConfirm={() => cleanupStorage.mutateAsync(item.mode)}
                      /></div>)}
                    </div>
                    <p className="rounded-lg border border-cyber-neon-cyan/20 bg-cyber-neon-cyan/5 px-3 py-2 text-xs leading-5 text-cyber-text-muted">平台原始数据可能被多个任务共同引用。在建立完整的数据来源关系前，不提供按任务物理删除，避免误删其他任务仍需的数据。</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">记忆</DialogTitle>
                  <DialogDescription>配置 UniSearch 如何收集、保留和整合记忆。记忆保存在本机。</DialogDescription>
                </DialogHeader>
                {memorySettingsQuery.isLoading || memoriesQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取记忆…</div>
                ) : memorySettingsQuery.data ? (
                  <div className="mt-6 space-y-6">
                    <div className="divide-y divide-cyber-border-subtle rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 px-4">
                      <div className="flex items-center justify-between gap-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-cyber-text-primary">启用记忆</p>
                          <p className="mt-0.5 text-xs text-cyber-text-muted">从对话与任务中自动提取新记忆，并将其带入新对话</p>
                        </div>
                        <SettingToggle checked={memorySettingsQuery.data.enabled} onChange={(enabled) => saveMemorySettings.mutate({ enabled })} />
                      </div>
                      <div className="flex items-center justify-between gap-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-cyber-text-primary">允许从采集与分析任务生成记忆</p>
                          <p className="mt-0.5 text-xs text-cyber-text-muted">根据使用了网页采集、数据检索或工具辅助的任务生成记忆</p>
                        </div>
                        <SettingToggle disabled={!memorySettingsQuery.data.enabled} checked={memorySettingsQuery.data.autoCapture} onChange={(autoCapture) => saveMemorySettings.mutate({ autoCapture })} />
                      </div>
                      <div className="flex items-center justify-between gap-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-cyber-text-primary">重置记忆</p>
                          <p className="mt-0.5 text-xs text-cyber-text-muted">删除所有已保存的 UniSearch 记忆</p>
                        </div>
                        {memoriesQuery.data?.length ? (
                          <DeleteConfirmDialog
                            trigger={<Button size="sm" variant="destructive" className="h-8 border border-cyber-neon-pink/30 bg-cyber-neon-pink/10 text-cyber-neon-pink hover:bg-cyber-neon-pink/20" disabled={clearMemories.isPending}>重置</Button>}
                            title="重置全部记忆？"
                            description="所有已保存的偏好和背景记忆都将被删除，此操作无法撤销。"
                            confirmLabel="确认重置"
                            onConfirm={() => clearMemories.mutateAsync()}
                          />
                        ) : (
                          <Button size="sm" variant="ghost" disabled className="h-8 opacity-40">重置</Button>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-cyber-text-primary">已保存的记忆</p>
                          <p className="mt-0.5 text-xs text-cyber-text-muted">共 {memoriesQuery.data?.length || 0} 条记忆</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {!memoriesQuery.data?.length ? (
                          <div className="rounded-xl border border-dashed border-cyber-border-default px-4 py-8 text-center text-xs text-cyber-text-muted">
                            暂无记忆。在与 AI 对话时提及你的称呼、习惯或偏好，AI 会自动智能记住。
                          </div>
                        ) : null}
                        {memoriesQuery.data?.map((memory) => (
                          <div key={memory.memory_id} className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-3.5 transition-colors hover:border-cyber-border-default">
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="mb-1.5 flex items-center gap-2">
                                  <span className="rounded bg-cyber-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-cyber-text-secondary">
                                    {memoryCategoryLabels[memory.category] || '记忆'}
                                  </span>
                                  {memory.status === 'candidate' ? <span className="text-[10px] text-cyber-neon-orange">待验证</span> : null}
                                </div>
                                {editMemoryId === memory.memory_id ? (
                                  <Input autoFocus value={editMemoryContent} onChange={(event) => setEditMemoryContent(event.target.value)} className="h-8 text-xs" />
                                ) : (
                                  <p className="text-xs leading-relaxed text-cyber-text-primary">{memory.content}</p>
                                )}
                                <p className="mt-1.5 text-[10px] text-cyber-text-muted">
                                  更新于 {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(memory.updated_at))}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {editMemoryId === memory.memory_id ? (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-cyber-neon-cyan" disabled={!editMemoryContent.trim() || updateMemory.isPending} onClick={() => updateMemory.mutate({ memoryId: memory.memory_id, patch: { content: editMemoryContent } })} title="保存"><Check className="h-3.5 w-3.5" /></Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditMemoryId(null)} title="取消"><X className="h-3.5 w-3.5" /></Button>
                                  </>
                                ) : (
                                  <>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-cyber-text-secondary hover:text-cyber-text-primary" onClick={() => { setEditMemoryId(memory.memory_id); setEditMemoryContent(memory.content) }} title="编辑"><Pencil className="h-3.5 w-3.5" /></Button>
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-cyber-text-secondary hover:text-cyber-neon-pink" disabled={deleteMemory.isPending} onClick={() => deleteMemory.mutate(memory.memory_id)} title="删除"><Trash2 className="h-3.5 w-3.5" /></Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
