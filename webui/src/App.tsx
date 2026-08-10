import { lazy, Suspense, useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { checkEnvironmentInBackground } from '@/components/env/EnvironmentCheck'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'
import { CrawlerAuthNotice } from '@/components/crawler/CrawlerAuthNotice'

const ResultWorkbench = lazy(async () => {
  const module = await import('@/components/analytics/ResultWorkbench')
  return { default: module.ResultWorkbench }
})

function App() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [resultsContext, setResultsContext] = useState<{ threadId: string; planId: string } | null>(null)

  useEffect(() => {
    void checkEnvironmentInBackground()
  }, [])

  return (
    <div className="relative h-screen overflow-hidden cyber-grid">
      {resultsContext ? (
        <Suspense fallback={<div className="h-full bg-cyber-bg" />}>
          <ResultWorkbench
            initialScope={`thread:${resultsContext.threadId}`}
            onBack={() => setResultsContext(null)}
          />
        </Suspense>
      ) : (
        <AgentWorkspace
          selectedId={selectedThreadId}
          onSelectedIdChange={setSelectedThreadId}
          onOpenResults={(context) => {
            setSelectedThreadId(context.threadId)
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
