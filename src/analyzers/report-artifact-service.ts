import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import { getDb } from '../database/connection';
import { graphService, GraphService } from './graph-service';
import { formalReportRenderer } from './formal-report-renderer';

export interface CreateReportArtifactInput {
  reportId: string;
  threadId?: string;
  workflowId?: string;
  title: string;
  content: string;
  sources?: Array<Record<string, unknown>>;
  reproducibility?: Record<string, unknown>;
}

function parseJson(value: string): any { return JSON.parse(value || '{}'); }
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function markdownToHtml(markdown: string): string {
  const escaped = escapeHtml(markdown);
  return escaped.split('\n').map((line) => {
    if (line.startsWith('### ')) return `<h3>${line.slice(4)}</h3>`;
    if (line.startsWith('## ')) return `<h2>${line.slice(3)}</h2>`;
    if (line.startsWith('# ')) return `<h1>${line.slice(2)}</h1>`;
    if (line.startsWith('- ')) return `<li>${line.slice(2)}</li>`;
    if (line.startsWith('&gt; ')) return `<blockquote>${line.slice(5)}</blockquote>`;
    return line ? `<p>${line}</p>` : '';
  }).join('\n').replace(/\[S(\d+)\]/g, '<span class="citation">[S$1]</span>');
}

function reportSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading = '正文';
  let lines: string[] = [];
  const flush = () => sections.set(heading, lines.join('\n').trim());
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (match) {
      flush();
      heading = match[1].trim();
      lines = [];
    } else lines.push(line);
  }
  flush();
  return sections;
}

export class ReportArtifactService {
  constructor(
    private readonly databaseProvider: () => Database = getDb,
    private readonly graphs: Pick<GraphService, 'latest' | 'rebuild'> = graphService,
  ) {}
  private get db(): Database { return this.databaseProvider(); }

