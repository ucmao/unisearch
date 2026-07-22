import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Toaster } from 'sonner'
import { Button } from '@/components/ui/button'
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
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-14 shrink-0 items-center border-b border-cyber-border-subtle bg-cyber-bg-primary/90 px-4 backdrop-blur">
            <Button variant="ghost" onClick={() => setResultsContext(null)}>
              <ArrowLeft className="h-4 w-4" />返回任务
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden pt-3">
            <ResultWorkbench initialScope={`thread:${resultsContext.threadId}`} />
          </div>
        </div>
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
