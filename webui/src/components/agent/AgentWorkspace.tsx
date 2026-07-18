import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Bot, CheckCircle2, ChevronRight, Clock3, Database, Download, FileText, KeyRound,
  Loader2, MessageSquarePlus, Play, Plus, RefreshCw, Send, Settings2,
  Sparkles, Trash2, User, XCircle,
} from 'lucide-react'
import { agentApi, type AgentMessage, type AgentPlan, type ModelProfile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书', dy: '抖音', ks: '快手', bili: '哔哩哔哩', wb: '微博', tieba: '百度贴吧', zhihu: '知乎',
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_confirmation: '等待确认', queued: '排队中', running: '采集中', completed: '已完成',
  partially_completed: '部分完成', failed: '失败', stopped: '已停止',
}

function getError(error: any) {
  return error?.response?.data?.detail || error?.message || '操作失败'
}

function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function ModelSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const profileQuery = useQuery({ queryKey: ['agent-model-profile'], queryFn: async () => (await agentApi.getModelProfile()).data, enabled: open })
  const [form, setForm] = useState<Partial<ModelProfile> & { apiKey?: string }>({})

  useEffect(() => {
    if (profileQuery.data) setForm({ ...profileQuery.data, apiKey: '' })
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
    onSuccess: (data) => toast.success(`${data.message} · ${data.latency_ms}ms`),
    onError: (error) => toast.error(`连接失败：${getError(error)}`),
  })

  const applyProvider = (provider: ModelProfile['provider']) => {
    const presets = {
      minimax: { baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M2.7' },
      deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
      custom: { baseUrl: form.baseUrl || '', model: form.model || '' },
    }
    setForm((current) => ({ ...current, provider, ...presets[provider] }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-cyber-bg-panel">
        <DialogHeader>
          <DialogTitle>本地模型配置</DialogTitle>
          <DialogDescription>模型凭证保存在本机。采集数据只会在你发起AI分析时发送给所配置的服务。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(['minimax', 'deepseek', 'custom'] as const).map((provider) => (
              <button key={provider} type="button" onClick={() => applyProvider(provider)}
                className={`rounded-lg border px-3 py-2 text-xs transition-colors ${form.provider === provider ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'border-cyber-border-subtle text-cyber-text-secondary hover:border-cyber-border-default'}`}>
                {provider === 'minimax' ? 'MiniMax' : provider === 'deepseek' ? 'DeepSeek' : '自定义兼容接口'}
              </button>
            ))}
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-cyber-text-secondary">API Base URL</span>
            <Input value={form.baseUrl || ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs text-cyber-text-secondary">模型名称</span>
            <Input value={form.model || ''} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="模型 ID" />
          </label>
          <label className="block space-y-1.5">
            <span className="flex items-center justify-between text-xs text-cyber-text-secondary">
              <span>API Key</span><span className="text-[10px]">{form.apiKeyConfigured ? '已配置，留空表示不修改' : '尚未配置'}</span>
            </span>
            <Input type="password" value={form.apiKey || ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.apiKeyConfigured ? '••••••••••••••••' : '填写你的 API Key'} />
          </label>
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || save.isPending}>
            {test.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}测试连接
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || test.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-cyber-neon-cyan" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-cyber-neon-green" />
  if (status === 'failed' || status === 'stopped') return <XCircle className="h-4 w-4 text-cyber-neon-pink" />
  return <Clock3 className="h-4 w-4 text-cyber-text-muted" />
}

function PlanCard({ plan, onExecute, executing, onOpenResults }: {
  plan: AgentPlan; onExecute: () => void; executing: boolean; onOpenResults: () => void
}) {
  const done = plan.steps.filter((step) => step.status === 'completed').length
  const progress = plan.steps.length ? Math.round(done / plan.steps.length * 100) : 0
  const canExecute = ['awaiting_confirmation', 'failed', 'partially_completed'].includes(plan.status)
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-cyber-neon-cyan/25 bg-cyber-bg-secondary/55">
      <div className="border-b border-cyber-border-subtle px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyber-neon-cyan" /><span className="text-sm font-medium">采集执行计划</span></div>
          <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[plan.status] || plan.status}</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-cyber-text-secondary">{plan.plan.goal}</p>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <div><p className="text-[10px] uppercase tracking-wider text-cyber-text-muted">关键词</p><div className="mt-1.5 flex flex-wrap gap-1.5">{plan.plan.keywords.map((item) => <Badge key={item} variant="outline">{item}</Badge>)}</div></div>
        <div><p className="text-[10px] uppercase tracking-wider text-cyber-text-muted">分析目标</p><p className="mt-1.5 text-xs text-cyber-text-secondary">{plan.plan.analysis.join(' · ')}</p></div>
      </div>
      <div className="space-y-2 border-t border-cyber-border-subtle px-4 py-3">
        {plan.steps.map((step) => (
          <div key={step.step_id} className="flex items-center gap-3 text-xs">
            <StepIcon status={step.status} />
            <span className="w-20 text-cyber-text-primary">{PLATFORM_LABELS[step.platform] || step.platform}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-cyber-bg-tertiary"><div className={`h-full rounded-full ${step.status === 'completed' ? 'w-full bg-cyber-neon-green' : step.status === 'running' ? 'w-2/3 animate-pulse bg-cyber-neon-cyan' : step.status === 'failed' ? 'w-full bg-cyber-neon-pink' : 'w-0'}`} /></div>
            <span className="w-14 text-right text-[10px] text-cyber-text-muted">{STATUS_LABELS[step.status] || step.status}</span>
          </div>
        ))}
        {['queued', 'running'].includes(plan.status) ? <p className="pt-1 text-[10px] text-cyber-text-muted">已完成 {done}/{plan.steps.length} · 本机最多同时执行2个平台</p> : null}
      </div>
      <div className="flex items-center justify-between border-t border-cyber-border-subtle bg-cyber-bg-tertiary/20 px-4 py-3">
        <span className="text-[10px] text-cyber-text-muted">评论 {plan.plan.collectComments ? '开启' : '关闭'} · 浏览器 {plan.plan.headless ? '后台模式' : '可见模式'}</span>
        {canExecute ? <Button size="sm" onClick={onExecute} disabled={executing}><Play />{plan.status === 'awaiting_confirmation' ? '确认并执行' : '重试失败步骤'}</Button> : null}
        {['completed', 'partially_completed'].includes(plan.status) ? <Button size="sm" variant="outline" onClick={onOpenResults}><Database />查看结果</Button> : null}
      </div>
      {plan.status === 'running' ? <div className="h-0.5 bg-cyber-bg-tertiary"><div className="h-full bg-cyber-neon-cyan transition-all" style={{ width: `${Math.max(8, progress)}%` }} /></div> : null}
    </div>
  )
}

