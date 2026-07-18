import { Fragment, type ReactNode } from 'react'

function safeHref(value: string) {
  return /^(?:https?:\/\/|mailto:)/i.test(value) ? value : undefined
}

function inlineMarkdown(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(text.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${index}-strong`} className="font-semibold text-cyber-text-primary">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`${index}-code`} className="rounded bg-cyber-bg-tertiary px-1.5 py-0.5 font-mono text-[0.9em] text-cyber-neon-cyan">{token.slice(1, -1)}</code>)
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      const href = link ? safeHref(link[2]) : undefined
      nodes.push(href
        ? <a key={`${index}-link`} href={href} target="_blank" rel="noreferrer" className="text-cyber-neon-cyan underline decoration-cyber-neon-cyan/40 underline-offset-2 hover:decoration-cyber-neon-cyan">{link![1]}</a>
        : token)
    }
    cursor = index + token.length
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function MarkdownContent({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }

    if (line.trimStart().startsWith('```')) {
      const language = line.trim().slice(3)
      const code: string[] = []
      index++
      while (index < lines.length && !lines[index].trimStart().startsWith('```')) code.push(lines[index++])
      if (index < lines.length) index++
      blocks.push(<pre key={`code-${index}`} className="my-3 overflow-x-auto rounded-lg border border-cyber-border-subtle bg-cyber-bg-tertiary p-3 text-xs leading-5"><code className="font-mono">{language ? `${language}\n` : ''}{code.join('\n')}</code></pre>)
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/)
    if (heading) {
      const size = heading[1].length === 1 ? 'text-base' : 'text-sm'
      blocks.push(<div key={`heading-${index}`} className={`mb-1 mt-3 font-semibold ${size}`}>{inlineMarkdown(heading[2])}</div>)
      index++
      continue
    }

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
            <thead className="bg-cyber-bg-tertiary/70"><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-cyber-border-subtle px-3 py-2 font-semibold">{inlineMarkdown(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex} className="border-b border-cyber-border-subtle/60 last:border-0">{headers.map((_, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-cyber-text-secondary">{inlineMarkdown(row[cellIndex] || '')}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*+]\s+/, ''))
      blocks.push(<ul key={`ul-${index}`} className="my-2 list-disc space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ul>)
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+[.)]\s+/, ''))
      blocks.push(<ol key={`ol-${index}`} className="my-2 list-decimal space-y-1 pl-5">{items.map((item, itemIndex) => <li key={itemIndex}>{inlineMarkdown(item)}</li>)}</ol>)
      continue
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^>\s?/, ''))
      blocks.push(<blockquote key={`quote-${index}`} className="my-2 border-l-2 border-cyber-neon-cyan/50 pl-3 text-cyber-text-secondary">{quote.map((item, quoteIndex) => <Fragment key={quoteIndex}>{inlineMarkdown(item)}{quoteIndex < quote.length - 1 ? <br /> : null}</Fragment>)}</blockquote>)
      continue
    }

    const paragraph: string[] = [line]
    index++
    while (index < lines.length && lines[index].trim() && !/^(?:#{1,3}\s|\s*[-*+]\s+|\s*\d+[.)]\s+|>\s?|\s*```)/.test(lines[index])) paragraph.push(lines[index++])
    blocks.push(<p key={`p-${index}`} className="my-2 first:mt-0 last:mb-0">{paragraph.map((item, lineIndex) => <Fragment key={lineIndex}>{inlineMarkdown(item)}{lineIndex < paragraph.length - 1 ? <br /> : null}</Fragment>)}</p>)
  }
  return <div className="break-words text-sm leading-6 text-cyber-text-primary">{blocks}</div>
}
