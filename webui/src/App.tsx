import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { Toaster } from 'sonner'
import { checkEnvironmentInBackground } from '@/components/env/EnvironmentCheck'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'
import { CrawlerAuthNotice } from '@/components/crawler/CrawlerAuthNotice'
import { ArrowLeft, RefreshCw } from 'lucide-react'

const ResultWorkbench = lazy(async () => {
  const module = await import('@/components/analytics/ResultWorkbench')
  return { default: module.ResultWorkbench }
})

interface ErrorBoundaryProps {
  fallbackTitle?: string
  children: ReactNode
  onReset?: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center p-6 bg-cyber-bg-primary text-center">
          <div className="max-w-md space-y-4 rounded-2xl border border-cyber-border-default bg-cyber-bg-panel/95 p-6 shadow-2xl backdrop-blur-xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
              <span className="text-xl">⚠️</span>
            </div>
            <h2 className="text-base font-semibold text-cyber-text-primary">
              {this.props.fallbackTitle || '知识库加载遇到异常'}
            </h2>
            <p className="text-xs text-cyber-text-muted leading-relaxed break-words font-mono bg-cyber-bg-secondary/40 p-2.5 rounded-lg border border-cyber-border-subtle/50">
              {this.state.error?.message || '发生未知渲染错误'}
            </p>
            <div className="pt-2 flex items-center justify-center gap-3">
              {this.props.onReset && (
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, error: null })
                    this.props.onReset?.()
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-cyber-neon-cyan px-4 py-2 text-xs font-medium text-white shadow-xs hover:bg-cyber-neon-cyan/90 transition-all cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>返回任务</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, error: null })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/70 px-4 py-2 text-xs font-medium text-cyber-text-secondary hover:text-cyber-text-primary transition-all cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>重试</span>
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [resultsContext, setResultsContext] = useState<{ threadId?: string; planId?: string; scope?: string } | null>(null)

  useEffect(() => {
    void checkEnvironmentInBackground()
  }, [])

  return (
    <div className="relative h-screen overflow-hidden cyber-grid">
      {resultsContext ? (
        <ErrorBoundary onReset={() => setResultsContext(null)}>
          <Suspense fallback={<div className="h-full bg-cyber-bg" />}>
            <ResultWorkbench
              initialScope={resultsContext.scope || (resultsContext.planId ? `plan:${resultsContext.planId}` : resultsContext.threadId ? `thread:${resultsContext.threadId}` : 'all')}
              onBack={() => setResultsContext(null)}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <AgentWorkspace
          selectedId={selectedThreadId}
          onSelectedIdChange={setSelectedThreadId}
          onOpenResults={(context) => {
            if (context.threadId) {
              setSelectedThreadId(context.threadId)
            }
            setResultsContext(context)
          }}
        />
      )}

      <CrawlerAuthNotice />

      <Toaster
        position="top-center"
        duration={4000}
        toastOptions={{
          className: 'glass-panel font-mono text-cyber-text-primary',
          style: { fontFamily: 'JetBrains Mono, monospace' },
        }}
      />
    </div>
  )
}

export default App
