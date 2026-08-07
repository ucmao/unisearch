import { Fragment, memo, useMemo, type ReactNode } from 'react'
import { type SourceCitationItem } from './CollapsibleSourcesBar'
import { usePlatformLabels } from '@/hooks/usePlatformCatalog'

function safeHref(value: string) {
  return /^(?:https?:\/\/|mailto:)/i.test(value) ? value : undefined
}

export function compressConsecutiveCitations(text: string, maxValidId: number = 500): string {
  if (!text) return text
  // 匹配连续出现的角标块，如 [S1] [S2] [S3] 或 （S1）（S2）
  const pattern = /(?:(?:\[\s*S?\d+\s*\]|（\s*S?\d+\s*）)\s*){2,}/gi

  return text.replace(pattern, (match) => {
    const matches = [...match.matchAll(/S?(\d+)/gi)]
    if (matches.length < 2) return match

    const numbers = matches.map((m) => parseInt(m[1], 10)).filter((n) => !isNaN(n) && n > 0 && n <= maxValidId)
    if (numbers.length < 2) return match

    const unique = Array.from(new Set(numbers)).sort((a, b) => a - b)
    const ranges: string[] = []
    let start = unique[0]
    let prev = unique[0]

    for (let i = 1; i < unique.length; i++) {
      const curr = unique[i]
      if (curr === prev + 1) {
        prev = curr
      } else {
        ranges.push(start === prev ? `[S${start}]` : `[S${start}-S${prev}]`)
        start = curr
        prev = curr
      }
    }
    ranges.push(start === prev ? `[S${start}]` : `[S${start}-S${prev}]`)

    return ranges.join(' ')
  })
}

function parseCitationGroup(innerText: string, maxValidId: number = 500): string[] {
  const parts = innerText.split(/[\s,;/&、，]+/).filter(Boolean)
  const result: string[] = []

  for (const part of parts) {
    const rangeMatch = part.match(/^S?(\d+)\s*[-–—]\s*S?(\d+)$/i)
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10)
      const end = parseInt(rangeMatch[2], 10)
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 50 && end <= maxValidId) {
        for (let i = start; i <= end; i++) {
          result.push(`S${i}`)
        }
      }
    } else {
      const singleMatch = part.match(/^S?(\d+)$/i)
      if (singleMatch) {
        const num = parseInt(singleMatch[1], 10)
        if (!isNaN(num) && num > 0 && num <= maxValidId) {
          result.push(`S${num}`)
        }
      }
    }
  }

  return Array.from(new Set(result))
}

function renderCitationGroup(
  citationIds: string[],
  keyPrefix: string,
  platformLabels: Record<string, string>,
  sources?: SourceCitationItem[],
  onCitationClick?: (sourceId: string) => void
) {
  if (citationIds.length === 0) return null

  const numbers = citationIds
    .map((id) => parseInt(id.replace(/\D/g, ''), 10))
    .filter((n) => !isNaN(n))
    .sort((a, b) => a - b)

  if (numbers.length === 0) return null

  // 按连续数字分组
  const continuousGroups: number[][] = []
  let currentGroup: number[] = [numbers[0]]

  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1]
    const curr = numbers[i]
    if (curr === prev + 1) {
      currentGroup.push(curr)
    } else {
      continuousGroups.push(currentGroup)
      currentGroup = [curr]
    }
  }
  continuousGroups.push(currentGroup)

  return (
    <Fragment key={keyPrefix}>
      {continuousGroups.map((group, groupIdx) => {
        const groupCitationIds = group.map((n) => `S${n}`)
        const start = group[0]
        const end = group[group.length - 1]
        const labelText = group.length === 1 ? `[S${start}]` : `[S${start}-S${end}]`

        const tooltipLines: string[] = []
        if (group.length === 1) {
          const sid = `S${start}`
          const matchedSource = (sources || []).find((s) => {
            const sidKey = (s.id || '').toUpperCase()
            return sidKey === sid || sidKey === String(start)
          })
          const platformName = matchedSource?.source
            ? platformLabels[matchedSource.source] || matchedSource.source
            : undefined
          tooltipLines.push(
            matchedSource
              ? `[${platformName || '资料'}] ${matchedSource.title || '未命名资料'}`
              : `查看 [${sid}] 出处`
          )
        } else {
          tooltipLines.push(`${labelText} 共引用 ${group.length} 个出处：`)
          groupCitationIds.slice(0, 10).forEach((sid) => {
            const matchedSource = (sources || []).find((s) => {
              const sidKey = (s.id || '').toUpperCase()
              return sidKey === sid || sidKey === sid.replace(/^S/i, '')
            })
            const title = matchedSource?.title || '未命名资料'
            tooltipLines.push(`• [${sid}] ${title}`)
          })
          if (group.length > 10) {
            tooltipLines.push(`... 等共 ${group.length} 项`)
          }
        }

        return (
          <button
            key={`${keyPrefix}-grp-${groupIdx}`}
            type="button"
            onClick={() => {
              const firstSid = `S${start}`
              const matchedSource = (sources || []).find((s) => {
                const sidKey = (s.id || '').toUpperCase()
                return sidKey === firstSid || sidKey === String(start)
              })
              if (matchedSource?.sourceUrl) {
                window.open(matchedSource.sourceUrl, '_blank')
              } else {
                onCitationClick?.(firstSid)
              }
            }}
            className="mx-0.5 inline-flex items-center justify-center font-mono text-[10px] text-cyber-neon-cyan/85 hover:text-cyber-neon-cyan hover:underline decoration-cyber-neon-cyan/50 transition-colors font-normal align-baseline cursor-pointer"
            title={tooltipLines.join('\n')}
          >
            {labelText}
          </button>
        )
      })}
    </Fragment>
  )
}

