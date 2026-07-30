import { randomUUID } from 'crypto';
import type { Database } from 'better-sqlite3';
import type { Analyzer, AnalysisReport } from '../core/analyzers/types';
import { getDb } from '../database/connection';
import { DocumentEngine } from '../document/document-engine';
import { profileDataset, renderDatasetProfile } from './dataset-profiler';

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

export const analyzerRegistry = new AnalyzerRegistry();
analyzerRegistry.register({
  id: 'dataset.profile',
  version: '1.0.0',
  name: '数据集全量统计',
  async analyze(documents): Promise<AnalysisReport> {
    const datasetProfile = profileDataset(documents);
    return {
      title: 'UniSearch 数据集全量统计',
      content: renderDatasetProfile(datasetProfile),
      metadata: { datasetProfile },
    };
  },
});

export class AnalysisService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  documents(workflowId?: string, threadId?: string): any[] {
    let ids: Array<{ document_id: string }> = [];
    if (workflowId) {
      ids = this.db.prepare(`
        SELECT DISTINCT ds.document_id FROM document_sources ds
        JOIN crawl_runs r ON r.run_id=ds.run_id WHERE r.workflow_id=?
      `).all(workflowId) as Array<{ document_id: string }>;
    } else if (threadId) {
      ids = this.db.prepare(`
        SELECT DISTINCT ds.document_id FROM document_sources ds
        JOIN crawl_runs r ON r.run_id=ds.run_id WHERE r.thread_id=?
      `).all(threadId) as Array<{ document_id: string }>;
    } else {
      ids = this.db.prepare('SELECT document_id FROM documents ORDER BY updated_at DESC').all() as Array<{ document_id: string }>;
    }
    const engine = new DocumentEngine(this.databaseProvider);
    return ids.flatMap(({ document_id }) => {
      const document = engine.get(document_id);
      return document ? [document] : [];
    });
  }

  async run(analyzerId: string, workflowId?: string, options: Record<string, unknown> = {}): Promise<any> {
    const analyzer = analyzerRegistry.get(analyzerId);
    const report = await analyzer.analyze(this.documents(workflowId), options);
    return this.saveReport({
      analyzerId: analyzer.id,
      analyzerVersion: analyzer.version,
      workflowId,
      title: report.title,
      content: report.content,
      metadata: report.metadata,
    });
  }

  saveReport(input: {
    analyzerId: string;
    analyzerVersion: string;
    workflowId?: string;
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  }): any {
    const record = {
      report_id: randomUUID(),
      analyzer_id: input.analyzerId,
      analyzer_version: input.analyzerVersion,
      workflow_id: input.workflowId || null,
      title: input.title,
      content: input.content,
      metadata: input.metadata,
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