  create(input: CreateReportArtifactInput): any {
    const scope = input.workflowId ? { workflowId: input.workflowId } : { threadId: input.threadId };
    const graph = this.graphs.latest(scope) || this.graphs.rebuild(scope);
    const sources = input.sources || [];
    const documentIds = [...new Set(sources.map((source) => String(source.documentId || '')).filter(Boolean))];
    const documentVersions = Object.fromEntries(documentIds.map((documentId) => {
      const row = this.db.prepare(`SELECT revision_hash FROM document_versions
        WHERE document_id=? ORDER BY created_at DESC LIMIT 1`).get(documentId) as any;
      return [documentId, String(row?.revision_hash || '')];
    }));
    const artifactId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const workflow = input.workflowId
      ? this.db.prepare('SELECT base_workflow_id FROM workflow_runs WHERE workflow_id=?').get(input.workflowId) as any
      : null;
    const baselineArtifact = workflow?.base_workflow_id
      ? this.db.prepare('SELECT * FROM report_artifacts WHERE workflow_id=? ORDER BY created_at DESC LIMIT 1')
        .get(workflow.base_workflow_id) as any
      : null;
    const previous = baselineArtifact
      ? this.db.prepare('SELECT * FROM report_artifacts WHERE series_id=? ORDER BY version_number DESC LIMIT 1')
        .get(baselineArtifact.series_id) as any
      : null;
    const seriesId = previous?.series_id || artifactId;
    const versionNumber = previous
      ? Number((this.db.prepare('SELECT MAX(version_number) AS version FROM report_artifacts WHERE series_id=?')
        .get(seriesId) as any)?.version || 0) + 1
      : 1;
    const reproducibility = {
      schemaVersion: 1,
      immutable: true,
      seriesId,
      versionNumber,
      previousArtifactId: previous?.artifact_id || null,
      documentIds,
      documentVersions,
      graphId: graph.id,
      generatedAt: createdAt,
      ...input.reproducibility,
    };
    this.db.prepare(`INSERT INTO report_artifacts
      (artifact_id, report_id, series_id, version_number, previous_artifact_id, thread_id, workflow_id, title, content, document_ids_json, citations_json, graph_id, reproducibility_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(artifactId, input.reportId, seriesId, versionNumber, previous?.artifact_id || null,
        input.threadId || null, input.workflowId || null, input.title, input.content,
        JSON.stringify(documentIds), JSON.stringify(sources), graph.id, JSON.stringify(reproducibility), createdAt);
    return this.get(artifactId);
  }

  get(artifactId: string): any {
    const row = this.db.prepare('SELECT * FROM report_artifacts WHERE artifact_id=?').get(artifactId) as any;
    if (!row) throw new Error('Report artifact not found');
    return {
      artifactId: row.artifact_id,
      reportId: row.report_id,
      seriesId: row.series_id,
      versionNumber: Number(row.version_number),
      previousArtifactId: row.previous_artifact_id,
      threadId: row.thread_id,
      workflowId: row.workflow_id,
      title: row.title,
      content: row.content,
      documentIds: parseJson(row.document_ids_json),
      citations: parseJson(row.citations_json),
      graphId: row.graph_id,
      reproducibility: parseJson(row.reproducibility_json),
      createdAt: row.created_at,
    };
  }

  list(threadId?: string, workflowId?: string): any[] {
    const where = threadId ? 'WHERE thread_id=?' : workflowId ? 'WHERE workflow_id=?' : '';
    const params = threadId ? [threadId] : workflowId ? [workflowId] : [];
    return (this.db.prepare(`SELECT artifact_id FROM report_artifacts ${where} ORDER BY created_at DESC`).all(...params) as any[])
      .map((row) => this.get(row.artifact_id));
  }

  compare(artifactId: string, againstArtifactId?: string): any {
    const current = this.get(artifactId);
    const previousId = againstArtifactId || current.previousArtifactId;
    if (!previousId) throw new Error('该报告没有可比较的上一版本');
    const previous = this.get(previousId);
    if (current.seriesId !== previous.seriesId) throw new Error('只能比较同一报告序列中的版本');
    const currentDocuments = new Set<string>(current.documentIds);
    const previousDocuments = new Set<string>(previous.documentIds);
    const currentSections = reportSections(current.content);
    const previousSections = reportSections(previous.content);
    const addedSections = [...currentSections.keys()].filter((key) => !previousSections.has(key));
    const removedSections = [...previousSections.keys()].filter((key) => !currentSections.has(key));
    const changedSections = [...currentSections.keys()].filter((key) =>
      previousSections.has(key) && currentSections.get(key) !== previousSections.get(key));
    const citationKey = (citation: any) => String(citation.documentId || citation.sourceUrl || citation.id || '');
    const currentCitations = new Set(current.citations.map(citationKey).filter(Boolean));
    const previousCitations = new Set(previous.citations.map(citationKey).filter(Boolean));
    const updatedDocuments = [...currentDocuments].filter((id) => previousDocuments.has(id)
      && current.reproducibility.documentVersions?.[id] !== previous.reproducibility.documentVersions?.[id]);
    return {
      seriesId: current.seriesId,
      from: { artifactId: previous.artifactId, versionNumber: previous.versionNumber, createdAt: previous.createdAt },
      to: { artifactId: current.artifactId, versionNumber: current.versionNumber, createdAt: current.createdAt },
      documents: {
        added: [...currentDocuments].filter((id) => !previousDocuments.has(id)),
        removed: [...previousDocuments].filter((id) => !currentDocuments.has(id)),
        updated: updatedDocuments,
        unchanged: [...currentDocuments].filter((id) => previousDocuments.has(id) && !updatedDocuments.includes(id)).length,
      },
      citations: {
        added: [...currentCitations].filter((id) => !previousCitations.has(id)),
        removed: [...previousCitations].filter((id) => !currentCitations.has(id)),
      },
      sections: { added: addedSections, removed: removedSections, changed: changedSections },
      contentChanged: current.content !== previous.content,
    };
  }

  render(artifactId: string, format: 'markdown' | 'html' | 'json'): { body: Buffer; contentType: string; extension: string; filename: string } {
    const artifact = this.get(artifactId);
    const safeTitle = artifact.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '研究报告';
    if (format === 'json') return {
      body: Buffer.from(JSON.stringify(artifact, null, 2)), contentType: 'application/json; charset=utf-8', extension: 'json', filename: `${safeTitle}.json`,
    };
    if (format === 'markdown') {
      const appendix = artifact.citations.length ? [
        '', '## 引用资料', '',
        ...artifact.citations.map((source: any) => `- [${source.id || 'S'}] [${source.title || source.source || '来源'}](${source.sourceUrl || '#'})`),
        '', '---', `报告制品：${artifact.artifactId}`, `生成时间：${artifact.createdAt}`, `图谱快照：${artifact.graphId}`,
      ].join('\n') : '';
      return { body: Buffer.from(`# ${artifact.title}\n\n${artifact.content}${appendix}\n`), contentType: 'text/markdown; charset=utf-8', extension: 'md', filename: `${safeTitle}.md` };
    }
    const citations = artifact.citations.map((source: any) => `<li><strong>${escapeHtml(source.id || 'S')}</strong> <a href="${escapeHtml(source.sourceUrl || '#')}">${escapeHtml(source.title || source.source || '来源')}</a><br><small>${escapeHtml(source.excerpt || '')}</small></li>`).join('');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(artifact.title)}</title><style>body{max-width:920px;margin:40px auto;padding:0 24px;font:16px/1.75 system-ui;color:#18212f}h1,h2,h3{line-height:1.3}blockquote{border-left:4px solid #22a6b3;margin:20px 0;padding:10px 16px;background:#f5f8fa}.citation{color:#087f8c;font-weight:600}a{color:#087f8c}footer{margin-top:48px;padding-top:16px;border-top:1px solid #ddd;color:#667;font-size:12px}@media print{body{margin:0;max-width:none}}</style></head><body><h1>${escapeHtml(artifact.title)}</h1>${markdownToHtml(artifact.content)}${citations ? `<h2>引用资料</h2><ol>${citations}</ol>` : ''}<footer>报告制品 ${artifact.artifactId}<br>生成时间 ${artifact.createdAt}<br>图谱快照 ${artifact.graphId}</footer></body></html>`;
    return { body: Buffer.from(html), contentType: 'text/html; charset=utf-8', extension: 'html', filename: `${safeTitle}.html` };
  }

  async renderFormal(artifactId: string, format: 'pdf' | 'docx'): Promise<{ body: Buffer; contentType: string; extension: string; filename: string }> {
    const artifact = this.get(artifactId);
    const safeTitle = artifact.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '研究报告';
    const body = format === 'pdf'
      ? await formalReportRenderer.pdf(artifact)
      : await formalReportRenderer.docx(artifact);
    return {
      body,
      contentType: format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: format,
      filename: `${safeTitle}.${format}`,
    };
  }
}

export const reportArtifactService = new ReportArtifactService();