function inlineMarkdown(
  rawText: string,
  platformLabels: Record<string, string>,
  sources?: SourceCitationItem[],
  onCitationClick?: (sourceId: string) => void
): ReactNode[] {
  const maxValidId = sources && sources.length > 0 ? Math.max(sources.length + 10, 50) : 500
  const text = compressConsecutiveCitations(rawText, maxValidId)
  // Chinese prose commonly follows a URL without a space. Treat full-width
  // punctuation as a boundary so the link does not swallow the rest of a line.
  const pattern = /(<br\s*\/?>|\[[^\]]+\]\([^\s)]+\)|https?:\/\/[^\s<>"'\(\)（），。；：！？、【】《》「」『』]+|\[\s*S?\d+(?:[\s,–—/\-&、，]+S?\d+)*\s*\]|（\s*S?\d+(?:[\s,–—/\-&、，]+S?\d+)*\s*）|\bS\d+(?:[、,，]\s*S?\d+)+|\bS\d+[:：]|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`)/gi
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
      const citationIds = parseCitationGroup(inner, maxValidId)
      if (citationIds.length > 0) {
        nodes.push(renderCitationGroup(citationIds, `${index}-citation-${citationIds.join('-')}`, platformLabels, sources, onCitationClick))
      } else {
        // 检查是否是伪来源角标（如 100021）
        const numMatch = inner.match(/^S?(\d+)$/i)
        if (numMatch && parseInt(numMatch[1], 10) > maxValidId) {
          // 伪角标静默隐藏，不渲染在正文中
        } else {
          nodes.push(token)
        }
      }
    } else if (/^\bS\d+(?:[、,，]\s*S?\d+)+$/i.test(token)) {
      const citationIds = parseCitationGroup(token, maxValidId)
      if (citationIds.length > 0) {
        nodes.push(renderCitationGroup(citationIds, `${index}-citation-${citationIds.join('-')}`, platformLabels, sources, onCitationClick))
      } else {
        nodes.push(token)
      }
    } else if (/^\bS\d+[:：]$/i.test(token)) {
      const sid = token.slice(0, -1).toUpperCase()
      const colon = token.slice(-1)
      const citationIds = parseCitationGroup(sid, maxValidId)
      if (citationIds.length > 0) {
        nodes.push(renderCitationGroup([sid], `${index}-citation-${sid}`, platformLabels, sources, onCitationClick))
        nodes.push(colon + ' ')
      } else {
        nodes.push(token)
      }
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

export const MarkdownContent = memo(function MarkdownContent({
  content,
  sources,
  onCitationClick,
}: {
  content: string
  sources?: SourceCitationItem[]
  onCitationClick?: (sourceId: string) => void
}) {
  const platformLabels = usePlatformLabels()

  const blocks = useMemo(() => {
    const renderInline = (text: string) => inlineMarkdown(text, platformLabels, sources, onCitationClick)
    const lines = content.replace(/\r\n/g, '\n').split('\n')
    const result: ReactNode[] = []
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
        result.push(
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
        result.push(
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
        result.push(<hr key={`hr-${index}`} className="my-4 border-t border-cyber-border-subtle" />)
        index++
        continue
      }

      // 标题 (# 到 ######)
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        const level = heading[1].length
        const size = level === 1 ? 'text-base' : level === 2 ? 'text-sm font-bold' : 'text-xs font-semibold'
        result.push(<div key={`heading-${index}`} className={`mb-1 mt-3 font-semibold ${size}`}>{renderInline(heading[2])}</div>)
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
        result.push(
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
        result.push(<ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>)
        continue
      }

      // 有序列表
      if (/^\s*\d+[.)]\s+/.test(line)) {
        const items: string[] = []
        while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''))
        result.push(<ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ol>)
        continue
      }

      // 引用块
      if (/^>\s?/.test(line)) {
        const quote: string[] = []
        while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''))
        result.push(<blockquote key={`quote-${index}`} className="my-2 border-l-2 border-cyber-neon-cyan/50 pl-3 text-cyber-text-secondary">{quote.map((item, quoteIndex) => <Fragment key={quoteIndex}>{renderInline(item)}{quoteIndex < quote.length - 1 ? <br /> : null}</Fragment>)}</blockquote>)
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
      result.push(<p key={`p-${index}`} className="my-2 first:mt-0 last:mb-0">{paragraph.map((item, lineIndex) => <Fragment key={lineIndex}>{renderInline(item)}{lineIndex < paragraph.length - 1 ? <br /> : null}</Fragment>)}</p>)
    }
    return result
  }, [content, sources, platformLabels, onCitationClick])

  return <div className="break-words text-sm leading-6 text-cyber-text-primary">{blocks}</div>
})
