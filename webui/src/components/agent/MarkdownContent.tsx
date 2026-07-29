import { Fragment, type ReactNode } from 'react'
import { type SourceCitationItem } from './CollapsibleSourcesBar'
import { usePlatformLabels } from '@/hooks/usePlatformCatalog'

function safeHref(value: string) {
  return /^(?:https?:\/\/|mailto:)/i.test(value) ? value : undefined
}

function parseCitationGroup(innerText: string): string[] {
  const parts = innerText.split(/[\s,;/&、，]+/).filter(Boolean)
  const result: string[] = []

  for (const part of parts) {
    const rangeMatch = part.match(/^S?(\d+)\s*[-–—]\s*S?(\d+)$/i)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 20) {
        for (let i = start; i <= end; i++) {
          result.push(`S${i}`)
        }
      } else {
        result.push(`S${start}`, `S${end}`)
      }
    } else {
      const singleMatch = part.match(/^S?(\d+)$/i)
      if (singleMatch) {
        result.push(`S${singleMatch[1]}`)
      }
    }
  }

  return Array.from(new Set(result))
}

function renderCitationButton(
  sourceId: string,
  keyPrefix: string,
  platformLabels: Record<string, string>,
  sources?: SourceCitationItem[],
  onCitationClick?: (sourceId: string) => void
) {
  const matchedSource = (sources || []).find((s) => {
    const sid = (s.id || '').toUpperCase()
    return sid === sourceId || sid === sourceId.replace(/^S/i, '')
  })
  const platformName = matchedSource?.source
    ? platformLabels[matchedSource.source] || matchedSource.source
    : undefined
  const tooltipText = matchedSource
    ? `[${platformName || '资料'}] ${matchedSource.title || '未命名资料'}`
    : `查看 [${sourceId}] 出处`

  return (
    <button
      key={keyPrefix}
      type="button"
      onClick={() => {
        if (matchedSource?.sourceUrl) {
          window.open(matchedSource.sourceUrl, '_blank')
        } else {
          onCitationClick?.(sourceId)
        }
      }}
      className="mx-0.5 inline-flex items-center justify-center font-mono text-[10px] text-cyber-neon-cyan/85 hover:text-cyber-neon-cyan hover:underline decoration-cyber-neon-cyan/50 transition-colors font-normal align-baseline cursor-pointer"
      title={tooltipText}
    >
      [{sourceId}]
    </button>
  )
}

