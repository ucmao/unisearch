import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Check, KeyRound, Loader2, Monitor, Moon, Palette, Pencil, RefreshCw, Settings2, Sun, Trash2, X } from 'lucide-react'
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
import { agentApi, type AgentMemory, type MemorySettings, type ModelProfile } from '@/lib/api'
import { useThemeStore } from '@/store/themeStore'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'

type Theme = 'light' | 'dark' | 'system'
export type SettingsSection = 'appearance' | 'models' | 'memory'

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
  const [form, setForm] = useState<Partial<ModelProfile> & { apiKey?: string }>({})
  const [editMemoryId, setEditMemoryId] = useState<string | null>(null)
  const [editMemoryContent, setEditMemoryContent] = useState('')
  const providerDrafts = useRef<Partial<Record<ModelProfile['provider'], { baseUrl: string; model: string }>>>({})
  const dialogOpen = open ?? internalOpen

  const setDialogOpen = (nextOpen: boolean) => {
    setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }

  useEffect(() => {
    if (dialogOpen) setActiveSection(initialSection)
  }, [dialogOpen, initialSection])

  const profileQuery = useQuery({
    queryKey: ['agent-model-profile'],
    queryFn: async () => (await agentApi.getModelProfile()).data,
    enabled: dialogOpen && activeSection === 'models',
  })
  const memorySettingsQuery = useQuery({
    queryKey: ['agent-memory-settings'],
    queryFn: async () => (await agentApi.getMemorySettings()).data,
    enabled: dialogOpen && activeSection === 'memory',
  })
  const memoriesQuery = useQuery({
    queryKey: ['agent-memories'],
    queryFn: async () => (await agentApi.listMemories()).data.items,
    enabled: dialogOpen && activeSection === 'memory',
  })

  useEffect(() => {
    if (profileQuery.data) {
      providerDrafts.current[profileQuery.data.provider] = {
        baseUrl: profileQuery.data.baseUrl,
        model: profileQuery.data.model,
      }
      setForm({ ...profileQuery.data, apiKey: '' })
    }
  }, [profileQuery.data])

  const save = useMutation({
    mutationFn: () => agentApi.saveModelProfile(form),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['agent-model-profile'], data)
      setForm((current) => ({ ...current, apiKey: '' }))
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
      toast.success(`${data.message} · ${data.latency_ms}ms`)
    },
    onError: (error) => toast.error(`连接失败：${getError(error)}`),
  })
  const saveMemorySettings = useMutation({
    mutationFn: (patch: Partial<MemorySettings>) => agentApi.saveMemorySettings(patch),
    onSuccess: ({ data }) => queryClient.setQueryData(['agent-memory-settings'], data),
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

  const applyProvider = (provider: ModelProfile['provider']) => {
    setForm((current) => {
      if (current.provider) {
        providerDrafts.current[current.provider] = {
          baseUrl: current.baseUrl || '',
          model: current.model || '',
        }
      }
      const providerValues = providerDrafts.current[provider] || MODEL_PROVIDER_DEFAULTS[provider]
      return { ...current, provider, ...providerValues, apiKey: current.apiKey }
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
                {profileQuery.isLoading ? (
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
                        <span>API Key</span><span className="text-[10px]">{form.apiKeyConfigured ? '已配置，留空表示不修改' : '尚未配置'}</span>
                      </span>
                      <Input type="password" value={form.apiKey || ''} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder={form.apiKeyConfigured ? '••••••••••••••••' : '填写你的 API Key'} />
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
            ) : (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">记忆</DialogTitle>
                  <DialogDescription>让 AI 在不同对话中记住你的长期偏好和背景。记忆保存在本机。</DialogDescription>
                </DialogHeader>
                {memorySettingsQuery.isLoading || memoriesQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取记忆…</div>
                ) : memorySettingsQuery.data ? (
                  <div className="mt-6 space-y-5">
                    <div className="divide-y divide-cyber-border-subtle rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 px-4">
                      <div className="flex items-center justify-between gap-5 py-3.5">
                        <div><p className="text-sm font-medium">启用记忆</p><p className="mt-0.5 text-[10px] text-cyber-text-muted">总开关，关闭后不会生成或调用记忆</p></div>
                        <SettingToggle checked={memorySettingsQuery.data.enabled} onChange={(enabled) => saveMemorySettings.mutate({ enabled })} />
                      </div>
                      <div className="flex items-center justify-between gap-5 py-3.5">
                        <div><p className="text-sm font-medium">自动生成记忆</p><p className="mt-0.5 text-[10px] text-cyber-text-muted">在明确要求或阶段性对话后提取稳定信息</p></div>
                        <SettingToggle disabled={!memorySettingsQuery.data.enabled} checked={memorySettingsQuery.data.autoCapture} onChange={(autoCapture) => saveMemorySettings.mutate({ autoCapture })} />
                      </div>
                      <div className="flex items-center justify-between gap-5 py-3.5">
                        <div><p className="text-sm font-medium">自动调用记忆</p><p className="mt-0.5 text-[10px] text-cyber-text-muted">回复前仅选取与当前问题相关的少量记忆</p></div>
                        <SettingToggle disabled={!memorySettingsQuery.data.enabled} checked={memorySettingsQuery.data.autoRecall} onChange={(autoRecall) => saveMemorySettings.mutate({ autoRecall })} />
                      </div>
                      <div className="flex items-center justify-between gap-5 py-3.5">
                        <div><p className="text-sm font-medium">写入模式</p><p className="mt-0.5 text-[10px] text-cyber-text-muted">保守模式只响应明确的“记住”指令</p></div>
                        <Select value={memorySettingsQuery.data.captureMode} disabled={!memorySettingsQuery.data.enabled || !memorySettingsQuery.data.autoCapture} onValueChange={(captureMode: MemorySettings['captureMode']) => saveMemorySettings.mutate({ captureMode })}>
                          <SelectTrigger className="h-9 w-28 shrink-0 bg-cyber-bg-panel text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="balanced">平衡模式</SelectItem><SelectItem value="conservative">保守模式</SelectItem></SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center justify-between gap-5 py-3.5">
                        <div><p className="text-sm font-medium">每次调用数量</p><p className="mt-0.5 text-[10px] text-cyber-text-muted">限制单次对话注入的长期记忆数量</p></div>
                        <Select value={String(memorySettingsQuery.data.recallLimit)} disabled={!memorySettingsQuery.data.enabled || !memorySettingsQuery.data.autoRecall} onValueChange={(value) => saveMemorySettings.mutate({ recallLimit: Number(value) })}>
                          <SelectTrigger className="h-9 w-28 shrink-0 bg-cyber-bg-panel text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="5">5 条</SelectItem><SelectItem value="8">8 条</SelectItem><SelectItem value="12">12 条</SelectItem></SelectContent>
                        </Select>
                      </div>
                    </div>

                    <p className="rounded-lg border border-cyber-neon-cyan/20 bg-cyber-neon-cyan/5 px-3 py-2 text-[10px] leading-relaxed text-cyber-text-muted">只从你亲自发送的文字中提取记忆，不读取 AI 回复、附件或采集结果。生成记忆时，近期用户消息会发送给当前配置的模型。</p>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <div><p className="text-sm font-medium">已保存的记忆</p><p className="mt-0.5 text-[10px] text-cyber-text-muted">{memoriesQuery.data?.length || 0} 条 · 候选记忆需要确认后才会调用</p></div>
                        {memoriesQuery.data?.length ? <DeleteConfirmDialog
                          trigger={<Button size="sm" variant="ghost" className="text-cyber-neon-pink hover:text-cyber-neon-pink" disabled={clearMemories.isPending}><Trash2 />清空</Button>}
                          title="清空全部永久记忆？"
                          description="所有已保存和候选记忆都会被删除，此操作无法撤销。"
                          confirmLabel="全部清空"
                          onConfirm={() => clearMemories.mutateAsync()}
                        /> : null}
                      </div>
                      <div className="space-y-2">
                        {!memoriesQuery.data?.length ? <div className="rounded-xl border border-dashed border-cyber-border-default px-4 py-8 text-center text-xs text-cyber-text-muted">还没有记忆。你可以在对话中说“请记住……”</div> : null}
                        {memoriesQuery.data?.map((memory) => (
                          <div key={memory.memory_id} className={`rounded-xl border p-3 ${memory.status === 'candidate' ? 'border-cyber-neon-orange/35 bg-cyber-neon-orange/5' : 'border-cyber-border-subtle bg-cyber-bg-secondary/35'}`}>
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="mb-1.5 flex items-center gap-2"><span className="rounded bg-cyber-bg-tertiary px-1.5 py-0.5 text-[9px] text-cyber-text-secondary">{memoryCategoryLabels[memory.category]}</span>{memory.status === 'candidate' ? <span className="text-[9px] text-cyber-neon-orange">待确认</span> : null}</div>
                                {editMemoryId === memory.memory_id ? <Input autoFocus value={editMemoryContent} onChange={(event) => setEditMemoryContent(event.target.value)} className="h-8 text-xs" /> : <p className="text-xs leading-relaxed text-cyber-text-primary">{memory.content}</p>}
                                <p className="mt-1 text-[9px] text-cyber-text-muted">更新于 {new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(memory.updated_at))}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {editMemoryId === memory.memory_id ? <>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!editMemoryContent.trim() || updateMemory.isPending} onClick={() => updateMemory.mutate({ memoryId: memory.memory_id, patch: { content: editMemoryContent } })} title="保存"><Check /></Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditMemoryId(null)} title="取消"><X /></Button>
                                </> : <>
                                  {memory.status === 'candidate' ? <Button size="icon" variant="ghost" className="h-7 w-7 text-cyber-neon-green" onClick={() => updateMemory.mutate({ memoryId: memory.memory_id, patch: { status: 'active' } })} title="确认记忆"><Check /></Button> : null}
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditMemoryId(memory.memory_id); setEditMemoryContent(memory.content) }} title="编辑"><Pencil /></Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-cyber-neon-pink" disabled={deleteMemory.isPending} onClick={() => deleteMemory.mutate(memory.memory_id)} title="删除"><Trash2 /></Button>
                                </>}
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