function MessageBubble({ message, plan, onExecute, executing, onOpenResults }: {
  message: AgentMessage; plan: AgentPlan | null; onExecute: () => void; executing: boolean; onOpenResults: () => void
}) {
  const isUser = message.role === 'user'
  return (
    <div className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10"><Bot className="h-4 w-4 text-cyber-neon-cyan" /></div>}
      <div className={`max-w-[780px] ${isUser ? 'rounded-2xl rounded-tr-sm bg-cyber-neon-cyan/12 px-4 py-3' : 'min-w-0 flex-1'}`}>
        <div className="whitespace-pre-wrap text-sm leading-6 text-cyber-text-primary">{message.content}</div>
        {message.kind === 'plan' && plan && message.metadata?.plan_id === plan.plan_id
          ? <PlanCard plan={plan} onExecute={onExecute} executing={executing} onOpenResults={onOpenResults} /> : null}
        <p className={`mt-1.5 text-[9px] text-cyber-text-muted ${isUser ? 'text-right' : ''}`}>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.created_at))}</p>
      </div>
      {isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-bg-tertiary"><User className="h-4 w-4 text-cyber-text-secondary" /></div>}
    </div>
  )
}

export function AgentWorkspace({ onOpenResults, onOpenManual }: { onOpenResults: () => void; onOpenManual: () => void }) {
  const client = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const autoCreateStartedRef = useRef(false)
  const threadsQuery = useQuery({ queryKey: ['agent-threads'], queryFn: async () => (await agentApi.listThreads()).data.items, refetchInterval: 3000 })
  const threadQuery = useQuery({ queryKey: ['agent-thread', selectedId], queryFn: async () => (await agentApi.getThread(selectedId!)).data, enabled: Boolean(selectedId), refetchInterval: 1500 })

  const create = useMutation({ mutationFn: async () => (await agentApi.createThread()).data, onSuccess: (thread) => { setSelectedId(thread.thread_id); client.invalidateQueries({ queryKey: ['agent-threads'] }) } })
  const remove = useMutation({ mutationFn: (id: string) => agentApi.deleteThread(id), onSuccess: () => { setSelectedId(null); client.invalidateQueries({ queryKey: ['agent-threads'] }) } })
  const send = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => agentApi.sendMessage(id, content),
    onSuccess: ({ data }) => { client.setQueryData(['agent-thread', data.thread_id], data); client.invalidateQueries({ queryKey: ['agent-threads'] }) },
    onError: (error) => toast.error(getError(error)),
  })
  const execute = useMutation({
    mutationFn: (planId: string) => agentApi.executePlan(planId),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['agent-thread', selectedId] }); toast.success('任务已进入本地执行队列') },
    onError: (error) => toast.error(getError(error)),
  })

  useEffect(() => {
    if (!selectedId && threadsQuery.data?.length) setSelectedId(threadsQuery.data[0].thread_id)
    if (!selectedId && threadsQuery.data && !threadsQuery.data.length && !create.isPending && !autoCreateStartedRef.current) {
      autoCreateStartedRef.current = true
      create.mutate()
    }
  }, [threadsQuery.data, selectedId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [threadQuery.data?.messages.length, send.isPending])

  const submit = () => {
    const content = input.trim()
    if (!content || !selectedId || send.isPending) return
    setInput('')
    send.mutate({ id: selectedId, content })
  }
  const activePlan = threadQuery.data?.plan || null
  const runningCount = useMemo(() => activePlan?.steps.filter((step) => step.status === 'running').length || 0, [activePlan])

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-[270px] shrink-0 flex-col border-r border-cyber-border-subtle bg-cyber-bg-secondary/45 md:flex">
        <div className="p-3"><Button className="w-full justify-start" variant="outline" onClick={() => create.mutate()} disabled={create.isPending}><Plus />新建任务</Button></div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {threadsQuery.data?.map((thread) => (
            <button key={thread.thread_id} type="button" onClick={() => setSelectedId(thread.thread_id)}
              className={`group w-full rounded-lg px-3 py-2.5 text-left transition-colors ${selectedId === thread.thread_id ? 'bg-cyber-neon-cyan/10 text-cyber-text-primary' : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary/60'}`}>
              <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-medium">{thread.title}</span>{thread.plan_status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyber-neon-green" />}</div>
              <p className="mt-1 truncate text-[10px] text-cyber-text-muted">{thread.last_message || '暂无消息'}</p>
              <p className="mt-1 text-[9px] text-cyber-text-muted">{timeAgo(thread.updated_at)}</p>
            </button>
          ))}
        </div>
        <div className="space-y-1 border-t border-cyber-border-subtle p-2">
          <button onClick={onOpenManual} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary"><Settings2 className="h-4 w-4" />手动采集控制</button>
          <button onClick={() => setSettingsOpen(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary"><KeyRound className="h-4 w-4" />模型设置</button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-cyber-bg-primary/40">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-cyber-border-subtle px-4 sm:px-6">
          <div className="min-w-0"><h1 className="truncate text-sm font-medium">{threadQuery.data?.title || 'UniSearch Agent'}</h1><p className="mt-0.5 text-[10px] text-cyber-text-muted">{runningCount ? `${runningCount} 个平台正在采集` : '本地任务 · 数据保存在当前设备'}</p></div>
          <div className="flex items-center gap-1">
            <Button className="md:hidden" size="icon" variant="ghost" onClick={() => create.mutate()}><MessageSquarePlus /></Button>
            <Button size="icon" variant="ghost" onClick={() => setSettingsOpen(true)} title="模型设置"><Settings2 /></Button>
            {selectedId && <Button size="icon" variant="ghost" onClick={() => { if (confirm('删除这个任务及其对话和计划？')) remove.mutate(selectedId) }} title="删除任务"><Trash2 /></Button>}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-8">
            {threadQuery.isLoading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-cyber-neon-cyan" /></div> : null}
            {threadQuery.data?.messages.map((message) => <MessageBubble key={message.message_id} message={message} plan={activePlan} executing={execute.isPending} onExecute={() => activePlan && execute.mutate(activePlan.plan_id)} onOpenResults={onOpenResults} />)}
            {send.isPending && <div className="flex items-center gap-3 text-xs text-cyber-text-muted"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10"><Bot className="h-4 w-4 text-cyber-neon-cyan" /></div><Loader2 className="h-4 w-4 animate-spin" />AI 正在理解你的消息…</div>}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-cyber-border-subtle bg-cyber-bg-primary/90 px-4 py-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-4xl">
            <div className="relative rounded-xl border border-cyber-border-default bg-cyber-bg-panel shadow-sm focus-within:border-cyber-neon-cyan/50">
              <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                placeholder={activePlan && ['completed', 'partially_completed'].includes(activePlan.status) ? '继续提问，例如：分析负面评价的主要原因…' : '可以先聊聊，也可以描述想调研的主题…'}
                className="min-h-[88px] w-full resize-none bg-transparent px-4 py-3 pr-14 text-sm outline-none placeholder:text-cyber-text-muted" />
              <Button size="icon" className="absolute bottom-3 right-3 h-9 w-9" onClick={submit} disabled={!input.trim() || send.isPending}><Send /></Button>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-cyber-text-muted"><span>Enter 发送 · Shift+Enter 换行</span><span>只有明确的调研需求才会生成计划，确认后开始采集</span></div>
          </div>
        </div>
      </main>

      <aside className="hidden w-[250px] shrink-0 border-l border-cyber-border-subtle bg-cyber-bg-secondary/30 p-4 xl:block">
        <p className="text-[10px] uppercase tracking-[0.16em] text-cyber-text-muted">当前任务</p>
        {activePlan ? <div className="mt-4 space-y-5">
          <div><p className="text-xs font-medium">{STATUS_LABELS[activePlan.status] || activePlan.status}</p><p className="mt-1 text-[10px] text-cyber-text-muted">{activePlan.steps.length}个平台 · {activePlan.plan.keywords.length}个关键词</p></div>
          <div><p className="text-[10px] text-cyber-text-muted">数据采集</p><div className="mt-2 space-y-2">{activePlan.steps.map((step) => <div key={step.step_id} className="flex items-center justify-between text-xs"><span>{PLATFORM_LABELS[step.platform]}</span><StepIcon status={step.status} /></div>)}</div></div>
          <div className="space-y-2"><Button variant="outline" className="w-full justify-start" onClick={onOpenResults}><Database />结果看板<ChevronRight className="ml-auto" /></Button>
            {activePlan.steps.some((step) => step.run_id) && <a className="flex h-9 items-center gap-2 rounded-md border border-cyber-border-default px-3 text-xs hover:border-cyber-neon-cyan/50" href={agentApi.getPlanExportUrl(activePlan.plan_id)}><Download className="h-4 w-4" />导出全部平台</a>}</div>
        </div> : <div className="mt-8 text-center"><FileText className="mx-auto h-8 w-8 text-cyber-text-muted" /><p className="mt-3 text-xs text-cyber-text-muted">发送需求后，这里会显示任务范围和执行状态。</p></div>}
      </aside>
      <ModelSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
