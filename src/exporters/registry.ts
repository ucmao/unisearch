import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import type { Document } from '../core/documents/types';
import type { Exporter, ExportResult } from '../core/exporters/types';
import { getDb, getDatabasePath } from '../database/connection';
import { AnalysisService } from '../analyzers/registry';

function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '未命名';
}

function frontmatter(document: Document): string {
  const quote = (value: string) => JSON.stringify(value);
  return [
    '---',
    `title: ${quote(document.title)}`,
    `source: ${quote(document.provenance.source)}`,
    `url: ${quote(document.sourceUrl || '')}`,
    `author: ${quote(document.author)}`,
    `document_id: ${quote(document.documentId)}`,
    '---',
  ].join('\n');
}

function markdown(document: Document): string {
  return `${frontmatter(document)}\n\n# ${document.title || '未命名资料'}\n\n${document.markdown}\n`;
}

export class ExporterRegistry {
  private readonly exporters = new Map<string, Exporter>();
  register(exporter: Exporter): void {
    if (this.exporters.has(exporter.id)) throw new Error(`Exporter already registered: ${exporter.id}`);
    this.exporters.set(exporter.id, exporter);
  }
  get(id: string): Exporter {
    const exporter = this.exporters.get(id);
    if (!exporter) throw new Error(`Unknown Exporter: ${id}`);
    return exporter;
  }
  list(): Array<Pick<Exporter, 'id' | 'version' | 'name'>> {
    return [...this.exporters.values()].map(({ id, version, name }) => ({ id, version, name }));
  }
}

export const exporterRegistry = new ExporterRegistry();

exporterRegistry.register({
  id: 'json',
  version: '1.0.0',
  name: 'JSON 数据包',
  async export(documents, context): Promise<ExportResult> {
    const outputPath = path.join(context.outputDirectory, 'documents.json');
    fs.writeFileSync(outputPath, JSON.stringify({ schemaVersion: 1, documents }, null, 2), 'utf8');
    return { outputPath, itemCount: documents.length, metadata: { format: 'json' } };
  },
});

exporterRegistry.register({
  id: 'markdown',
  version: '1.0.0',
  name: 'Markdown 合集',
  async export(documents, context): Promise<ExportResult> {
    const outputPath = path.join(context.outputDirectory, 'UniSearch_Markdown_Collection.md');
    fs.writeFileSync(outputPath, documents.map(markdown).join('\n\n---\n\n'), 'utf8');
    return { outputPath, itemCount: documents.length, metadata: { format: 'markdown' } };
  },
});

exporterRegistry.register({
  id: 'obsidian',
  version: '1.0.0',
  name: 'Obsidian Vault',
  async export(documents, context): Promise<ExportResult> {
    const vault = path.join(context.outputDirectory, 'Obsidian_Vault');
    fs.mkdirSync(vault, { recursive: true });
    const links: string[] = [];
    documents.forEach((document, index) => {
      const name = `${String(index + 1).padStart(3, '0')}-${safeName(document.title)}.md`;
      fs.writeFileSync(path.join(vault, name), markdown(document), 'utf8');
      links.push(`- [[${name.slice(0, -3)}]]`);
    });
    fs.writeFileSync(path.join(vault, '索引.md'), `# UniSearch 索引\n\n${links.join('\n')}\n`, 'utf8');
    return { outputPath: vault, itemCount: documents.length, metadata: { format: 'obsidian' } };
  },
});

exporterRegistry.register({
  id: 'ima',
  version: '1.0.0',
  name: 'IMA 导入包',
  async export(documents, context): Promise<ExportResult> {
    const bundle = path.join(context.outputDirectory, 'IMA');
    const sources = path.join(bundle, 'sources');
    fs.mkdirSync(sources, { recursive: true });
    const manifest = documents.map((document, index) => {
      const file = `${String(index + 1).padStart(3, '0')}-${safeName(document.title)}.md`;
      fs.writeFileSync(path.join(sources, file), markdown(document), 'utf8');
      return { file: `sources/${file}`, title: document.title, url: document.sourceUrl || '', source: document.provenance.source };
    });
    fs.writeFileSync(path.join(bundle, 'manifest.json'), JSON.stringify({ schemaVersion: 1, createdAt: context.now().toISOString(), sources: manifest }, null, 2), 'utf8');
    return { outputPath: bundle, itemCount: documents.length, metadata: { format: 'ima-markdown-bundle' } };
  },
});

exporterRegistry.register({
  id: 'notion',
  version: '1.0.0',
  name: 'Notion 导入包',
  async export(documents, context): Promise<ExportResult> {
    const bundle = path.join(context.outputDirectory, 'Notion');
    fs.mkdirSync(bundle, { recursive: true });
    const csvRows = ['"Title","Source","URL","Author","DocumentID"'];
    documents.forEach((document, index) => {
      const fileName = `${String(index + 1).padStart(3, '0')}-${safeName(document.title)}.md`;
      fs.writeFileSync(path.join(bundle, fileName), markdown(document), 'utf8');
      const safeStr = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
      csvRows.push([safeStr(document.title), safeStr(document.provenance.source), safeStr(document.sourceUrl || ''), safeStr(document.author), safeStr(document.documentId)].join(','));
    });
    fs.writeFileSync(path.join(bundle, 'database.csv'), csvRows.join('\n'), 'utf8');
    return { outputPath: bundle, itemCount: documents.length, metadata: { format: 'notion-bundle' } };
  },
});

