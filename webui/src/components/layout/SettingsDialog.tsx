import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Check, Database, Eye, EyeOff, Gauge, KeyRound, Loader2, MessageSquare, Monitor, Moon, Palette, Pencil, Plus, RefreshCw, Settings2, Sun, Trash2, X } from 'lucide-react'
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
import { agentApi, configApi, dataApi, type AgentMemory, type MemorySettings, type ModelProfile, type RuntimeSettings } from '@/lib/api'
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
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7-highspeed' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  custom: { baseUrl: '', model: '' },
} satisfies Record<ModelProfile['provider'], { baseUrl: string; model: string }>

const sections: { value: SettingsSection; label: string; description: string; icon: typeof Palette }[] = [
  { value: 'appearance', label: '外观', description: '主题与显示', icon: Palette },
  { value: 'models', label: '模型', description: 'AI 服务与凭证', icon: KeyRound },
  { value: 'collection', label: '采集', description: '并发与资源', icon: Gauge },
  { value: 'storage', label: '存储', description: '看板数据清理', icon: Database },
  { value: 'memory', label: '记忆', description: '长期偏好与背景', icon: Brain },
]

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
  const [storageTab, setStorageTab] = useState<'crawl' | 'threads'>('threads')
  const [isAddingMemory, setIsAddingMemory] = useState(false)
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [selectedPlatformToClear, setSelectedPlatformToClear] = useState<string>('')
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
  const platformsQuery = useQuery({
    queryKey: ['config-platforms'],
    queryFn: async () => (await configApi.getPlatforms()).data.platforms,
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
  const createMemory = useMutation({
    mutationFn: (content: string) => agentApi.createMemory({ content }),
    onSuccess: () => {
      setNewMemoryContent('')
      setIsAddingMemory(false)
      queryClient.invalidateQueries({ queryKey: ['agent-memories'] })
      toast.success('已新建记忆')
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
      queryClient.invalidateQueries({ queryKey: ['analytics-documents'] })
      toast.success(data.deleted > 0 ? `已清理 ${data.deleted} 个看板执行记录及底座数据` : '已完成底座采集数据与文档清理')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const cleanupThreads = useMutation({
    mutationFn: (mode: 'empty_short' | 'older_than_30_days_no_crawl' | 'all_threads') => dataApi.cleanupThreads(mode),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
      queryClient.invalidateQueries({ queryKey: ['agent-threads'] })
      queryClient.invalidateQueries({ queryKey: ['agent-thread'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-tasks'] })
      toast.success(`已清理 ${data.deleted} 个对话会话`)
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
                      <Input
                        value={form.baseUrl || ''}
                        onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-xs text-cyber-text-secondary">模型名称</span>
                      <Input
                        value={form.model || ''}
                        onChange={(event) => setForm({ ...form, model: event.target.value })}
                        placeholder="模型 ID"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="flex items-center justify-between text-xs text-cyber-text-secondary">
                        <span>API Key</span>
                        {form.apiKeyConfigured || form.apiKey ? (
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
                          onChange={(event) => setForm({ ...form, apiKey: event.target.value, clearApiKey: event.target.value === '' })}
                          placeholder={form.apiKeyConfigured ? '••••••••••••••••（输入新 Key 可覆盖）' : '填写 API Key'}
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
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">采集设置</DialogTitle>
                  <DialogDescription>控制全局采集并发数，并管理各平台的登录身份凭证与状态。</DialogDescription>
                </DialogHeader>
                {runtimeSettingsQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取采集设置…</div>
                ) : runtimeSettingsQuery.data ? (
                  <div className="mt-7 space-y-4">
                    <div className="flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">全局平台并发数</div>
                        <div className="mt-1 text-xs leading-5 text-cyber-text-muted">所有任务合计最多同时采集的平台数。</div>
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
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <SelectItem key={value} value={String(value)} className="text-xs">{value} 个平台</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">登录身份与凭证</div>
                        <div className="mt-1 text-xs leading-5 text-cyber-text-muted">
                          清空各平台或所有平台在本地保存的无头浏览器 Cookie、Session 会话及自动化状态缓存。
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cyber-border-subtle/60 pt-4">
                        <div className="flex items-center gap-2">
                          <Select
                            value={selectedPlatformToClear}
                            onValueChange={setSelectedPlatformToClear}
                          >
                            <SelectTrigger className="h-9 w-44 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                              <SelectValue placeholder="选择指定平台..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(platformsQuery.data || []).filter((p) => p.requiresAuth !== false).map((p) => (
                                <SelectItem key={p.value} value={p.value} className="text-xs">
                                  {p.label} ({p.value})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <DeleteConfirmDialog
                            trigger={
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-9 shrink-0 gap-1.5 border-cyber-border-subtle text-cyber-text-secondary hover:text-cyber-text-primary px-3 text-xs"
                                disabled={!selectedPlatformToClear}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                清空指定平台凭证
                              </Button>
                            }
                            title={`清空【${platformsQuery.data?.find(p => p.value === selectedPlatformToClear)?.label || selectedPlatformToClear}】凭证`}
                            description="确定要清空该平台的登录凭证吗？此操作将删除该平台本地保存的浏览器 Session 与 Cookie 登录缓存，下一次发起采集该平台时需要重新扫码登录。"
                            confirmLabel="确认清空"
                            onConfirm={async () => {
                              try {
                                const res = await configApi.clearAuthCredentials(selectedPlatformToClear)
                                toast.success(res.data.message || '已成功清空该平台登录凭证')
                              } catch (err: any) {
                                toast.error(getError(err))
                                throw err
                              }
                            }}
                          />
                        </div>

                        <DeleteConfirmDialog
                          trigger={
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-9 shrink-0 gap-1.5 px-3.5 text-xs font-medium"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              清空所有凭证
                            </Button>
                          }
                          title="清空所有登录身份验证"
                          description="确定要清空所有平台的登录身份凭证吗？此操作将清除本地保存的所有浏览器 Cookie 及 Session 登录状态。下次发起采集时相关平台将需要重新扫码登录。此操作不会删除数据库中已保存的历史数据。"
                          confirmLabel="确认清空所有"
                          onConfirm={async () => {
                            try {
                              const res = await configApi.clearAuthCredentials()
                              toast.success(res.data.message || '已成功清空所有登录凭证')
                            } catch (err: any) {
                              toast.error(getError(err))
                              throw err
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : activeSection === 'storage' ? (
              <div className="mx-auto max-w-2xl space-y-5">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">存储管理</DialogTitle>
                  <DialogDescription>管理和清理本地采集的执行履历、底层文档与对话会话数据。物理删除后不可恢复。</DialogDescription>
                </DialogHeader>

                {/* 便签页切换子导航 */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setStorageTab('threads')}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      storageTab === 'threads'
                        ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10 text-cyber-neon-cyan font-semibold'
                        : 'border-cyber-border-subtle text-cyber-text-secondary hover:border-cyber-border-default hover:bg-cyber-bg-secondary/50'
                    }`}
                  >
                    <MessageSquare className="h-4 w-4" />
                    <span>会话历史</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStorageTab('crawl')}
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors ${
                      storageTab === 'crawl'
                        ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10 text-cyber-neon-cyan font-semibold'
                        : 'border-cyber-border-subtle text-cyber-text-secondary hover:border-cyber-border-default hover:bg-cyber-bg-secondary/50'
                    }`}
                  >
                    <Database className="h-4 w-4" />
                    <span>采集存储</span>
                  </button>
                </div>

                {storageQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在统计本地数据…</div>
                ) : storageQuery.data ? (
                  <div className="mt-5">
                    {storageTab === 'crawl' ? (
                      /* 便签 1：采集底座与看板存储 */
                      <div className="space-y-5">
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            ['执行任务', storageQuery.data.analytics_runs],
                            ['采集数据', storageQuery.data.raw_records || storageQuery.data.analytics_records || 0],
                            ['运行日志', storageQuery.data.log_records],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 p-4">
                              <p className="text-[10px] text-cyber-text-muted">{label}</p>
                              <p className="mt-1 text-xl font-semibold text-cyber-text-primary">{Number(value || 0).toLocaleString('zh-CN')}</p>
                            </div>
                          ))}
                        </div>
                        <div className="divide-y divide-cyber-border-subtle rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 px-4">
                          {[
                            { mode: 'failed_empty' as const, title: '清理失败或空结果执行', detail: '物理清理失败或空结果执行数据。', confirm: '清理失败或空结果执行？' },
                            { mode: 'older_than_30_days' as const, title: '清理 30 天前执行历史', detail: '物理清理 30 天前的执行历史数据。', confirm: '清理 30 天前的执行历史？' },
                            { mode: 'all' as const, title: '清空全部历史数据', detail: '彻底物理清空所有已结束任务的执行日志与采集数据。', confirm: '彻底清空全部历史数据？' },
                          ].map((item) => (
                            <div key={item.mode} className="flex items-center justify-between gap-5 py-4">
                              <div>
                                <p className="text-sm font-medium text-cyber-text-primary">{item.title}</p>
                                <p className="mt-0.5 text-xs text-cyber-text-muted">{item.detail}</p>
                              </div>
                              <DeleteConfirmDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant={item.mode === 'all' ? 'destructive' : 'outline'}
                                    className={`h-8 ${item.mode === 'all' ? 'border border-cyber-neon-pink/30 bg-cyber-neon-pink/10 text-cyber-neon-pink hover:bg-cyber-neon-pink/20 hover:text-cyber-neon-pink' : ''}`}
                                    disabled={cleanupStorage.isPending}
                                  >
                                    {item.mode === 'all' ? '清空' : '清理'}
                                  </Button>
                                }
                                title={item.confirm}
                                description="所选范围内的看板执行履历、日志以及底层关联的所有物理文档数据将一并彻底物理清除，有效释放本地空间。"
                                confirmLabel="确认清理"
                                onConfirm={() => cleanupStorage.mutateAsync(item.mode)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* 便签 2：对话与会话管理 */
                      <div className="space-y-5">
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                          {[
                            ['会话总数', storageQuery.data.thread_records || 0],
                            ['消息总数', storageQuery.data.message_records || 0],
                          ].map(([label, value]) => (
                            <div key={String(label)} className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 p-4">
                              <p className="text-[10px] text-cyber-text-muted">{label}</p>
                              <p className="mt-1 text-xl font-semibold text-cyber-text-primary">{Number(value || 0).toLocaleString('zh-CN')}</p>
                            </div>
                          ))}
                        </div>
                        <div className="divide-y divide-cyber-border-subtle rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 px-4">
                          {[
                            { mode: 'empty_short' as const, title: '清理空会话 / 零星问答', detail: '清理消息少于 6 条且未采集到有效数据的对话。', confirm: '清理空会话与零星问答？' },
                            { mode: 'older_than_30_days_no_crawl' as const, title: '清理 30 天前无有效采集数据的历史对话', detail: '清理 30 天前更新且未采集到有效数据的历史对话。', confirm: '清理 30 天前无有效采集数据的历史对话？' },
                            { mode: 'all_threads' as const, title: '清空所有历史对话', detail: '彻底物理清空侧边栏所有历史对话会话（正在运行任务的对话除外）。', confirm: '彻底清空所有历史对话？' },
                          ].map((item) => (
                            <div key={item.mode} className="flex items-center justify-between gap-5 py-4">
                              <div>
                                <p className="text-sm font-medium text-cyber-text-primary">{item.title}</p>
                                <p className="mt-0.5 text-xs text-cyber-text-muted">{item.detail}</p>
                              </div>
                              <DeleteConfirmDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant={item.mode === 'all_threads' ? 'destructive' : 'outline'}
                                    className={`h-8 ${item.mode === 'all_threads' ? 'border border-cyber-neon-pink/30 bg-cyber-neon-pink/10 text-cyber-neon-pink hover:bg-cyber-neon-pink/20 hover:text-cyber-neon-pink' : ''}`}
                                    disabled={cleanupThreads.isPending}
                                  >
                                    {item.mode === 'all_threads' ? '清空' : '清理'}
                                  </Button>
                                }
                                title={item.confirm}
                                description="所选范围内的对话记录与侧边栏历史会话将彻底物理删除。注意：【记忆】模块中保存的用户个人偏好与背景信息不受影响。"
                                confirmLabel="确认清理"
                                onConfirm={() => cleanupThreads.mutateAsync(item.mode)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                          <p className="mt-0.5 text-xs text-cyber-text-muted">将保存在本机的长期记忆带入对话</p>
                        </div>
                        <SettingToggle checked={memorySettingsQuery.data.enabled} onChange={(enabled) => saveMemorySettings.mutate({ enabled })} />
                      </div>
                      <div className="flex items-center justify-between gap-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-cyber-text-primary">自动提取记忆</p>
                          <p className="mt-0.5 text-xs text-cyber-text-muted">从对话中自动提取长期有用的称呼、偏好和背景</p>
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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1.5 border-cyber-neon-cyan/30 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
                          onClick={() => { setIsAddingMemory(true); setNewMemoryContent('') }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          新建记忆
                        </Button>
                      </div>

                      {isAddingMemory ? (
                        <div className="mb-3 rounded-xl border border-cyber-neon-cyan/40 bg-cyber-bg-secondary/60 p-3">
                          <p className="mb-1.5 text-xs font-medium text-cyber-neon-cyan">添加自定义记忆/硬性偏好：</p>
                          <div className="flex gap-2">
                            <Input
                              autoFocus
                              placeholder="例如：爬虫数据导出 CSV 时默认使用 UTF-8 编码"
                              value={newMemoryContent}
                              onChange={(e) => setNewMemoryContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newMemoryContent.trim()) {
                                  createMemory.mutate(newMemoryContent.trim())
                                }
                              }}
                              className="h-8 text-xs flex-1"
                            />
                            <Button
                              size="sm"
                              className="h-8 bg-cyber-neon-cyan text-black hover:bg-cyber-neon-cyan/80"
                              disabled={!newMemoryContent.trim() || createMemory.isPending}
                              onClick={() => createMemory.mutate(newMemoryContent.trim())}
                            >
                              保存
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() => setIsAddingMemory(false)}
                            >
                              取消
                            </Button>
                          </div>
                        </div>
                      ) : null}
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
                                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                                    <span className={memory.memory_key.startsWith('user_manual_')
                                      ? 'rounded border border-cyber-neon-cyan/20 bg-cyber-neon-cyan/10 px-2 py-0.5 text-[10px] font-medium text-cyber-neon-cyan'
                                      : 'rounded bg-cyber-bg-tertiary px-2 py-0.5 text-[10px] font-medium text-cyber-text-secondary'}>
                                      {memory.memory_key.startsWith('user_manual_') ? '手动添加' : '自动整理'}
                                    </span>
                                    {memory.category ? (
                                      <span className="rounded bg-cyber-bg-secondary px-2 py-0.5 text-[10px] font-medium text-cyber-text-muted">
                                        {{ identity: '身份', preference: '偏好', context: '背景', rule: '规则' }[memory.category] || memory.category}
                                      </span>
                                    ) : null}
                                  </div>
                                  {editMemoryId === memory.memory_id ? (
                                    <Input autoFocus value={editMemoryContent} onChange={(event) => setEditMemoryContent(event.target.value)} className="h-8 text-xs" />
                                  ) : (
                                    <p className="text-xs leading-relaxed text-cyber-text-primary">{memory.content}</p>
                                  )}
                                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-cyber-text-muted">
                                    <span>更新于 {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(memory.updated_at))}</span>
                                  </div>
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
