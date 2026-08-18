import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Check, Coffee, Database, Eye, EyeOff, Gauge, HelpCircle, KeyRound, Loader2, LogIn, MessageSquare, Monitor, Moon, Palette, Pencil, Plus, RefreshCw, Search, Settings2, Sparkles, Sun, Trash2, X } from 'lucide-react'
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { agentApi, configApi, dataApi, retrievalApi, type AgentMemory, type MemorySettings, type ModelProfile, type RetrievalProfile, type RuntimeSettings } from '@/lib/api'
import { useThemeStore, type PetMode } from '@/store/themeStore'
import { PETS_REGISTRY, getPetById } from '@/lib/pets'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'

type Theme = 'light' | 'dark' | 'system'
export type SettingsSection = 'appearance' | 'models' | 'retrieval' | 'collection' | 'storage' | 'memory'
type ModelForm = Partial<ModelProfile> & { apiKey?: string; clearApiKey?: boolean }
type RetrievalForm = Partial<RetrievalProfile> & { apiKey?: string; clearApiKey?: boolean }

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

const petModes: { value: PetMode; label: string; icon: typeof Sparkles }[] = [
  { value: 'dynamic', label: '灵动模式', icon: Sparkles },
  { value: 'quiet', label: '安静克制', icon: Coffee },
  { value: 'off', label: '极简关闭', icon: EyeOff },
]

const MODEL_PROVIDER_DEFAULTS = {
  minimax: { baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.7-highspeed' },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  custom: { baseUrl: '', model: '' },
} satisfies Record<ModelProfile['provider'], { baseUrl: string; model: string }>

const RETRIEVAL_PROVIDER_DEFAULTS = {
  siliconflow: {
    baseUrl: 'https://api.siliconflow.cn/v1',
    embeddingModel: 'BAAI/bge-m3',
    rerankerModel: 'BAAI/bge-reranker-v2-m3',
  },
  custom: {
    baseUrl: '',
    embeddingModel: '',
    rerankerModel: '',
  },
} satisfies Record<RetrievalProfile['provider'], { baseUrl: string; embeddingModel: string; rerankerModel: string }>

const sections: { value: SettingsSection; label: string; icon: typeof Palette }[] = [
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'models', label: '模型', icon: KeyRound },
  { value: 'retrieval', label: '知识检索', icon: Search },
  { value: 'collection', label: '采集', icon: Gauge },
  { value: 'storage', label: '存储', icon: Database },
  { value: 'memory', label: '记忆', icon: Brain },
]

const BROWSER_PLATFORM_CATEGORIES: Record<string, string> = {
  social_media: '社交媒体',
  ai_web_qa: 'AI 问答平台',
  job_platform: '招聘求职',
  complaint_platform: '消费维权',
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

function FieldHelp({ content }: { content: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen((prev) => !prev)
        }}
        className="rounded p-0.5 text-cyber-text-muted transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-neon-cyan"
        title="查看说明"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-lg border border-cyber-border-default bg-cyber-bg-primary/95 p-2.5 text-[11px] leading-relaxed text-cyber-text-secondary shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95"
        >
          {content}
        </div>
      )}
    </div>
  )
}

const SHORT_MSG_STORAGE_KEY = 'unisearch_storage_short_msg_threshold'
const THREAD_DAYS_STORAGE_KEY = 'unisearch_storage_thread_days_threshold'
const CRAWL_DAYS_STORAGE_KEY = 'unisearch_storage_crawl_days_threshold'
const CRAWL_FAILED_DAYS_STORAGE_KEY = 'unisearch_storage_crawl_failed_days_threshold'