exporterRegistry.register({
  id: 'logseq',
  version: '1.0.0',
  name: 'Logseq 大纲包',
  async export(documents, context): Promise<ExportResult> {
    const bundle = path.join(context.outputDirectory, 'Logseq');
    const pages = path.join(bundle, 'pages');
    fs.mkdirSync(pages, { recursive: true });
    documents.forEach((document, index) => {
      const fileName = `${String(index + 1).padStart(3, '0')}-${safeName(document.title)}.md`;
      const content = [
        `- title:: ${document.title}`,
        `- source:: ${document.provenance.source}`,
        `- url:: ${document.sourceUrl || ''}`,
        `- author:: ${document.author}`,
        '',
        document.markdown,
      ].join('\n');
      fs.writeFileSync(path.join(pages, fileName), content, 'utf8');
    });
    return { outputPath: bundle, itemCount: documents.length, metadata: { format: 'logseq-pages' } };
  },
});

exporterRegistry.register({
  id: 'dify',
  version: '1.0.0',
  name: 'Dify / RAG 知识库',
  async export(documents, context): Promise<ExportResult> {
    const bundle = path.join(context.outputDirectory, 'Dify');
    fs.mkdirSync(bundle, { recursive: true });
    const lines = documents.map((document) => JSON.stringify({
      content: document.markdown,
      metadata: {
        title: document.title,
        source: document.provenance.source,
        url: document.sourceUrl || '',
        author: document.author,
        document_id: document.documentId,
      },
    }));
    fs.writeFileSync(path.join(bundle, 'chunks.jsonl'), lines.join('\n'), 'utf8');
    return { outputPath: bundle, itemCount: documents.length, metadata: { format: 'dify-jsonl' } };
  },
});

exporterRegistry.register({
  id: 'yuque',
  version: '1.0.0',
  name: '语雀 知识库',
  async export(documents, context): Promise<ExportResult> {
    const bundle = path.join(context.outputDirectory, 'Yuque');
    const docs = path.join(bundle, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    const toc = documents.map((document, index) => {
      const fileName = `${String(index + 1).padStart(3, '0')}-${safeName(document.title)}.md`;
      fs.writeFileSync(path.join(docs, fileName), markdown(document), 'utf8');
      return { title: document.title, slug: fileName, url: document.sourceUrl || '' };
    });
    fs.writeFileSync(path.join(bundle, 'toc.json'), JSON.stringify({ name: 'UniSearch 知识库', toc }, null, 2), 'utf8');
    return { outputPath: bundle, itemCount: documents.length, metadata: { format: 'yuque-bundle' } };
  },
});

exporterRegistry.register({
  id: 'feishu',
  version: '1.0.0',
  name: '飞书 文档包',
  async export(documents, context): Promise<ExportResult> {
    const bundle = path.join(context.outputDirectory, 'Feishu');
    const docs = path.join(bundle, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    const indexList = documents.map((document, index) => {
      const fileName = `${String(index + 1).padStart(3, '0')}-${safeName(document.title)}.md`;
      fs.writeFileSync(path.join(docs, fileName), markdown(document), 'utf8');
      return { doc_id: document.documentId, title: document.title, path: `docs/${fileName}` };
    });
    fs.writeFileSync(path.join(bundle, 'index.json'), JSON.stringify({ title: 'UniSearch 知识空间', items: indexList }, null, 2), 'utf8');
    return { outputPath: bundle, itemCount: documents.length, metadata: { format: 'feishu-docs' } };
  },
});

export class ExportService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  async run(exporterId: string, workflowId?: string): Promise<any> {
    const exporter = exporterRegistry.get(exporterId);
    const documents = new AnalysisService(this.databaseProvider).documents(workflowId);
    const exportId = randomUUID();
    const root = path.join(path.dirname(getDatabasePath()), 'exports', exportId);
    fs.mkdirSync(root, { recursive: true });
    const result = await exporter.export(documents, { workflowId, outputDirectory: root, now: () => new Date() });
    const record = {
      export_id: exportId,
      exporter_id: exporter.id,
      workflow_id: workflowId || null,
      output_path: result.outputPath,
      item_count: result.itemCount,
      metadata: result.metadata,
      created_at: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO export_runs
        (export_id, exporter_id, workflow_id, output_path, item_count, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.export_id, record.exporter_id, record.workflow_id, record.output_path, record.item_count, JSON.stringify(record.metadata), record.created_at);
    return record;
  }
}

export const exportService = new ExportService();

