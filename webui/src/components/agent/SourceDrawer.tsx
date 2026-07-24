import { X, ExternalLink, FileText, CheckCircle2, ShieldAlert } from 'lucide-react'

export interface SourceCitation {
  id: string
  documentId: string
  title: string
  source: string
  sourceUrl?: string
  excerpt: string
  score?: number
}

interface SourceDrawerProps {
  isOpen: boolean
  onClose: () => void
  citation: SourceCitation | null
}

export function SourceDrawer({ isOpen, onClose, citation }: SourceDrawerProps) {
  if (!isOpen || !citation) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-cyber-border-subtle bg-cyber-bg-secondary/95 shadow-2xl backdrop-blur-md transition-all duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyber-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center rounded border border-cyber-neon-cyan/50 bg-cyber-neon-cyan/20 px-2 py-0.5 font-mono text-xs font-bold text-cyber-neon-cyan">
            {citation.id}
          </span>
          <h3 className="font-medium text-cyber-text-primary">引用资料出处</h3>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-cyber-text-muted transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"
          title="关闭"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Document Title & Meta */}
        <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-tertiary/60 p-3">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-cyber-neon-cyan" />
            <div className="space-y-1">
              <h4 className="font-semibold text-sm text-cyber-text-primary leading-snug">
                {citation.title || '未命名资料'}
              </h4>
              <div className="flex items-center gap-2 text-xs text-cyber-text-muted">
                <span className="rounded bg-cyber-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-cyber-neon-purple uppercase">
                  {citation.source || 'Knowledge Asset'}
                </span>
                {citation.score !== undefined && (
                  <span className="text-[10px] text-emerald-400 font-mono">
                    匹配度: {(citation.score * 100).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Excerpt Section */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-cyber-text-secondary">
            <span>出处原文字段摘要</span>
            <span className="flex items-center gap-1 text-[10px] text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> 已验证落库
            </span>
          </div>
          <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/80 p-3 text-xs leading-relaxed text-cyber-text-secondary font-mono whitespace-pre-wrap">
            {citation.excerpt || '无摘录内容'}
          </div>
        </div>

        {/* Link Out Action */}
        {citation.sourceUrl ? (
          <a
            href={citation.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 px-4 py-2.5 text-xs font-semibold text-cyber-neon-cyan transition-all hover:bg-cyber-neon-cyan/20 hover:text-white"
          >
            <span>在源平台中查看原文网页</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <div className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
            <span>此资料为本地离线/嵌入文件，无外部链接</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-cyber-border-subtle px-4 py-2.5 text-center text-[10px] text-cyber-text-muted font-mono">
        UniSearch RAG Knowledge Proof & Source Citation
      </div>
    </div>
  )
}
