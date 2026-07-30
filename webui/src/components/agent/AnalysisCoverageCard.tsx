import { BarChart3, BookOpenText, CheckCircle2, Clock3, Quote } from 'lucide-react'
import type { AnalysisCoverage } from '@/lib/api'

function percentage(value: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)))
}

function CoverageMetric({
  label,
  value,
  total,
  description,
  tone,
}: {
  label: string
  value: number
  total: number
  description: string
  tone: 'complete' | 'representative'
}) {
  const rate = percentage(value, total)
  const isComplete = tone === 'complete'
  return (
    <div className="rounded-lg border border-cyber-border-subtle/60 bg-cyber-bg-panel/45 p-2.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-medium text-cyber-text-primary">
          {isComplete
            ? <BarChart3 className="h-3.5 w-3.5 text-cyber-neon-green" />
            : <BookOpenText className="h-3.5 w-3.5 text-amber-400" />}
          {label}
        </span>
        <span className="font-mono text-cyber-text-primary">
          {value}/{total} · {rate}%
        </span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-cyber-bg-tertiary"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rate}
      >
        <div
          className={`h-full rounded-full ${isComplete ? 'bg-cyber-neon-green' : 'bg-amber-400'}`}
          style={{ width: `${rate}%` }}
        />
      </div>
      <p className="mt-1.5 leading-4 text-cyber-text-muted">{description}</p>
    </div>
  )
}

export function AnalysisCoverageCard({ coverage }: { coverage: AnalysisCoverage }) {
  const qualitativeIsFull = coverage.qualitativelyAnalyzedDocumentCount === coverage.collectedDocumentCount

  return (
    <section
      className="mb-2 rounded-xl border border-amber-400/25 bg-amber-400/5 p-3 text-[11px]"
      aria-label="分析覆盖范围"
    >
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-cyber-text-primary">分析覆盖范围</span>
          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-400">
            {coverage.partial ? '阶段性快速分析' : '快速分析'}
          </span>
        </div>
        <span className="flex items-center gap-1 text-cyber-text-muted">
          {coverage.partial
            ? <Clock3 className="h-3.5 w-3.5 text-amber-400" />
            : <CheckCircle2 className="h-3.5 w-3.5 text-cyber-neon-green" />}
          {coverage.partial ? '采集尚未完成，结果可能继续变化' : `共采集 ${coverage.collectedDocumentCount} 个去重文档`}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <CoverageMetric
          label="数字统计覆盖"
          value={coverage.statisticallyAnalyzedDocumentCount}
          total={coverage.collectedDocumentCount}
          description="样本量、数量、比例、分布和字段覆盖均基于这些文档。"
          tone="complete"
        />
        <CoverageMetric
          label="定性阅读覆盖"
          value={coverage.qualitativelyAnalyzedDocumentCount}
          total={coverage.collectedDocumentCount}
          description={qualitativeIsFull
            ? '全部文档均参与主题、观点、原因和建议的归纳。'
            : '主题、观点、原因和建议基于分层选取的代表性文档，不等于逐篇阅读全部数据。'}
          tone="representative"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-cyber-border-subtle/40 pt-2 text-cyber-text-muted">
        <span>代表文档 <strong className="font-mono text-cyber-text-primary">{coverage.evidenceDocumentCount}</strong></span>
        <span>证据片段 <strong className="font-mono text-cyber-text-primary">{coverage.evidenceChunkCount}</strong></span>
        <span className="flex items-center gap-1">
          <Quote className="h-3 w-3" />
          正文实际引用 <strong className="font-mono text-cyber-text-primary">{coverage.citedDocumentCount}</strong> 个文档
        </span>
      </div>
    </section>
  )
}
