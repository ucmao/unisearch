import { randomUUID } from 'crypto';
import type { Database } from 'better-sqlite3';
import type { Analyzer, AnalysisReport } from '../core/analyzers/types';
import { getDb } from '../database/connection';
import { DocumentEngine } from '../document/document-engine';

export class AnalyzerRegistry {
  private readonly analyzers = new Map<string, Analyzer>();
  register(analyzer: Analyzer): void {
    if (this.analyzers.has(analyzer.id)) throw new Error(`Analyzer already registered: ${analyzer.id}`);
    this.analyzers.set(analyzer.id, analyzer);
  }
  get(id: string): Analyzer {
    const analyzer = this.analyzers.get(id);
    if (!analyzer) throw new Error(`Unknown Analyzer: ${id}`);
    return analyzer;
  }
  list(): Array<Pick<Analyzer, 'id' | 'version' | 'name'>> {
    return [...this.analyzers.values()].map(({ id, version, name }) => ({ id, version, name }));
  }
}

function keywords(text: string): Array<{ keyword: string; count: number }> {
  const stop = new Set(['这个', '那个', '我们', '他们', '以及', '一个', '可以', '没有', '就是', '还是', '进行', '内容', '用户']);
  const values = text.toLocaleLowerCase().match(/[a-z][a-z0-9_-]{2,}|[\u3400-\u9fff]{2,6}/g) || [];
  const counts = new Map<string, number>();
  for (const value of values) if (!stop.has(value)) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].map(([keyword, count]) => ({ keyword, count })).sort((a, b) => b.count - a.count).slice(0, 20);
}

export const analyzerRegistry = new AnalyzerRegistry();
analyzerRegistry.register({
  id: 'extractive.summary',
  version: '1.0.0',
  name: '抽取式资料概览',
  async analyze(documents): Promise<AnalysisReport> {
    const bySource = new Map<string, number>();
    for (const document of documents) {
      const source = String(document.metadata.source || document.provenance.source || 'unknown');
      bySource.set(source, (bySource.get(source) || 0) + 1);
    }
    const topKeywords = keywords(documents.map((document) => `${document.title}\n${document.markdown}`).join('\n'));
    const sourceLines = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([source, count]) => `- ${source}: ${count} 篇`);
    const representative = documents
      .filter((document) => document.title)
      .slice(0, 10)
      .map((document) => `- [${document.title}](${document.sourceUrl || '#'})`);
    return {
      title: 'UniSearch 资料概览',
      content: [
        '# UniSearch 资料概览',
        '',
        `共分析 ${documents.length} 篇资料。`,
        '',
        '## 来源分布',
        '',
        ...(sourceLines.length ? sourceLines : ['- 暂无来源']),
        '',
        '## 高频主题',
        '',
        topKeywords.map((item) => `${item.keyword}（${item.count}）`).join('、') || '暂无可提取主题',
        '',
        '## 代表性资料',
        '',
        ...(representative.length ? representative : ['- 暂无']),
      ].join('\n'),
      metadata: { documentCount: documents.length, sources: Object.fromEntries(bySource), keywords: topKeywords },
    };
  },
});

export class AnalysisService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  documents(workflowId?: string): any[] {
    const ids = workflowId
      ? (this.db.prepare(`
          SELECT DISTINCT ds.document_id FROM document_sources ds
          JOIN crawl_runs r ON r.run_id=ds.run_id WHERE r.workflow_id=?
        `).all(workflowId) as Array<{ document_id: string }>)
      : (this.db.prepare('SELECT document_id FROM documents ORDER BY updated_at DESC').all() as Array<{ document_id: string }>);
    const engine = new DocumentEngine(this.databaseProvider);
    return ids.flatMap(({ document_id }) => {
      const document = engine.get(document_id);
      return document ? [document] : [];
    });
  }

  async run(analyzerId: string, workflowId?: string, options: Record<string, unknown> = {}): Promise<any> {
    const analyzer = analyzerRegistry.get(analyzerId);
    const report = await analyzer.analyze(this.documents(workflowId), options);
    const record = {
      report_id: randomUUID(),
      analyzer_id: analyzer.id,
      analyzer_version: analyzer.version,
      workflow_id: workflowId || null,
      title: report.title,
      content: report.content,
      metadata: report.metadata,
      created_at: new Date().toISOString(),
    };
    this.db.prepare(`
      INSERT INTO analysis_reports
        (report_id, analyzer_id, analyzer_version, workflow_id, title, content, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(record.report_id, record.analyzer_id, record.analyzer_version, record.workflow_id, record.title, record.content, JSON.stringify(record.metadata), record.created_at);
    return record;
  }
}

export const analysisService = new AnalysisService();

