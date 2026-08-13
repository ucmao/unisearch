import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from 'docx';

export interface FormalReportArtifact {
  artifactId: string;
  title: string;
  content: string;
  citations: Array<Record<string, any>>;
  graphId?: string;
  createdAt: string;
}

type Block = { type: 'heading' | 'paragraph' | 'bullet' | 'quote'; level?: number; text: string };

function cleanInline(value: string): string {
  return value
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim();
}

function blocks(markdown: string): Block[] {
  return markdown.split(/\r?\n/).flatMap((raw): Block[] => {
    const line = raw.trim();
    if (!line) return [];
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return [{ type: 'heading', level: heading[1].length, text: cleanInline(heading[2]) }];
    if (/^[-*]\s+/.test(line)) return [{ type: 'bullet', text: cleanInline(line.replace(/^[-*]\s+/, '')) }];
    if (/^>\s*/.test(line)) return [{ type: 'quote', text: cleanInline(line.replace(/^>\s*/, '')) }];
    return [{ type: 'paragraph', text: cleanInline(line) }];
  });
}

function sourceLabel(source: Record<string, any>, index: number): string {
  return `${source.id || `S${index + 1}`} · ${source.title || source.source || '来源'}`;
}

function bundledMiSans(): string {
  const candidates = [
    path.join(process.resourcesPath || '', 'resources', 'fonts', 'MiSans-Regular.ttf'),
    path.join(process.cwd(), 'resources', 'fonts', 'MiSans-Regular.ttf'),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) throw new Error('正式报告字体资源缺失：resources/fonts/MiSans-Regular.ttf');
  return resolved;
}