function inlineMarkdown(
  text: string,
  platformLabels: Record<string, string>,
  sources?: SourceCitationItem[],
  onCitationClick?: (sourceId: string) => void
): ReactNode[] {
  const pattern = /(<br\s*\/?>|\[[^\]]+\]\([^\s)]+\)|https?:\/\/[^\s<>"'\(\)]+|\[\s*S?\d+(?:[\s,–—/\-&、，]+S?\d+)*\s*\]|（\s*S?\d+(?:[\s,–—/\-&、，]+S?\d+)*\s*）|\bS\d+(?:[、,，]\s*S?\d+)+|\bS\d+[:：]|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`)/gi
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    const token = match[0]

    if (/<br\s*\/?>/i.test(token)) {
      nodes.push(<br key={`${index}-br`} />)
    } else if (token.startsWith('[') && token.includes('](')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = link ? safeHref(link[2]) : undefined
      nodes.push(
        href ? (
          <a
            key={`${index}-link`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-cyber-neon-cyan underline decoration-cyber-neon-cyan/40 underline-offset-2 hover:decoration-cyber-neon-cyan"
          >
            {link![1]}
          </a>
        ) : (
          token
        )
      )
    } else if (/^https?:\/\//i.test(token)) {
      let cleanUrl = token
      let trailingPunct = ''
      const punctMatch = token.match(/([.,;:!?)]+)$/)
      if (punctMatch) {
        trailingPunct = punctMatch[1]
        cleanUrl = token.slice(0, -punctMatch[1].length)
      }
      const href = safeHref(cleanUrl)
      nodes.push(
        <Fragment key={`${index}-bare-url`}>
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-cyber-neon-cyan underline decoration-cyber-neon-cyan/40 underline-offset-2 hover:decoration-cyber-neon-cyan break-all"
            >
              {cleanUrl}
            </a>
          ) : (
            cleanUrl
          )}
          {trailingPunct}
        </Fragment>
      )
    } else if ((token.startsWith('[') && token.endsWith(']')) || (token.startsWith('（') && token.endsWith('）'))) {
      const inner = token.slice(1, -1).trim()
      const citationIds = parseCitationGroup(inner)
      if (citationIds.length > 0) {
        citationIds.forEach((sid, idx) => {
          nodes.push(renderCitationButton(sid, `${index}-citation-${sid}-${idx}`, platformLabels, sources, onCitationClick))
        })
      } else {
        nodes.push(token)
      }
    } else if (/^\bS\d+(?:[、,，]\s*S?\d+)+$/i.test(token)) {
      const citationIds = parseCitationGroup(token)
      if (citationIds.length > 0) {
        citationIds.forEach((sid, idx) => {
          nodes.push(renderCitationButton(sid, `${index}-citation-${sid}-${idx}`, platformLabels, sources, onCitationClick))
        })
      } else {
        nodes.push(token)
      }
    } else if (/^\bS\d+[:：]$/i.test(token)) {
      const sid = token.slice(0, -1).toUpperCase()
      const colon = token.slice(-1)
      nodes.push(renderCitationButton(sid, `${index}-citation-${sid}`, platformLabels, sources, onCitationClick))
      nodes.push(colon + ' ')
    } else if (token.startsWith('***')) {
      nodes.push(<strong key={`${index}-strong-italic`} className="font-semibold italic text-cyber-text-primary">{token.slice(3, -3)}</strong>)
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={`${index}-strong`} className="font-semibold text-cyber-text-primary">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~')) {
      nodes.push(<del key={`${index}-del`} className="line-through opacity-75">{token.slice(2, -2)}</del>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`${index}-code`} className="rounded bg-cyber-bg-tertiary px-1.5 py-0.5 font-mono text-[0.9em] text-cyber-neon-cyan">{token.slice(1, -1)}</code>)
    } else {
      nodes.push(token)
    }
    cursor = index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function MarkdownContent({
  content,
  sources,
  onCitationClick,
}: {
  content: string
  sources?: SourceCitationItem[]
  onCitationClick?: (sourceId: string) => void
}) {
  const platformLabels = usePlatformLabels()
  const renderInline = (text: string) => inlineMarkdown(text, platformLabels, sources, onCitationClick)
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }

    // 折叠块 <details> ... </details>
    if (/^\s*<details>/i.test(line)) {
      const detailLines: string[] = []
      index++
      while (index < lines.length && !/^\s*<\/details>/i.test(lines[index])) {
        detailLines.push(lines[index++])
      }
      if (index < lines.length) index++
      let summaryText = '参考资料'
      const innerLines: string[] = []
      for (const dl of detailLines) {
        const sumMatch = dl.match(/<summary>(.*?)<\/summary>/i)
        if (sumMatch) {
          summaryText = sumMatch[1].trim()
        } else {
          innerLines.push(dl)
        }
      }
      blocks.push(
        <details key={`details-${index}`} className="my-2 rounded-lg border border-cyber-border-subtle/50 bg-cyber-bg-tertiary/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-normal text-cyber-text-muted hover:text-cyber-text-primary select-none">
            {summaryText}
          </summary>
          <div className="mt-2 border-t border-cyber-border-subtle/40 pt-2 space-y-1">
            <MarkdownContent content={innerLines.join('\n')} sources={sources} onCitationClick={onCitationClick} />
          </div>
        </details>
      )
      continue
    }

    // 多行代码块 ```language ... ```
    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const code: string[] = []
      index++
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) code.push(lines[index++])
      if (index < lines.length) index++
      blocks.push(
        <div key={`code-${index}`} className="my-3 overflow-hidden rounded-lg border border-cyber-border-subtle bg-cyber-bg-tertiary">
          {language ? (
            <div className="border-b border-cyber-border-subtle bg-cyber-bg-secondary/40 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-cyber-text-muted">
              {language}
            </div>
          ) : null}
          <pre className="overflow-x-auto p-3 text-xs leading-5"><code className="font-mono text-cyber-text-primary">{code.join('\n')}</code></pre>
        </div>,
      )
      continue
    }

    // 分隔线 (---, ***, ___)
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`hr-${index}`} className="my-4 border-t border-cyber-border-subtle" />)
      index++
      continue
    }

    // 标题 (# 到 ######)
    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const size = level === 1 ? 'text-base' : level === 2 ? 'text-sm font-bold' : 'text-xs font-semibold'
      blocks.push(<div key={`heading-${index}`} className={`mb-1 mt-3 font-semibold ${size}`}>{renderInline(heading[2])}</div>)
      index++
      continue
    }

    // 表格
    const nextLine = lines[index + 1] || ''
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine)) {
      const splitRow = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
      const headers = splitRow(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(splitRow(lines[index++]))
      blocks.push(
        <div key={`table-${index}`} className="my-3 overflow-x-auto rounded-lg border border-cyber-border-subtle">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-cyber-bg-tertiary/70"><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-cyber-border-subtle px-3 py-2 font-semibold">{renderInline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-cyber-border-subtle/60 last:border-0">{headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-cyber-text-secondary">{renderInline(row[cellIndex] || '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ''))
      blocks.push(<ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>)
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ol>)
      continue
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={`quote-${index}`} className="my-2 border-l-2 border-cyber-neon-cyan/50 pl-3 text-cyber-text-secondary">{quote.map((item, quoteIndex) => <Fragment key={quoteIndex}>{renderInline(item)}{quoteIndex < quote.length - 1 ? <br /> : null}</Fragment>)}</blockquote>)
      continue
    }

    // 普通段落
    const paragraph: string[] = [line]
    index++
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(?:#{1,6}\s|\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?|\s*```|\s*(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(lines[index]) &&
      !(lines[index].includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || '')) &&
      !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index])
    ) paragraph.push(lines[index++])
    blocks.push(<p key={`p-${index}`} className="my-2 first:mt-0 last:mb-0">{paragraph.map((item, lineIndex) => <Fragment key={lineIndex}>{renderInline(item)}{lineIndex < paragraph.length - 1 ? <br /> : null}</Fragment>)}</p>)
  }
  return <div className="break-words text-sm leading-6 text-cyber-text-primary">{blocks}</div>
}
