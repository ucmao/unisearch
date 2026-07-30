import { useState } from 'react'
import { usePlatformLabels } from '@/hooks/usePlatformCatalog'
import { ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'

export interface SourceCitationItem {
  id: string
  documentId?: string
  title: string
  source?: string
  sourceUrl?: string
  excerpt?: string
  score?: number
  fetchedAt?: string
  matchedQueries?: string[]
  selectionReason?: 'high_relevance' | 'preferred_type' | 'platform_representative' | 'kind_representative'
}

interface CollapsibleSourcesBarProps {
  sources: SourceCitationItem[]
  keywords?: string[]
  retrieval?: string
  onCitationClick?: (sourceId: string) => void
}


export function CollapsibleSourcesBar({ sources, keywords = [], retrieval, onCitationClick }: CollapsibleSourcesBarProps) {
  const [expanded, setExpanded] = useState(false)
  const platformLabels = usePlatformLabels()

  if (!sources || sources.length === 0) return null

  const validKeywords = Array.from(new Set((keywords || []).filter(Boolean))).slice(0, 8)
  const reasonLabels: Record<string, string> = {
    high_relevance: '高相关',
    preferred_type: '目标类型',
    platform_representative: '平台代表',
    kind_representative: '类型代表',
  }

  return (
    <div className="my-2 rounded-lg border border-cyber-border-subtle/50 bg-cyber-bg-tertiary/30 px-3 py-2 text-xs font-sans transition-all">
      {/* Header Bar - Collapsed by default */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-cyber-text-muted hover:text-cyber-text-primary transition-colors text-left font-normal select-none"
      >
        <span className="flex items-center gap-1.5">
          <span>
            {retrieval === 'live_search'
              ? `已实时检索，参考 ${sources.length} 个网页来源`
              : validKeywords.length > 0
              ? `已搜索 ${validKeywords.length} 个关键词，参考 ${sources.length} 篇资料`
              : retrieval === 'stratified_hybrid_rag'
                ? `已分层检索知识库，参考 ${sources.length} 个独立文档`
                : `已检索知识库，参考 ${sources.length} 篇资料`}
          </span>
        </span>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-cyber-text-muted" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cyber-text-muted" />
        )}
      </button>

      {/* Expanded List */}
      {expanded && (
        <div className="mt-2 space-y-2 border-t border-cyber-border-subtle/40 pt-2 animate-in fade-in duration-150">
          {validKeywords.length > 0 && (
            <div className="text-[11px] text-cyber-text-muted/80 font-sans">
              {validKeywords.map((kw) => `“${kw}”`).join('、、')}
            </div>
          )}

          <ol className="space-y-1.5 pl-0 text-xs list-none">
            {sources.map((source, index) => {
              const itemTitle = source.title || '未命名资料'
              const platformName = source.source ? (platformLabels[source.source] || source.source) : undefined

              return (
                <li key={source.id || index} className="flex items-center gap-1.5 leading-relaxed">
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] text-cyber-text-muted">
                    {index + 1}.
                  </span>
                  {platformName && (
                    <span className="rounded border border-cyber-border-subtle/60 bg-cyber-bg-tertiary px-1 py-0.5 text-[9px] font-mono text-cyber-neon-purple shrink-0 leading-none">
                      {platformName}
                    </span>
                  )}
                  {source.selectionReason ? (
                    <span className="rounded bg-cyber-neon-cyan/10 px-1 py-0.5 text-[9px] text-cyber-neon-cyan shrink-0 leading-none">
                      {reasonLabels[source.selectionReason] || source.selectionReason}
                    </span>
                  ) : null}
                  <div className="flex-1 min-w-0 flex items-center gap-1">
                    {source.sourceUrl ? (
                      <a
                        href={source.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-cyber-neon-cyan/90 hover:text-cyber-neon-cyan hover:underline transition-colors"
                        title={itemTitle}
                      >
                        {itemTitle}
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onCitationClick?.(source.id)}
                        className="truncate text-left text-cyber-neon-cyan/90 hover:text-cyber-neon-cyan hover:underline transition-colors"
                        title={`查看详情 [${source.id}]`}
                      >
                        {itemTitle}
                      </button>
                    )}
                    {source.sourceUrl && (
                      <ExternalLink className="h-3 w-3 shrink-0 opacity-40 text-cyber-text-muted inline-block ml-0.5" />
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
    </div>
  )
}
