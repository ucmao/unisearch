import { useEffect, useState } from 'react'
import { Toaster } from 'sonner'
import { checkEnvironmentInBackground } from '@/components/env/EnvironmentCheck'
import { ResultWorkbench } from '@/components/analytics/ResultWorkbench'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'
import { CrawlerAuthNotice } from '@/components/crawler/CrawlerAuthNotice'

function App() {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [resultsContext, setResultsContext] = useState<{ threadId: string; planId: string } | null>(null)

  useEffect(() => {
    void checkEnvironmentInBackground()
  }, [])

  return (
    <div className="relative h-screen overflow-hidden cyber-grid">
      {resultsContext ? (
        <ResultWorkbench
          initialScope={`thread:${resultsContext.threadId}`}
          onBack={() => setResultsContext(null)}
        />
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

        position="top-right"
        toastOptions={{
          className: 'glass-panel font-mono text-cyber-text-primary',
          style: { fontFamily: 'JetBrains Mono, monospace' },
        }}
      />
    </div>
  )
}

export default App
