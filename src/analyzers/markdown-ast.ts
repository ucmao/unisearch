export type InlineTokenType =
  | 'text'
  | 'bold'
  | 'italic'
  | 'boldItalic'
  | 'code'
  | 'link'
  | 'citation'
  | 'strikethrough';

export interface InlineToken {
  type: InlineTokenType;
  text: string;
  url?: string;
  citationId?: string;
}

export type TableAlignment = 'left' | 'center' | 'right';

export interface MarkdownTable {
  type: 'table';
  headers: InlineToken[][];
  rawHeaders: string[];
  alignments: TableAlignment[];
  rows: InlineToken[][][];
  rawRows: string[][];
}

export interface MarkdownHeading {
  type: 'heading';
  level: number;
  text: string;
  inlines: InlineToken[];
}

export interface MarkdownParagraph {
  type: 'paragraph';
  text: string;
  inlines: InlineToken[];
}

export interface MarkdownBulletList {
  type: 'bullet_list';
  items: Array<{
    level: number;
    text: string;
    inlines: InlineToken[];
  }>;
}

export interface MarkdownOrderedList {
  type: 'ordered_list';
  items: Array<{
    num: number;
    text: string;
    inlines: InlineToken[];
  }>;
}

export interface MarkdownBlockquote {
  type: 'blockquote';
  text: string;
  inlines: InlineToken[];
}

export interface MarkdownCodeBlock {
  type: 'code_block';
  lang?: string;
  code: string;
}

export interface MarkdownThematicBreak {
  type: 'thematic_break';
}

export type MarkdownBlock =
  | MarkdownTable
  | MarkdownHeading
  | MarkdownParagraph
  | MarkdownBulletList
  | MarkdownOrderedList
  | MarkdownBlockquote
  | MarkdownCodeBlock
  | MarkdownThematicBreak;

/**
 * 解析行内富文本标记 (Inline Tokens)
 */
export function parseInline(rawText: string): InlineToken[] {
  if (!rawText) return [];

  const tokens: InlineToken[] = [];
  let remaining = rawText;

  // 正则匹配内联标记：
  // 1. Citation: [S1], [S12]
  // 2. Link: [text](url)
  // 3. BoldItalic: ***text*** or ___text___
  // 4. Bold: **text** or __text__
  // 5. Italic: *text* or _text_
  // 6. Inline Code: `code`
  // 7. Strikethrough: ~~text~~
  const inlineRegex = /(\[S\d+\])|(\[([^\]]+)\]\(([^)]+)\))|(\*\*\*([\s\S]+?)\*\*\*|___([\s\S]+?)___)|(\*\*([\s\S]+?)\*\*|__([\s\S]+?)__)|(\*([^\s*][^*]*?)\*|_([^\s_][^_]*?)_)|(`([^`]+)`)|(~~([\s\S]+?)~~)/;

  while (remaining) {
    const match = remaining.match(inlineRegex);
    if (!match || match.index === undefined) {
      tokens.push({ type: 'text', text: remaining });
      break;
    }

    // 先推入匹配项之前的普通文本
    if (match.index > 0) {
      tokens.push({ type: 'text', text: remaining.slice(0, match.index) });
    }

    const fullMatch = match[0];
    if (match[1]) {
      // Citation: [S1]
      const citationId = match[1].slice(1, -1);
      tokens.push({ type: 'citation', text: match[1], citationId });
    } else if (match[2]) {
      // Link: [text](url)
      tokens.push({ type: 'link', text: match[3], url: match[4] });
    } else if (match[5]) {
      // BoldItalic: ***text***
      const content = match[6] || match[7];
      tokens.push({ type: 'boldItalic', text: content });
    } else if (match[8]) {
      // Bold: **text**
      const content = match[9] || match[10];
      tokens.push({ type: 'bold', text: content });
    } else if (match[11]) {
      // Italic: *text*
      const content = match[12] || match[13];
      tokens.push({ type: 'italic', text: content });
    } else if (match[14]) {
      // Code: `code`
      tokens.push({ type: 'code', text: match[15] });
    } else if (match[16]) {
      // Strikethrough: ~~text~~
      tokens.push({ type: 'strikethrough', text: match[17] });
    } else {
      tokens.push({ type: 'text', text: fullMatch });
    }

    remaining = remaining.slice(match.index + fullMatch.length);
  }

  return tokens;
}

/**
 * 清除内联标记，获取纯文本
 */
export function extractPlainText(inlines: InlineToken[]): string {
  return inlines.map((t) => t.text).join('');
}

/**
 * 校验一行是否为表格行 (包含管道符 |)
 */
function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && !trimmed.startsWith('```');
}

/**
 * 解析表格的分隔行 (如 |:---|:---:|---:|) 获取对齐方式
 */
