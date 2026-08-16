import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  parseMarkdown,
  parseInline,
  extractPlainText,
  InlineToken,
  MarkdownTable,
} from './markdown-ast';

export interface FormalReportArtifact {
  artifactId: string;
  title: string;
  content: string;
  citations: Array<Record<string, any>>;
  graphId?: string;
  createdAt: string;
}

function sourceLabel(source: Record<string, any>, index: number): string {
  return `${source.id || `S${index + 1}`} · ${source.title || source.source || '来源'}`;
}

function bundledMiSans(): string | null {
  const candidates = [
    path.join((process as any).resourcesPath || '', 'resources', 'fonts', 'MiSans-Regular.ttf'),
    path.join(process.cwd(), 'resources', 'fonts', 'MiSans-Regular.ttf'),
    path.join(__dirname, '..', '..', 'resources', 'fonts', 'MiSans-Regular.ttf'),
    path.join(__dirname, '..', 'resources', 'fonts', 'MiSans-Regular.ttf'),
    path.join(__dirname, 'resources', 'fonts', 'MiSans-Regular.ttf'),
    '/Users/leo/Projects/unisearch/unisearch/resources/fonts/MiSans-Regular.ttf',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

/**
 * 将 InlineToken 转换为 docx.TextRun
 */
function inlinesToDocx(
  inlines: InlineToken[],
  options?: { font?: string; size?: number; color?: string; bold?: boolean; italics?: boolean },
): TextRun[] {
  const font = options?.font || 'MiSans';
  const defaultSize = options?.size || 22; // 11pt
  const defaultColor = options?.color || '18212F';

  if (inlines.length === 0) return [];

  return inlines.map((token) => {
    switch (token.type) {
      case 'bold':
        return new TextRun({
          text: token.text,
          bold: true,
          font,
          size: defaultSize,
          color: options?.color || '0F172A',
        });
      case 'italic':
        return new TextRun({
          text: token.text,
          italics: true,
          font,
          size: defaultSize,
          color: defaultColor,
        });
      case 'boldItalic':
        return new TextRun({
          text: token.text,
          bold: true,
          italics: true,
          font,
          size: defaultSize,
          color: options?.color || '0F172A',
        });
      case 'code':
        return new TextRun({
          text: ` ${token.text} `,
          font: 'Consolas',
          size: Math.max(defaultSize - 2, 16),
          color: 'BE185D',
          shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
        });
      case 'citation':
        return new TextRun({
          text: ` ${token.text} `,
          bold: true,
          font,
          size: Math.max(defaultSize - 2, 16),
          color: '087F8C',
          shading: { type: ShadingType.CLEAR, fill: 'E6FFFA' },
        });
      case 'link':
        return new TextRun({
          text: token.text,
          font,
          size: defaultSize,
          color: '2E74B5',
          underline: {},
        });
      case 'strikethrough':
        return new TextRun({
          text: token.text,
          strike: true,
          font,
          size: defaultSize,
          color: '94A3B8',
        });
      case 'text':
      default:
        return new TextRun({
          text: token.text,
          font,
          size: defaultSize,
          color: defaultColor,
          bold: options?.bold,
          italics: options?.italics,
        });
    }
  });
}

/**
 * 将 MarkdownTable 转换为精美的 docx.Table
 */
function tableToDocx(table: MarkdownTable): Table {
  const colCount = Math.max(
    table.headers.length,
    ...table.rows.map((r) => r.length),
    1,
  );

  const headerCells = table.headers.map((cellInlines, colIdx) => {
    const alignment = table.alignments[colIdx] === 'center'
      ? AlignmentType.CENTER
      : table.alignments[colIdx] === 'right'
      ? AlignmentType.RIGHT
      : AlignmentType.LEFT;

    return new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' },
      margins: { top: 140, bottom: 140, left: 160, right: 160 },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' },
        bottom: { style: BorderStyle.SINGLE, size: 8, color: '94A3B8' },
        left: { style: BorderStyle.NONE },
        right: { style: BorderStyle.NONE },
      },
      children: [
        new Paragraph({
          alignment,
          spacing: { before: 0, after: 0, line: 240 },
          children: inlinesToDocx(cellInlines, { size: 20, color: '0F172A', bold: true }),
        }),
      ],
    });
  });

  const headerRow = new TableRow({
    tableHeader: true,
    cantSplit: true,
    children: headerCells,
  });

  const bodyRows = table.rows.map((rowCells, rowIdx) => {
    const isEven = rowIdx % 2 === 1;
    const cells = rowCells.map((cellInlines, colIdx) => {
      const alignment = table.alignments[colIdx] === 'center'
        ? AlignmentType.CENTER
        : table.alignments[colIdx] === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT;

      return new TableCell({
        shading: isEven ? { type: ShadingType.CLEAR, fill: 'F8FAFC' } : undefined,
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
        },
        children: [
          new Paragraph({
            alignment,
            spacing: { before: 0, after: 0, line: 240 },
            children: inlinesToDocx(cellInlines, { size: 20, color: '334155' }),
          }),
        ],
      });
    });

    // 补全缺失单元格
    while (cells.length < colCount) {
      cells.push(new TableCell({
        margins: { top: 120, bottom: 120, left: 160, right: 160 },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
        },
        children: [new Paragraph({})],
      }));
    }

    return new TableRow({
      cantSplit: true,
      children: cells,
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

/**
 * 在 PDF 中渲染 InlineToken 流，保留富文本高亮并彻底去除原始 Markdown 标记
 */
function renderInlinesToPdf(
  document: PDFKit.PDFDocument,
  inlines: InlineToken[],
  options?: {
    fontSize?: number;
    defaultColor?: string;
    lineGap?: number;
    indent?: number;
    width?: number;
    align?: 'left' | 'center' | 'right' | 'justify';
  },
) {
  if (!inlines || inlines.length === 0) return;

  const fontSize = options?.fontSize || 10;
  const defaultColor = options?.defaultColor || '#1E293B';
  const lineGap = options?.lineGap ?? 3.5;
  const count = inlines.length;

  inlines.forEach((token, idx) => {
    const isLast = idx === count - 1;
    let color: string;
    let underline = false;
    let link: string | undefined = undefined;

    switch (token.type) {
      case 'bold':
      case 'boldItalic':
        color = '#0F172A';
        break;
      case 'citation':
        color = '#087F8C';
        break;
      case 'code':
        color = '#BE185D';
        break;
      case 'link':
        color = '#2E74B5';
        underline = true;
        link = token.url;
        break;
      case 'italic':
        color = '#475467';
        break;
      case 'strikethrough':
        color = '#94A3B8';
        break;
      case 'text':
      default:
        color = defaultColor;
    }

    document
      .font('CN')
      .fontSize(fontSize)
      .fillColor(color)
      .text(token.text, {
        continued: !isLast,
        link,
        underline,
        indent: idx === 0 ? options?.indent : 0,
        lineGap,
        width: options?.width,
        align: options?.align || 'left',
      });
  });
}

export class FormalReportRenderer {
  async docx(artifact: FormalReportArtifact): Promise<Buffer> {
    const fontData = fs.readFileSync(bundledMiSans());
    const children: Array<Paragraph | Table> = [
      new Paragraph({ text: artifact.title, heading: HeadingLevel.TITLE, spacing: { after: 160 } }),
      new Paragraph({
        children: [
          new TextRun({
            text: `研究报告 · ${new Date(artifact.createdAt).toLocaleString('zh-CN')} · ${artifact.citations.length} 项证据引用`,
            color: '64748B',
            size: 20,
            font: 'MiSans',
          }),
        ],
        spacing: { after: 320 },
      }),
    ];

    const astBlocks = parseMarkdown(artifact.content);

    for (const block of astBlocks) {
      switch (block.type) {
        case 'heading': {
          const headingLevel = block.level === 1
            ? HeadingLevel.HEADING_1
            : block.level === 2
            ? HeadingLevel.HEADING_2
            : block.level === 3
            ? HeadingLevel.HEADING_3
            : HeadingLevel.HEADING_4;

          const size = block.level === 1 ? 32 : block.level === 2 ? 26 : block.level === 3 ? 24 : 22;
          const color = block.level <= 2 ? '2E74B5' : '1F4D78';

          children.push(
            new Paragraph({
              heading: headingLevel,
              children: inlinesToDocx(block.inlines, { size, color, bold: true }),
            }),
          );
          break;
        }

        case 'table': {
          children.push(tableToDocx(block));
          children.push(new Paragraph({ spacing: { after: 160 } }));
          break;
        }

        case 'bullet_list': {
          for (const item of block.items) {
            children.push(
              new Paragraph({
                bullet: { level: item.level },
                spacing: { after: 100, line: 260 },
                children: inlinesToDocx(item.inlines, { size: 22, color: '334155' }),
              }),
            );
          }
          break;
        }

        case 'ordered_list': {
          for (const item of block.items) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `${item.num}. `, bold: true, color: '2E74B5', font: 'MiSans', size: 22 }),
                  ...inlinesToDocx(item.inlines, { size: 22, color: '334155' }),
                ],
                spacing: { after: 100, line: 260 },
              }),
            );
          }
          break;
        }

        case 'blockquote': {
          children.push(
            new Paragraph({
              indent: { left: 360 },
              spacing: { before: 120, after: 160, line: 264 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 16, color: '087F8C', space: 8 },
              },
              children: inlinesToDocx(block.inlines, { color: '475467', italics: true }),
            }),
          );
          break;
        }

        case 'code_block': {
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      shading: { type: ShadingType.CLEAR, fill: 'F8FAFC' },
                      margins: { top: 120, bottom: 120, left: 160, right: 160 },
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
                        bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
                        left: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
                        right: { style: BorderStyle.SINGLE, size: 2, color: 'E2E8F0' },
                      },
                      children: block.code.split('\n').map(
                        (line) =>
                          new Paragraph({
                            spacing: { before: 0, after: 40, line: 240 },
                            children: [
                              new TextRun({
                                text: line || ' ',
                                font: 'Consolas',
                                size: 19,
                                color: '1E293B',
                              }),
                            ],
                          }),
                      ),
                    }),
                  ],
                }),
              ],
            }),
          );
          children.push(new Paragraph({ spacing: { after: 120 } }));
          break;
        }

        case 'thematic_break': {
          children.push(
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E2E8F0', space: 4 } },
              spacing: { before: 160, after: 160 },
            }),
          );
          break;
        }

        case 'paragraph':
        default: {
          children.push(
            new Paragraph({
              children: inlinesToDocx(block.inlines, { size: 22, color: '18212F' }),
              spacing: { after: 140, line: 270 },
            }),
          );
          break;
        }
      }
    }

    if (artifact.citations.length) {
      children.push(new Paragraph({ text: '引用资料与证据溯源', heading: HeadingLevel.HEADING_1 }));
      artifact.citations.forEach((source, index) => {
        const sourceInlines = parseInline(
          `${sourceLabel(source, index)}${source.sourceUrl ? `\n${source.sourceUrl}` : ''}${source.excerpt ? `\n${source.excerpt}` : ''}`,
        );
        children.push(
          new Paragraph({
            children: inlinesToDocx(sourceInlines, { size: 20, color: '475467' }),
            numbering: { reference: 'sources', level: 0 },
            spacing: { after: 120, line: 264 },
          }),
        );
      });
    }

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `研报制品 ID：${artifact.artifactId}${artifact.graphId ? ` · 图谱快照：${artifact.graphId}` : ''}`,
            color: '64748B',
            size: 18,
            font: 'MiSans',
          }),
        ],
        spacing: { before: 280 },
      }),
    );

    const document = new Document({
      fonts: [{ name: 'MiSans', data: fontData }],
      styles: {
        default: {
          document: {
            run: { font: 'MiSans', size: 22, color: '18212F' },
            paragraph: { spacing: { after: 120, line: 264 } },
          },
        },
        paragraphStyles: [
          {
            id: 'Title',
            name: 'Title',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: 'MiSans', size: 48, bold: true, color: '0B2545' },
            paragraph: { spacing: { before: 0, after: 160 } },
          },
          {
            id: 'Heading1',
            name: 'Heading 1',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: 'MiSans', size: 32, bold: true, color: '2E74B5' },
            paragraph: { spacing: { before: 320, after: 160 }, keepNext: true },
          },
          {
            id: 'Heading2',
            name: 'Heading 2',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: 'MiSans', size: 26, bold: true, color: '2E74B5' },
            paragraph: { spacing: { before: 240, after: 120 }, keepNext: true },
          },
          {
            id: 'Heading3',
            name: 'Heading 3',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: 'MiSans', size: 24, bold: true, color: '1F4D78' },
            paragraph: { spacing: { before: 160, after: 80 }, keepNext: true },
          },
          {
            id: 'Heading4',
            name: 'Heading 4',
            basedOn: 'Normal',
            next: 'Normal',
            quickFormat: true,
            run: { font: 'MiSans', size: 22, bold: true, color: '1F4D78' },
            paragraph: { spacing: { before: 120, after: 60 }, keepNext: true },
          },
        ],
      },
      numbering: {
        config: [
          {
            reference: 'sources',
            levels: [
              {
                level: 0,
                format: 'decimal',
                text: '%1.',
                alignment: AlignmentType.LEFT,
                style: { paragraph: { indent: { left: 720, hanging: 360 } } },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 },
            },
          },
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: 'UNISEARCH · 深度研究报告', color: '64748B', size: 18, font: 'MiSans' })],
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      children: ['第 ', PageNumber.CURRENT, ' 页'],
                      color: '64748B',
                      size: 18,
                      font: 'MiSans',
                    }),
                  ],
                }),
              ],
            }),
          },
          children,
        },
      ],
    });

    return Packer.toBuffer(document);
  }

  async pdf(artifact: FormalReportArtifact): Promise<Buffer> {
    const font = bundledMiSans();
    return new Promise<Buffer>((resolve, reject) => {
      const document = new PDFDocument({
        size: 'LETTER',
        margins: { top: 56, bottom: 64, left: 54, right: 54 },
        bufferPages: true,
        info: { Title: artifact.title, Author: 'UniSearch' },
      });

      const chunks: Buffer[] = [];
      document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));
      if (font) {
        document.registerFont('CN', font);
      }
      const fontName = font ? 'CN' : 'Helvetica';

      // 标题与副标题
      document.font(fontName).fillColor('#0B2545').fontSize(22).text(artifact.title, { lineGap: 4 });
      document
        .moveDown(0.3)
        .fillColor('#64748B')
        .fontSize(9)
        .text(`研究报告  |  ${new Date(artifact.createdAt).toLocaleString('zh-CN')}  |  ${artifact.citations.length} 项证据引用`);
      document.moveDown(0.8);

      const astBlocks = parseMarkdown(artifact.content);

      for (const block of astBlocks) {
        // 跨页安全边界检查 (Letter height 792pt, max y = 690pt)
        if (document.y > 690) {
          document.addPage();
        }

        switch (block.type) {
          case 'heading': {
            const level = block.level;
            if (document.y > 670) document.addPage();
            document.moveDown(level === 1 ? 0.7 : level === 2 ? 0.45 : 0.3);
            renderInlinesToPdf(document, block.inlines, {
              fontSize: level === 1 ? 15 : level === 2 ? 12.5 : 11,
              defaultColor: level <= 2 ? '#1F4D78' : '#2E74B5',
              lineGap: 2,
            });
            document.moveDown(0.25);
            break;
          }

          case 'table': {
            const tableWidth = 504;
            const numCols = Math.max(block.headers.length, ...block.rows.map((r) => r.length), 1);
            const colWidth = tableWidth / numCols;

            // 1. 计算表头高度
            let headerHeight = 22;
            for (const h of block.headers) {
              const hText = extractPlainText(h);
              const hHeight = document.font('CN').fontSize(9).heightOfString(hText, { width: colWidth - 12 }) + 10;
              if (hHeight > headerHeight) headerHeight = hHeight;
            }

            if (document.y + headerHeight > 680) {
              document.addPage();
            }

            const headerY = document.y;
            // 绘制表头背景与底边
            document.rect(54, headerY, tableWidth, headerHeight).fillColor('#F1F5F9').fill();
            document.rect(54, headerY + headerHeight, tableWidth, 1.5).fillColor('#94A3B8').fill();

            // 绘制表头文本
            block.headers.forEach((hInlines, colIdx) => {
              const align = block.alignments[colIdx] || 'left';
              const text = extractPlainText(hInlines);
              document
                .font('CN')
                .fontSize(9)
                .fillColor('#0F172A')
                .text(text, 54 + colIdx * colWidth + 6, headerY + 5, {
                  width: colWidth - 12,
                  align,
                });
            });

            document.y = headerY + headerHeight + 2;

            // 2. 绘制数据行
            block.rows.forEach((row, rowIdx) => {
              let rowHeight = 18;
              for (const cell of row) {
                const cText = extractPlainText(cell);
                const cHeight = document.font('CN').fontSize(8.5).heightOfString(cText, { width: colWidth - 12 }) + 8;
                if (cHeight > rowHeight) rowHeight = cHeight;
              }

              if (document.y + rowHeight > 690) {
                document.addPage();
              }

              const rowY = document.y;
              if (rowIdx % 2 === 1) {
                document.rect(54, rowY, tableWidth, rowHeight).fillColor('#F8FAFC').fill();
              }
              document.rect(54, rowY + rowHeight, tableWidth, 0.5).fillColor('#E2E8F0').fill();

              row.forEach((cellInlines, colIdx) => {
                const align = block.alignments[colIdx] || 'left';
                const text = extractPlainText(cellInlines);
                document
                  .font('CN')
                  .fontSize(8.5)
                  .fillColor('#334155')
                  .text(text, 54 + colIdx * colWidth + 6, rowY + 4, {
                    width: colWidth - 12,
                    align,
                  });
              });

              document.y = rowY + rowHeight + 2;
            });

            document.x = 54;
            document.moveDown(0.5);
            break;
          }

          case 'bullet_list': {
            for (const item of block.items) {
              if (document.y > 685) document.addPage();
              const indent = 8 + item.level * 12;
              document.font('CN').fontSize(10).fillColor('#2E74B5').text('•  ', { continued: true, indent });
              renderInlinesToPdf(document, item.inlines, { fontSize: 10, defaultColor: '#334155', lineGap: 3 });
              document.moveDown(0.15);
            }
            document.x = 54;
            document.moveDown(0.2);
            break;
          }

          case 'ordered_list': {
            for (const item of block.items) {
              if (document.y > 685) document.addPage();
              document.font('CN').fontSize(10).fillColor('#2E74B5').text(`${item.num}.  `, { continued: true, indent: 8 });
              renderInlinesToPdf(document, item.inlines, { fontSize: 10, defaultColor: '#334155', lineGap: 3 });
              document.moveDown(0.15);
            }
            document.x = 54;
            document.moveDown(0.2);
            break;
          }

          case 'blockquote': {
            const quoteText = extractPlainText(block.inlines);
            const quoteHeight = document.font('CN').fontSize(9.5).heightOfString(quoteText, { width: 480 }) + 10;
            if (document.y + quoteHeight > 690) document.addPage();

            const quoteY = document.y;
            document.rect(54, quoteY, 3, quoteHeight).fillColor('#087F8C').fill();
            document.x = 64;
            document.y = quoteY + 4;
            renderInlinesToPdf(document, block.inlines, {
              fontSize: 9.5,
              defaultColor: '#475467',
              width: 480,
              lineGap: 3,
            });

            document.x = 54;
            document.y = quoteY + quoteHeight + 4;
            document.moveDown(0.3);
            break;
          }

          case 'code_block': {
            const codeLines = block.code.split('\n');
            const codeHeight = Math.max(codeLines.length * 13 + 12, 28);
            if (document.y + codeHeight > 690) document.addPage();

            const codeY = document.y;
            document.roundedRect(54, codeY, 504, codeHeight, 4).fillColor('#F8FAFC').strokeColor('#E2E8F0').fillAndStroke();

            document
              .font('CN')
              .fontSize(8.5)
              .fillColor('#1E293B')
              .text(block.code, 64, codeY + 6, { width: 484, lineGap: 2 });

            document.x = 54;
            document.y = codeY + codeHeight + 4;
            document.moveDown(0.4);
            break;
          }

          case 'thematic_break': {
            document.rect(54, document.y + 4, 504, 0.5).fillColor('#E2E8F0').fill();
            document.x = 54;
            document.moveDown(0.5);
            break;
          }

          case 'paragraph':
          default: {
            if (document.y > 685) document.addPage();
            renderInlinesToPdf(document, block.inlines, { fontSize: 10, defaultColor: '#18212F', lineGap: 4 });
            document.x = 54;
            document.moveDown(0.35);
            break;
          }
        }
      }

      if (artifact.citations.length) {
        if (document.y > 640) document.addPage();
        document.moveDown(0.7).font('CN').fillColor('#1F4D78').fontSize(14).text('引用资料与证据溯源');
        document.moveDown(0.3);
        artifact.citations.forEach((source, index) => {
          let cleanExcerpt = String(source.excerpt || '').trim();
          if (cleanExcerpt.startsWith('{') && cleanExcerpt.endsWith('}')) {
            try {
              const parsed = JSON.parse(cleanExcerpt);
              cleanExcerpt = parsed.desc || parsed.title || parsed.content || cleanExcerpt;
            } catch {
              // keep
            }
          }
          cleanExcerpt = extractPlainText(parseInline(cleanExcerpt));

          const titleText = `${index + 1}. ${sourceLabel(source, index)}`;
          const estHeight = document.font('CN').fontSize(9).heightOfString(titleText, { width: 504 })
            + (source.sourceUrl ? 14 : 0)
            + (cleanExcerpt ? document.font('CN').fontSize(8.5).heightOfString(cleanExcerpt, { width: 504 }) + 4 : 0)
            + 8;

          if (document.y + estHeight > 690) document.addPage();

          document.font('CN').fontSize(9).fillColor('#0F172A').text(titleText, { lineGap: 2 });
          if (source.sourceUrl) {
            document.fillColor('#087F8C').fontSize(8).text(String(source.sourceUrl), { link: String(source.sourceUrl), underline: true });
          }
          if (cleanExcerpt) {
            document.fillColor('#64748B').fontSize(8.5).text(cleanExcerpt, { lineGap: 2 });
          }
          document.x = 54;
          document.moveDown(0.3);
        });
      }

      const range = document.bufferedPageRange();
      for (let index = 0; index < range.count; index++) {
        document.switchToPage(range.start + index);
        const pageNum = index + 1;
        const totalPages = range.count;

        // 临时将边距设为 0，防止页眉/页脚绘制在边距区域时触发 PDFKit 自动分页
        const origTop = document.page.margins.top;
        const origBottom = document.page.margins.bottom;
        document.page.margins.top = 0;
        document.page.margins.bottom = 0;

        // 1. 页眉 (Header)
        document.font('CN').fontSize(8).fillColor('#94A3B8');
        document.text('UniSearch · 深度研究报告', 54, 30, { width: 220, align: 'left', lineBreak: false });
        const safeHeaderTitle = artifact.title.length > 25 ? `${artifact.title.slice(0, 25)}…` : artifact.title;
        document.text(safeHeaderTitle, 280, 30, { width: 278, align: 'right', lineBreak: false });
        document.rect(54, 44, 504, 0.5).fillColor('#E2E8F0').fill();

        // 2. 页脚 (Footer)
        document.rect(54, 736, 504, 0.5).fillColor('#E2E8F0').fill();
        document.font('CN').fontSize(8).fillColor('#94A3B8');
        const dateStr = new Date(artifact.createdAt).toLocaleDateString('zh-CN');
        document.text(`生成时间: ${dateStr}  ·  严谨证据链`, 54, 744, { width: 300, align: 'left', lineBreak: false });
        document.text(`第 ${pageNum} / ${totalPages} 页`, 350, 744, { width: 208, align: 'right', lineBreak: false });

        document.page.margins.top = origTop;
        document.page.margins.bottom = origBottom;
      }
      document.end();
    });
  }
}

export const formalReportRenderer = new FormalReportRenderer();