function getStoredThreshold(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key)
    if (v !== null) {
      const parsed = Number(v)
      if (!isNaN(parsed) && parsed >= 0) return parsed
    }
  } catch (err) {
    void err
  }
  return fallback
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
  const { theme, setTheme, petMode, setPetMode, selectedPetId, setSelectedPetId } = useThemeStore()
  const currentPet = getPetById(selectedPetId)
  const [internalOpen, setInternalOpen] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection)
  const [form, setForm] = useState<ModelForm>({})
  const [retrievalForm, setRetrievalForm] = useState<RetrievalForm>({})
  const [showApiKey, setShowApiKey] = useState(false)
  const [editMemoryId, setEditMemoryId] = useState<string | null>(null)
  const [editMemoryContent, setEditMemoryContent] = useState('')
  const [storageTab, setStorageTab] = useState<'crawl' | 'threads'>('threads')
  const [shortMessageThreshold, setShortMessageThresholdState] = useState<number>(() => getStoredThreshold(SHORT_MSG_STORAGE_KEY, 2))
  const [threadDaysThreshold, setThreadDaysThresholdState] = useState<number>(() => getStoredThreshold(THREAD_DAYS_STORAGE_KEY, 30))
  const [crawlDaysThreshold, setCrawlDaysThresholdState] = useState<number>(() => getStoredThreshold(CRAWL_DAYS_STORAGE_KEY, 30))
  const [crawlFailedDaysThreshold, setCrawlFailedDaysThresholdState] = useState<number>(() => getStoredThreshold(CRAWL_FAILED_DAYS_STORAGE_KEY, 3))

  const setShortMessageThreshold = (val: number) => {
    setShortMessageThresholdState(val)
    try {
      localStorage.setItem(SHORT_MSG_STORAGE_KEY, String(val))
    } catch (err) {
      void err
    }
  }
  const setThreadDaysThreshold = (val: number) => {
    setThreadDaysThresholdState(val)
    try {
      localStorage.setItem(THREAD_DAYS_STORAGE_KEY, String(val))
    } catch (err) {
      void err
    }
  }
  const setCrawlDaysThreshold = (val: number) => {
    setCrawlDaysThresholdState(val)
    try {
      localStorage.setItem(CRAWL_DAYS_STORAGE_KEY, String(val))
    } catch (err) {
      void err
    }
  }
  const setCrawlFailedDaysThreshold = (val: number) => {
    setCrawlFailedDaysThresholdState(val)
    try {
      localStorage.setItem(CRAWL_FAILED_DAYS_STORAGE_KEY, String(val))
    } catch (err) {
      void err
    }
  }
  const [isAddingMemory, setIsAddingMemory] = useState(false)
  const [newMemoryContent, setNewMemoryContent] = useState('')
  const [newMemoryCategory, setNewMemoryCategory] = useState<AgentMemory['category']>('rule')
  const [selectedAuthPlatform, setSelectedAuthPlatform] = useState<string>('xhs')
  const providerDrafts = useRef<Partial<Record<ModelProfile['provider'], ModelForm>>>({})
  const retrievalDrafts = useRef<Partial<Record<RetrievalProfile['provider'], RetrievalForm>>>({})
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
  const retrievalProfileQuery = useQuery({
    queryKey: ['knowledge-retrieval-profile'],
    queryFn: async () => (await retrievalApi.getProfile()).data,
    enabled: dialogOpen && activeSection === 'retrieval',
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
  const authStatusQuery = useQuery({
    queryKey: ['config-auth-status'],
    queryFn: async () => (await configApi.getAuthStatus()).data.credentials,
    enabled: dialogOpen && activeSection === 'collection',
    refetchInterval: dialogOpen && activeSection === 'collection' ? 3000 : false,
  })
  const openAuthWindow = useMutation({
    mutationFn: async (platform: string) => (await configApi.openAuthWindow(platform)).data,
    onSuccess: (data) => {
      toast.success(data.message || '已唤起平台登录窗口')
      queryClient.invalidateQueries({ queryKey: ['config-auth-status'] })
    },
    onError: (error) => toast.error(getError(error)),
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
  const storagePreviewQuery = useQuery({
    queryKey: ['storage-preview', shortMessageThreshold, threadDaysThreshold, crawlDaysThreshold, crawlFailedDaysThreshold],
    queryFn: async () => (await dataApi.getStoragePreview({
      max_messages: shortMessageThreshold,
      thread_days: threadDaysThreshold,
      crawl_days: crawlDaysThreshold,
      crawl_failed_days: crawlFailedDaysThreshold,
    })).data,
    enabled: dialogOpen && activeSection === 'storage',
    staleTime: 5000,
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

  useEffect(() => {
    if (retrievalProfileQuery.data) {
      const activeProvider = retrievalProfileQuery.data.provider
      retrievalDrafts.current[activeProvider] = {
        ...retrievalProfileQuery.data,
        apiKey: '',
        clearApiKey: false,
      }
      setRetrievalForm({
        ...retrievalProfileQuery.data,
        apiKey: '',
        clearApiKey: false,
      })
    }
  }, [retrievalProfileQuery.data])

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
  const saveRetrieval = useMutation({
    mutationFn: () => retrievalApi.saveProfile(retrievalForm),
    onSuccess: ({ data }) => {
      queryClient.setQueryData(['knowledge-retrieval-profile'], data)
      retrievalDrafts.current[data.provider] = { ...data, apiKey: '', clearApiKey: false }
      setRetrievalForm({ ...data, apiKey: '', clearApiKey: false })
      toast.success('知识检索配置已保存；更换向量模型后将自动重建索引')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const testRetrieval = useMutation({
    mutationFn: async () => {
      await retrievalApi.saveProfile(retrievalForm)
      return (await retrievalApi.testProfile()).data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-retrieval-profile'] })
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
    mutationFn: (input: { content: string; category: AgentMemory['category'] }) => agentApi.createMemory(input),
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
    mutationFn: (variables: { mode: 'failed_empty' | 'older_than_30_days' | 'all'; days?: number } | 'failed_empty' | 'older_than_30_days' | 'all') => {
      const payload = typeof variables === 'string' ? { mode: variables } : variables
      return dataApi.cleanupStorage(payload.mode, { days: payload.days })
    },
    onSuccess: ({ data }, variables) => {
      const mode = typeof variables === 'string' ? variables : variables.mode
      queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
      queryClient.invalidateQueries({ queryKey: ['storage-preview'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-documents'] })
      queryClient.invalidateQueries({ queryKey: ['research-graph'] })
      queryClient.invalidateQueries({ queryKey: ['research-reports'] })
      queryClient.invalidateQueries({ queryKey: ['search-relevance'] })
      queryClient.invalidateQueries({ queryKey: ['quality-gate'] })
      queryClient.invalidateQueries({ queryKey: ['graph-evidence'] })
      queryClient.invalidateQueries({ queryKey: ['graph-entity-rules'] })
      toast.success(mode === 'all'
        ? '已清空采集数据及关联研究资产'
        : data.deleted > 0
          ? `已清理 ${data.deleted} 个看板执行记录及底座数据`
          : '已完成底座采集数据与文档清理')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const cleanupThreads = useMutation({
    mutationFn: (variables: { mode: 'empty_short' | 'older_than_30_days_no_crawl' | 'all_threads'; maxMessages?: number; days?: number } | 'empty_short' | 'older_than_30_days_no_crawl' | 'all_threads') => {
      const payload = typeof variables === 'string' ? { mode: variables } : variables
      return dataApi.cleanupThreads(payload.mode, { maxMessages: payload.maxMessages, days: payload.days })
    },
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ['storage-summary'] })
      queryClient.invalidateQueries({ queryKey: ['storage-preview'] })
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
        connectionVerified: false,
        lastError: '',
        clearApiKey: false,
      }
    })
  }

  const applyRetrievalProvider = (provider: RetrievalProfile['provider']) => {
    setRetrievalForm((current) => {
      if (current.provider) {
        retrievalDrafts.current[current.provider] = { ...current }
      }
      const providerValues = retrievalDrafts.current[provider]
      return providerValues || {
        provider,
        ...RETRIEVAL_PROVIDER_DEFAULTS[provider],
        timeoutMs: current.timeoutMs ?? 60000,
        apiKey: '',
        apiKeyConfigured: false,
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
            <div className="mb-4 px-2 pt-1">
              <p className="text-base font-semibold text-cyber-text-primary">设置</p>
            </div>
            <nav className="space-y-1" aria-label="设置分类">
              {sections.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveSection(value)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${activeSection === value
                    ? 'bg-cyber-bg-tertiary text-cyber-text-primary shadow-sm'
                    : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary/60 hover:text-cyber-text-primary'
                    }`}
                  aria-current={activeSection === value ? 'page' : undefined}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${activeSection === value ? 'text-cyber-neon-cyan' : ''}`} />
                  <span className="truncate">{label}</span>
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
                <div className="mt-7 space-y-4">
                  <div className="flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
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

                  <div className="flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                    <div>
                      <div className="text-sm font-medium text-cyber-text-primary">宠物行为</div>
                      <div className="mt-1 text-xs text-cyber-text-muted">调整空状态下的像素助手显示与互动偏好</div>
                    </div>
                    <Select value={petMode} onValueChange={(value: PetMode) => setPetMode(value)}>
                      <SelectTrigger className="h-9 w-32 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {petModes.map(({ value, label, icon: Icon }) => (
                          <SelectItem key={value} value={value} className="text-xs">
                            <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{label}</div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                    <div className="flex items-center justify-between gap-6">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">宠物形象</div>
                        <div className="mt-1 text-xs text-cyber-text-muted">
                          自定义主界面空闲状态下的像素助手形象
                        </div>
                      </div>
                      <Select value={selectedPetId} onValueChange={(value: string) => setSelectedPetId(value)}>
                        <SelectTrigger className="h-9 w-32 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="max-h-80">
                          {PETS_REGISTRY.map((pet) => (
                            <SelectItem key={pet.id} value={pet.id} className="text-xs">
                              <span className="font-medium">{pet.displayName}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {currentPet && (
                      <div className="mt-3.5 flex items-center gap-3.5 rounded-lg border border-cyber-border-subtle/60 bg-cyber-bg-tertiary/35 p-3 select-none">
                        <div
                          className="h-10 w-10 shrink-0 rounded-lg border border-cyber-border-subtle/70 bg-cyber-bg-secondary/60"
                          style={{
                            backgroundImage: `url(${currentPet.spritesheetUrl})`,
                            backgroundPosition: '0 0',
                            backgroundSize: '320px 390px',
                            imageRendering: 'pixelated',
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-cyber-text-primary">{currentPet.displayName}</span>
                            <span className="text-[11px] text-cyber-text-muted">· {currentPet.tagline}</span>
                          </div>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-cyber-text-secondary line-clamp-1">
                            {currentPet.description}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : activeSection === 'models' ? (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">模型</DialogTitle>
                  <DialogDescription>配置对话与分析使用的 AI 服务、模型和本机凭证。</DialogDescription>
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
                            className={`rounded-lg border px-3 py-2.5 text-xs transition-colors ${form.provider === provider ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10 text-cyber-neon-cyan font-semibold' : 'border-cyber-border-subtle text-cyber-text-secondary hover:border-cyber-border-default hover:bg-cyber-bg-secondary/50'}`}>
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
            ) : activeSection === 'retrieval' ? (
              <div className="mx-auto max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="font-sans text-xl text-cyber-text-primary">知识检索</DialogTitle>
                  <DialogDescription>配置语义向量与重排模型，用于本地知识库检索及深度研究候选网页的语义精排。</DialogDescription>
                </DialogHeader>
                {retrievalProfileQuery.isLoading ? (
                  <div className="flex min-h-60 items-center justify-center text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取知识检索配置…</div>
                ) : (
                  <div className="mt-7 space-y-5">
                    <div>
                      <p className="mb-2 text-xs font-medium text-cyber-text-secondary">服务提供商</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(['siliconflow', 'custom'] as const).map((provider) => (
                          <button
                            key={provider}
                            type="button"
                            onClick={() => applyRetrievalProvider(provider)}
                            className={`rounded-lg border px-3 py-2.5 text-xs transition-colors ${retrievalForm.provider === provider ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10 text-cyber-neon-cyan font-semibold' : 'border-cyber-border-subtle text-cyber-text-secondary hover:border-cyber-border-default hover:bg-cyber-bg-secondary/50'}`}
                          >
                            {provider === 'siliconflow' ? '硅基流动' : '自定义兼容接口'}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-xs text-cyber-text-secondary">API Base URL</span>
                      <Input
                        value={retrievalForm.baseUrl || ''}
                        onChange={(event) => setRetrievalForm({ ...retrievalForm, baseUrl: event.target.value })}
                        placeholder="https://api.siliconflow.cn/v1"
                      />
                    </label>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs text-cyber-text-secondary">
                        <label htmlFor="retrieval-embedding-model">向量模型 (Embedding)</label>
                        <FieldHelp content="用于本地已采集知识库的毫秒级语义向量检索与召回。" />
                      </div>
                      <Input
                        id="retrieval-embedding-model"
                        value={retrievalForm.embeddingModel || ''}
                        onChange={(event) => setRetrievalForm({ ...retrievalForm, embeddingModel: event.target.value })}
                        placeholder="BAAI/bge-m3"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs text-cyber-text-secondary">
                        <label htmlFor="retrieval-reranker-model">重排模型 (Reranker，选填)</label>
                        <FieldHelp content="选填。配置后将在深度研究中智能精排候选网页并优先抓取高价值正文，同时提升知识库检索准确度。" />
                      </div>
                      <Input
                        id="retrieval-reranker-model"
                        value={retrievalForm.rerankerModel || ''}
                        onChange={(event) => setRetrievalForm({ ...retrievalForm, rerankerModel: event.target.value })}
                        placeholder="BAAI/bge-reranker-v2-m3（选填，留空则使用基础规则排序）"
                      />
                    </div>

                    <label className="block space-y-1.5">
                      <span className="flex items-center justify-between text-xs text-cyber-text-secondary">
                        <span>API Key</span>
                        {retrievalForm.apiKeyConfigured || retrievalForm.apiKey ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-500">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            已配置
                          </span>
                        ) : null}
                      </span>
                      <div className="relative flex items-center">
                        <Input
                          type={showApiKey ? 'text' : 'password'}
                          value={retrievalForm.apiKey || ''}
                          onChange={(event) => setRetrievalForm({ ...retrievalForm, apiKey: event.target.value, clearApiKey: event.target.value === '' })}
                          placeholder={retrievalForm.apiKeyConfigured ? '••••••••••••••••（输入新 Key 可覆盖）' : '填写 API Key'}
                          className={retrievalForm.apiKey ? 'pr-9' : ''}
                        />
                        {retrievalForm.apiKey ? (
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
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!retrievalForm.apiKeyConfigured && !retrievalForm.apiKey) {
                            toast.error('请先填写 API Key 后再测试连接')
                            return
                          }
                          testRetrieval.mutate()
                        }}
                        disabled={testRetrieval.isPending || saveRetrieval.isPending}
                      >
                        {testRetrieval.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}测试连接
                      </Button>
                      <Button onClick={() => saveRetrieval.mutate()} disabled={saveRetrieval.isPending || testRetrieval.isPending}>
                        {saveRetrieval.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}保存配置
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
                          {[1, 2, 3, 4, 5].map((value) => <SelectItem key={value} value={String(value)} className="text-xs">{value} 个平台</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">连接器故障容灾策略</div>
                        <div className="mt-1 text-xs leading-5 text-cyber-text-muted">当所选连接器不可用或异常时，控制是否改用同类健康连接器。</div>
                      </div>
                      <Select
                        value={runtimeSettingsQuery.data.connectorFailoverPolicy || 'smart'}
                        onValueChange={(value) => saveRuntimeSettings.mutate({ connectorFailoverPolicy: value as any })}
                        disabled={saveRuntimeSettings.isPending}
                      >
                        <SelectTrigger className="h-9 w-36 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs" aria-label="连接器故障容灾策略">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="smart" className="text-xs">智能模式（推荐）</SelectItem>
                          <SelectItem value="never" className="text-xs">从不自动替换</SelectItem>
                          <SelectItem value="always" className="text-xs">总是自动替代</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">搜索关键词拓展策略</div>
                        <div className="mt-1 text-xs leading-5 text-cyber-text-muted">控制 AI 规划采集任务时的关键词智能改写与扩词行为。</div>
                      </div>
                      <Select
                        value={runtimeSettingsQuery.data.keywordExpansionPolicy || 'smart'}
                        onValueChange={(value) => saveRuntimeSettings.mutate({ keywordExpansionPolicy: value as any })}
                        disabled={saveRuntimeSettings.isPending}
                      >
                        <SelectTrigger className="h-9 w-36 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs" aria-label="搜索关键词拓展策略">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="smart" className="text-xs">智能模式（推荐）</SelectItem>
                          <SelectItem value="strict" className="text-xs">严格使用原词</SelectItem>
                          <SelectItem value="always" className="text-xs">总是 AI 拓展</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* 卡片 2: 平台账号预登录 */}
                    <div className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">平台账号预登录</div>
                        <div className="mt-1 text-xs leading-5 text-cyber-text-muted">
                          在独立沙箱中主动登录平台账号（扫码或验证码），登录态将自动保存供采集任务直接复用。
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cyber-border-subtle/60 pt-4">
                        <Select
                          value={selectedAuthPlatform}
                          onValueChange={setSelectedAuthPlatform}
                        >
                          <SelectTrigger className="h-9 w-36 shrink-0 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                            <SelectValue placeholder="选择平台..." />
                          </SelectTrigger>
                          <SelectContent className="max-h-72">
                            {Object.entries(BROWSER_PLATFORM_CATEGORIES).map(([category, label]) => {
                              const items = (platformsQuery.data || []).filter(
                                (p) => (p.category === category) && (p.runtimeEngine === 'playwright' || p.category in BROWSER_PLATFORM_CATEGORIES)
                              )
                              if (items.length === 0) return null
                              return (
                                <SelectGroup key={category}>
                                  <SelectLabel className="px-2 py-1.5 text-[11px] font-semibold text-cyber-neon-cyan/90">
                                    {label}
                                  </SelectLabel>
                                  {items.map((p) => (
                                    <SelectItem
                                      key={p.value}
                                      value={p.value}
                                      className="text-xs"
                                      extra={
                                        authStatusQuery.data?.[p.value]?.hasCredentials ? (
                                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-sm" title="已保存登录凭据" />
                                        ) : null
                                      }
                                    >
                                      {p.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )
                            })}
                          </SelectContent>
                        </Select>

                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 shrink-0 gap-1.5 border-cyber-neon-cyan/50 bg-cyber-neon-cyan/10 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/20 hover:border-cyber-neon-cyan px-3.5 text-xs font-medium"
                          disabled={!selectedAuthPlatform || openAuthWindow.isPending}
                          onClick={() => {
                            if (selectedAuthPlatform) {
                              openAuthWindow.mutate(selectedAuthPlatform)
                            }
                          }}
                        >
                          {openAuthWindow.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                          前往登录
                        </Button>
                      </div>
                    </div>

                    {/* 卡片 3: 凭证与缓存重置 */}
                    <div className="flex items-center justify-between gap-6 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/55 p-4 sm:p-5">
                      <div>
                        <div className="text-sm font-medium text-cyber-text-primary">凭证与缓存重置</div>
                        <div className="mt-1 text-xs leading-5 text-cyber-text-muted">一键清空所有平台在本地保存的登录凭据与会话缓存。</div>
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
                        title="清空所有浏览器平台凭证与缓存"
                        description="确定要清空所有浏览器平台的登录凭证与会话缓存吗？此操作将清除本地保存的所有 Chromium 独立分区登录状态与缓存。下次发起采集时相关平台将以全新状态运行。此操作不会删除数据库中已保存的历史数据。"
                        confirmLabel="确认清空所有"
                        onConfirm={async () => {
                          try {
                            const res = await configApi.clearAuthCredentials()
                            queryClient.invalidateQueries({ queryKey: ['config-auth-status'] })
                            toast.success(res.data.message || '已成功清空所有登录凭证与会话缓存')
                          } catch (err: any) {
                            toast.error(getError(err))
                            throw err
                          }
                        }}
                      />
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
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors ${storageTab === 'threads'
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
                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs transition-colors ${storageTab === 'crawl'
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
                          <div className="flex items-center justify-between gap-5 py-4">
                            <div>
                              <p className="text-sm font-medium text-cyber-text-primary">清理失败与空执行</p>
                              <p className="mt-0.5 text-xs text-cyber-text-muted">
                                物理清理{crawlFailedDaysThreshold > 0 ? ` ${crawlFailedDaysThreshold} 天前的` : ''}失败或空结果执行数据。
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Select
                                value={String(crawlFailedDaysThreshold)}
                                onValueChange={(val) => setCrawlFailedDaysThreshold(Number(val))}
                              >
                                <SelectTrigger className="h-8 w-28 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0" className="text-xs">全部记录</SelectItem>
                                  <SelectItem value="3" className="text-xs">3 天前</SelectItem>
                                  <SelectItem value="7" className="text-xs">7 天前</SelectItem>
                                  <SelectItem value="14" className="text-xs">14 天前</SelectItem>
                                  <SelectItem value="30" className="text-xs">30 天前</SelectItem>
                                </SelectContent>
                              </Select>
                              <DeleteConfirmDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0"
                                    disabled={cleanupStorage.isPending}
                                  >
                                    清理
                                  </Button>
                                }
                                title="清理失败或空结果执行？"
                                description={`所选范围内的看板执行履历、日志以及底层关联的物理文档数据将一并清除${storagePreviewQuery.data ? `（预计清理 ${storagePreviewQuery.data.crawl_failed_empty} 个任务）` : ''}。`}
                                confirmLabel="确认清理"
                                onConfirm={() => cleanupStorage.mutateAsync({ mode: 'failed_empty', days: crawlFailedDaysThreshold })}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-5 py-4">
                            <div>
                              <p className="text-sm font-medium text-cyber-text-primary">清理早期执行历史</p>
                              <p className="mt-0.5 text-xs text-cyber-text-muted">物理清理 {crawlDaysThreshold} 天前的执行历史数据。</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Select
                                value={String(crawlDaysThreshold)}
                                onValueChange={(val) => setCrawlDaysThreshold(Number(val))}
                              >
                                <SelectTrigger className="h-8 w-28 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="7" className="text-xs">7 天前</SelectItem>
                                  <SelectItem value="14" className="text-xs">14 天前</SelectItem>
                                  <SelectItem value="30" className="text-xs">30 天前</SelectItem>
                                  <SelectItem value="60" className="text-xs">60 天前</SelectItem>
                                  <SelectItem value="90" className="text-xs">90 天前</SelectItem>
                                  <SelectItem value="180" className="text-xs">180 天前</SelectItem>
                                </SelectContent>
                              </Select>
                              <DeleteConfirmDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0"
                                    disabled={cleanupStorage.isPending}
                                  >
                                    清理
                                  </Button>
                                }
                                title={`清理 ${crawlDaysThreshold} 天前的执行历史？`}
                                description={`所选 ${crawlDaysThreshold} 天前的看板执行履历、日志以及底层关联的物理文档数据将一并清除${storagePreviewQuery.data ? `（预计清理 ${storagePreviewQuery.data.crawl_older_days} 个任务）` : ''}。`}
                                confirmLabel="确认清理"
                                onConfirm={() => cleanupStorage.mutateAsync({ mode: 'older_than_30_days', days: crawlDaysThreshold })}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-5 py-4">
                            <div>
                              <p className="text-sm font-medium text-cyber-text-primary">清空全部历史数据</p>
                              <p className="mt-0.5 text-xs text-cyber-text-muted">彻底清空所有已结束任务的采集数据、图谱、报告及质量评估。</p>
                            </div>
                            <DeleteConfirmDialog
                              trigger={
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-8 shrink-0 border border-cyber-neon-pink/30 bg-cyber-neon-pink/10 text-cyber-neon-pink hover:bg-cyber-neon-pink/20 hover:text-cyber-neon-pink"
                                  disabled={cleanupStorage.isPending}
                                >
                                  清空
                                </Button>
                              }
                              title="彻底清空全部历史数据与研究资产？"
                              description={`所有已结束的采集执行${storagePreviewQuery.data ? `（预计清空 ${storagePreviewQuery.data.crawl_all} 个任务）` : ''}、日志、文档以及关联的图谱、报告、实体规则和质量评估将一并彻底删除。对话记录与系统级连接器健康状态不受影响。`}
                              confirmLabel="确认清理"
                              onConfirm={() => cleanupStorage.mutateAsync({ mode: 'all' })}
                            />
                          </div>
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
                          <div className="flex items-center justify-between gap-5 py-4">
                            <div>
                              <p className="text-sm font-medium text-cyber-text-primary">清理短小 / 零星会话</p>
                              <p className="mt-0.5 text-xs text-cyber-text-muted">
                                {shortMessageThreshold === 0
                                  ? '清理未发送任何提问且未采集到有效数据的空会话。'
                                  : `清理用户提问少于 ${shortMessageThreshold} 条且未采集到有效数据的对话。`}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Select
                                value={String(shortMessageThreshold)}
                                onValueChange={(val) => setShortMessageThreshold(Number(val))}
                              >
                                <SelectTrigger className="h-8 w-28 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0" className="text-xs">0 条提问</SelectItem>
                                  <SelectItem value="2" className="text-xs">少于 2 条</SelectItem>
                                  <SelectItem value="3" className="text-xs">少于 3 条</SelectItem>
                                  <SelectItem value="5" className="text-xs">少于 5 条</SelectItem>
                                  <SelectItem value="10" className="text-xs">少于 10 条</SelectItem>
                                </SelectContent>
                              </Select>
                              <DeleteConfirmDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0"
                                    disabled={cleanupThreads.isPending}
                                  >
                                    清理
                                  </Button>
                                }
                                title={shortMessageThreshold === 0 ? '清理 0 条提问的空会话？' : `清理提问少于 ${shortMessageThreshold} 条的零星会话？`}
                                description={`所选范围内${shortMessageThreshold === 0 ? '未发送任何提问' : `用户提问少于 ${shortMessageThreshold} 条`}且未采集到有效数据的对话消息、附件与侧边栏会话将彻底删除${storagePreviewQuery.data ? `（预计清理 ${storagePreviewQuery.data.thread_empty_short} 个会话）` : ''}；知识库中的采集数据、图谱、报告及【记忆】模块不受影响。`}
                                confirmLabel="确认清理"
                                onConfirm={() => cleanupThreads.mutateAsync({ mode: 'empty_short', maxMessages: shortMessageThreshold })}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-5 py-4">
                            <div>
                              <p className="text-sm font-medium text-cyber-text-primary">清理早期无效采集的历史对话</p>
                              <p className="mt-0.5 text-xs text-cyber-text-muted">
                                清理 {threadDaysThreshold} 天前更新且未采集到有效数据的历史对话。
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <Select
                                value={String(threadDaysThreshold)}
                                onValueChange={(val) => setThreadDaysThreshold(Number(val))}
                              >
                                <SelectTrigger className="h-8 w-28 border-cyber-border-subtle bg-cyber-bg-panel text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="7" className="text-xs">7 天前</SelectItem>
                                  <SelectItem value="14" className="text-xs">14 天前</SelectItem>
                                  <SelectItem value="30" className="text-xs">30 天前</SelectItem>
                                  <SelectItem value="60" className="text-xs">60 天前</SelectItem>
                                  <SelectItem value="90" className="text-xs">90 天前</SelectItem>
                                  <SelectItem value="180" className="text-xs">180 天前</SelectItem>
                                </SelectContent>
                              </Select>
                              <DeleteConfirmDialog
                                trigger={
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 shrink-0"
                                    disabled={cleanupThreads.isPending}
                                  >
                                    清理
                                  </Button>
                                }
                                title={`清理 ${threadDaysThreshold} 天前无效采集的历史对话？`}
                                description={`所选 ${threadDaysThreshold} 天前更新且未采集到有效数据的对话消息、附件与侧边栏会话将彻底删除${storagePreviewQuery.data ? `（预计清理 ${storagePreviewQuery.data.thread_older_days} 个会话）` : ''}；知识库中的采集数据、图谱、报告及【记忆】模块不受影响。`}
                                confirmLabel="确认清理"
                                onConfirm={() => cleanupThreads.mutateAsync({ mode: 'older_than_30_days_no_crawl', days: threadDaysThreshold })}
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-5 py-4">
                            <div>
                              <p className="text-sm font-medium text-cyber-text-primary">清空所有历史对话</p>
                              <p className="mt-0.5 text-xs text-cyber-text-muted">
                                清空侧边栏历史对话；已采集数据与研究资产继续保留在知识库中。
                              </p>
                            </div>
                            <DeleteConfirmDialog
                              trigger={
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-8 shrink-0 border border-cyber-neon-pink/30 bg-cyber-neon-pink/10 text-cyber-neon-pink hover:bg-cyber-neon-pink/20 hover:text-cyber-neon-pink"
                                  disabled={cleanupThreads.isPending}
                                >
                                  清空
                                </Button>
                              }
                              title="彻底清空所有历史对话？"
                              description={`所选范围内的对话消息、附件与侧边栏会话将彻底删除${storagePreviewQuery.data ? `（预计清空 ${storagePreviewQuery.data.thread_all} 个会话）` : ''}；知识库中的采集数据、图谱、报告及【记忆】模块不受影响。`}
                              confirmLabel="确认清理"
                              onConfirm={() => cleanupThreads.mutateAsync({ mode: 'all_threads' })}
                            />
                          </div>
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
                          onClick={() => { setIsAddingMemory(true); setNewMemoryContent(''); setNewMemoryCategory('rule') }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          新建记忆
                        </Button>
                      </div>

                      {isAddingMemory ? (
                        <div className="mb-3 rounded-xl border border-cyber-neon-cyan/40 bg-cyber-bg-secondary/60 p-3">
                          <p className="mb-1.5 text-xs font-medium text-cyber-neon-cyan">添加一条明确、长期有效的记忆：</p>
                          <div className="flex gap-2">
                            <Select value={newMemoryCategory} onValueChange={(value: AgentMemory['category']) => setNewMemoryCategory(value)}>
                              <SelectTrigger className="h-8 w-24 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="identity">身份</SelectItem>
                                <SelectItem value="preference">偏好</SelectItem>
                                <SelectItem value="context">背景</SelectItem>
                                <SelectItem value="rule">规则</SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              autoFocus
                              placeholder="例如：爬虫数据导出 CSV 时默认使用 UTF-8 编码"
                              value={newMemoryContent}
                              onChange={(e) => setNewMemoryContent(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newMemoryContent.trim()) {
                                  createMemory.mutate({ content: newMemoryContent.trim(), category: newMemoryCategory })
                                }
                              }}
                              className="h-8 text-xs flex-1"
                            />
                            <Button
                              size="sm"
                              className="h-8 bg-cyber-neon-cyan text-white hover:bg-cyber-neon-cyan/90 font-medium shadow-xs"
                              disabled={!newMemoryContent.trim() || createMemory.isPending}
                              onClick={() => createMemory.mutate({ content: newMemoryContent.trim(), category: newMemoryCategory })}
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
                                    {memory.memory_key.startsWith('user_manual_') ? '手动固定' : memory.status === 'candidate' ? '待确认' : '自动提取'}
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
                                  {!memory.memory_key.startsWith('user_manual_') && memory.evidence_count > 1 ? <span>· {memory.evidence_count} 次依据</span> : null}
                                  {memory.status === 'candidate' ? <span>· 尚未用于对话</span> : null}
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