function parseTableDelimiter(line: string): TableAlignment[] | null {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = trimmed.split('|').map((c) => c.trim());
  if (cells.length === 0) return null;

  const alignments: TableAlignment[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) alignments.push('center');
    else if (right) alignments.push('right');
    else alignments.push('left');
  }
  return alignments;
}

/**
 * 切分表格的一行数据
 */
function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  let content = trimmed;
  if (content.startsWith('|')) content = content.slice(1);
  if (content.endsWith('|')) content = content.slice(0, -1);
  return content.split('|').map((cell) => cell.trim());
}

/**
 * 解析 Markdown 文本为 Block 语法树
 */
export function parseMarkdown(markdown: string): MarkdownBlock[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. 空行
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. 代码块
    const codeBlockMatch = trimmed.match(/^```(\w*)/);
    if (codeBlockMatch) {
      const lang = codeBlockMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // 跳过结束 fence
      }
      blocks.push({
        type: 'code_block',
        lang: lang || undefined,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // 3. 标题 (#, ##, ###, ####, #####, ######)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      blocks.push({
        type: 'heading',
        level,
        text,
        inlines: parseInline(text),
      });
      i++;
      continue;
    }

    // 4. 分割线 (---, ***, ___)
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'thematic_break' });
      i++;
      continue;
    }

    // 5. 表格 (检测连续的 Table 结构)
    if (isTableLine(rawLine) && i + 1 < lines.length) {
      const delimAlignments = parseTableDelimiter(lines[i + 1]);
      if (delimAlignments) {
        const headerRaw = splitTableRow(rawLine);
        const headers = headerRaw.map((cell) => parseInline(cell));
        const alignments = delimAlignments;
        const rows: InlineToken[][][] = [];
        const rawRows: string[][] = [];

        i += 2; // 跳过表头和分隔线
        while (i < lines.length && isTableLine(lines[i]) && lines[i].trim() !== '') {
          const rowRaw = splitTableRow(lines[i]);
          rawRows.push(rowRaw);
          rows.push(rowRaw.map((cell) => parseInline(cell)));
          i++;
        }

        blocks.push({
          type: 'table',
          headers,
          rawHeaders: headerRaw,
          alignments,
          rows,
          rawRows,
        });
        continue;
      }
    }

    // 6. 引用块 (> text)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s*/, ''));
        i++;
      }
      const fullText = quoteLines.join(' ');
      blocks.push({
        type: 'blockquote',
        text: fullText,
        inlines: parseInline(fullText),
      });
      continue;
    }

    // 7. 无序列表 (- item, * item, + item)
    const bulletMatch = rawLine.match(/^(\s*)([-*+])\s+(.+)$/);
    if (bulletMatch) {
      const items: Array<{ level: number; text: string; inlines: InlineToken[] }> = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)([-*+])\s+(.+)$/);
        if (!itemMatch) break;
        const indent = itemMatch[1].length;
        const level = Math.floor(indent / 2);
        const text = itemMatch[3].trim();
        items.push({
          level,
          text,
          inlines: parseInline(text),
        });
        i++;
      }
      blocks.push({
        type: 'bullet_list',
        items,
      });
      continue;
    }

    // 8. 有序列表 (1. item, 2. item)
    const orderedMatch = rawLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      const items: Array<{ num: number; text: string; inlines: InlineToken[] }> = [];
      while (i < lines.length) {
        const itemMatch = lines[i].match(/^(\s*)(\d+)\.\s+(.+)$/);
        if (!itemMatch) break;
        const num = parseInt(itemMatch[2], 10);
        const text = itemMatch[3].trim();
        items.push({
          num,
          text,
          inlines: parseInline(text),
        });
        i++;
      }
      blocks.push({
        type: 'ordered_list',
        items,
      });
      continue;
    }

    // 9. 普通段落 (合并紧挨的普通行)
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const nextTrimmed = lines[i].trim();
      if (!nextTrimmed) break;
      if (nextTrimmed.startsWith('#') || nextTrimmed.startsWith('```') || nextTrimmed.startsWith('>') || /^[-*+]\s+/.test(nextTrimmed) || /^\d+\.\s+/.test(nextTrimmed) || (/^(\*{3,}|-{3,}|_{3,})$/.test(nextTrimmed)) || (isTableLine(lines[i]) && i + 1 < lines.length && parseTableDelimiter(lines[i + 1]))) {
        break;
      }
      paragraphLines.push(nextTrimmed);
      i++;
    }

    const paragraphText = paragraphLines.join(' ');
    if (paragraphText) {
      blocks.push({
        type: 'paragraph',
        text: paragraphText,
        inlines: parseInline(paragraphText),
      });
    }
  }

  return blocks;
}