export class FormalReportRenderer {
  async docx(artifact: FormalReportArtifact): Promise<Buffer> {
    const fontData = fs.readFileSync(bundledMiSans());
    const children: Paragraph[] = [
      new Paragraph({ text: artifact.title, heading: HeadingLevel.TITLE, spacing: { after: 160 } }),
      new Paragraph({
        children: [new TextRun({ text: `研究报告 · ${new Date(artifact.createdAt).toLocaleString('zh-CN')} · ${artifact.citations.length} 项引用`, color: '667085', size: 20 })],
        spacing: { after: 320 },
      }),
    ];
    for (const block of blocks(artifact.content)) {
      if (block.type === 'heading') {
        children.push(new Paragraph({
          text: block.text,
          heading: block.level === 1 ? HeadingLevel.HEADING_1 : block.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
        }));
      } else if (block.type === 'bullet') {
        children.push(new Paragraph({ text: block.text, bullet: { level: 0 }, spacing: { after: 120, line: 280 } }));
      } else {
        children.push(new Paragraph({
          children: [new TextRun({ text: block.text, italics: block.type === 'quote', color: block.type === 'quote' ? '475467' : '18212F' })],
          indent: block.type === 'quote' ? { left: 360 } : undefined,
          spacing: { after: 120, line: 264 },
        }));
      }
    }
    if (artifact.citations.length) {
      children.push(new Paragraph({ text: '引用资料', heading: HeadingLevel.HEADING_1 }));
      artifact.citations.forEach((source, index) => children.push(new Paragraph({
        text: `${sourceLabel(source, index)}${source.sourceUrl ? `\n${source.sourceUrl}` : ''}${source.excerpt ? `\n${cleanInline(String(source.excerpt))}` : ''}`,
        numbering: { reference: 'sources', level: 0 },
        spacing: { after: 120, line: 264 },
      })));
    }
    children.push(new Paragraph({
      children: [new TextRun({ text: `制品 ID：${artifact.artifactId}${artifact.graphId ? ` · 图谱快照：${artifact.graphId}` : ''}`, color: '667085', size: 18 })],
      spacing: { before: 240 },
    }));

    const document = new Document({
      fonts: [{ name: 'MiSans', data: fontData }],
      styles: {
        default: { document: { run: { font: 'MiSans', size: 22, color: '18212F' }, paragraph: { spacing: { after: 120, line: 264 } } } },
        paragraphStyles: [
          { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'MiSans', size: 48, bold: true, color: '0B2545' }, paragraph: { spacing: { before: 0, after: 160 } } },
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'MiSans', size: 32, bold: true, color: '2E74B5' }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'MiSans', size: 26, bold: true, color: '2E74B5' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
          { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'MiSans', size: 24, bold: true, color: '1F4D78' }, paragraph: { spacing: { before: 160, after: 80 }, keepNext: true } },
        ],
      },
      numbering: { config: [{ reference: 'sources', levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
      sections: [{
        properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 } } },
        headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'UNISEARCH · 研究报告', color: '667085', size: 18 })] })] }) },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ['第 ', PageNumber.CURRENT, ' 页'], color: '667085', size: 18 })] })] }) },
        children,
      }],
    });
    return Packer.toBuffer(document);
  }

  async pdf(artifact: FormalReportArtifact): Promise<Buffer> {
    const font = bundledMiSans();
    return new Promise<Buffer>((resolve, reject) => {
      const document = new PDFDocument({ size: 'LETTER', margins: { top: 72, right: 72, bottom: 72, left: 72 }, bufferPages: true, info: { Title: artifact.title, Author: 'UniSearch' } });
      const chunks: Buffer[] = [];
      document.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.registerFont('CN', font);
      document.font('CN').fillColor('#0B2545').fontSize(24).text(artifact.title, { lineGap: 4 });
      document.moveDown(0.4).fillColor('#667085').fontSize(9)
        .text(`研究报告  |  ${new Date(artifact.createdAt).toLocaleString('zh-CN')}  |  ${artifact.citations.length} 项引用`);
      document.moveDown(1.2);
      for (const block of blocks(artifact.content)) {
        if (block.type === 'heading') {
          document.moveDown(block.level === 1 ? 0.9 : 0.55).fillColor(block.level === 3 ? '#1F4D78' : '#2E74B5')
            .fontSize(block.level === 1 ? 16 : block.level === 2 ? 13 : 11.5).text(block.text, { lineGap: 2, keepTogether: true });
          document.moveDown(0.25);
        } else if (block.type === 'bullet') {
          document.fillColor('#18212F').fontSize(10.5).text(`•  ${block.text}`, { indent: 12, lineGap: 3 });
          document.moveDown(0.25);
        } else {
          document.fillColor(block.type === 'quote' ? '#475467' : '#18212F').fontSize(10.5)
            .text(block.text, { indent: block.type === 'quote' ? 18 : 0, lineGap: 4, align: 'left' });
          document.moveDown(0.45);
        }
      }
      if (artifact.citations.length) {
        document.moveDown(0.8).fillColor('#2E74B5').fontSize(16).text('引用资料', { keepTogether: true });
        document.moveDown(0.4);
        artifact.citations.forEach((source, index) => {
          document.fillColor('#18212F').fontSize(9.5).text(`${index + 1}. ${sourceLabel(source, index)}`, { lineGap: 2 });
          if (source.sourceUrl) document.fillColor('#087F8C').fontSize(8).text(String(source.sourceUrl), { link: String(source.sourceUrl), underline: true });
          if (source.excerpt) document.fillColor('#667085').fontSize(8.5).text(cleanInline(String(source.excerpt)), { lineGap: 2 });
          document.moveDown(0.35);
        });
      }
      const range = document.bufferedPageRange();
      for (let index = 0; index < range.count; index++) {
        document.switchToPage(range.start + index);
        document.font('CN').fontSize(8).fillColor('#667085')
          .text(`UniSearch · ${artifact.artifactId} · 第 ${index + 1}/${range.count} 页`, 72, 708, { width: 468, align: 'right', lineBreak: false });
      }
      document.end();
    });
  }
}

export const formalReportRenderer = new FormalReportRenderer();
