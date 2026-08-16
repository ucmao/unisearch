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

import { parseMarkdown, InlineToken } from './markdown-ast';

function inlinesToHtml(inlines: InlineToken[]): string {
  return inlines.map((token) => {
    switch (token.type) {
      case 'bold':
        return `<strong>${escapeHtml(token.text)}</strong>`;
      case 'italic':
        return `<em>${escapeHtml(token.text)}</em>`;
      case 'boldItalic':
        return `<strong><em>${escapeHtml(token.text)}</em></strong>`;
      case 'code':
        return `<code>${escapeHtml(token.text)}</code>`;
      case 'citation':
        return `<span class="citation">${escapeHtml(token.text)}</span>`;
      case 'link':
        return `<a href="${escapeHtml(token.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(token.text)}</a>`;
      case 'strikethrough':
        return `<del>${escapeHtml(token.text)}</del>`;
      case 'text':
      default:
        return escapeHtml(token.text);
    }
  }).join('');
}

function markdownToHtml(markdown: string): string {
  const blocks = parseMarkdown(markdown);
  return blocks.map((block) => {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(Math.max(block.level, 1), 6);
        return `<h${level}>${inlinesToHtml(block.inlines)}</h${level}>`;
      }
      case 'table': {
        const headerHtml = `<thead><tr>${block.headers.map((h, idx) => {
          const align = block.alignments[idx] || 'left';
          return `<th style="text-align: ${align}">${inlinesToHtml(h)}</th>`;
        }).join('')}</tr></thead>`;

        const rowsHtml = `<tbody>${block.rows.map((row) => `<tr>${row.map((c, idx) => {
          const align = block.alignments[idx] || 'left';
          return `<td style="text-align: ${align}">${inlinesToHtml(c)}</td>`;
        }).join('')}</tr>`).join('')}</tbody>`;

        return `<div class="report-table-wrapper"><table class="report-table">${headerHtml}${rowsHtml}</table></div>`;
      }
      case 'bullet_list': {
        return `<ul>${block.items.map((item) => `<li style="margin-left: ${item.level * 16}px">${inlinesToHtml(item.inlines)}</li>`).join('')}</ul>`;
      }
      case 'ordered_list': {
        return `<ol>${block.items.map((item) => `<li>${inlinesToHtml(item.inlines)}</li>`).join('')}</ol>`;
      }
      case 'blockquote': {
        return `<blockquote><p>${inlinesToHtml(block.inlines)}</p></blockquote>`;
      }
      case 'code_block': {
        return `<pre><code class="language-${escapeHtml(block.lang || 'plaintext')}">${escapeHtml(block.code)}</code></pre>`;
      }
      case 'thematic_break': {
        return `<hr />`;
      }
      case 'paragraph':
      default: {
        return `<p>${inlinesToHtml(block.inlines)}</p>`;
      }
    }
  }).join('\n');
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
    const documentIds = parseJson(row.document_ids_json) as string[];
    let isArchived = false;
    if (documentIds.length) {
      const placeholders = documentIds.map(() => '?').join(',');
      const existingCount = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM documents WHERE document_id IN (${placeholders})`).get(...documentIds) as any)?.count || 0);
      isArchived = existingCount === 0;
    }
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
      documentIds,
      citations: parseJson(row.citations_json),
      graphId: row.graph_id,
      reproducibility: parseJson(row.reproducibility_json),
      createdAt: row.created_at,
      isArchived,
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
    const citations = artifact.citations.map((source: any) => `<li><strong>${escapeHtml(source.id || 'S')}</strong> <a href="${escapeHtml(source.sourceUrl || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title || source.source || '来源')}</a><br><small>${escapeHtml(source.excerpt || '')}</small></li>`).join('');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(artifact.title)}</title><style>
body { max-width: 960px; margin: 40px auto; padding: 0 24px; font: 16px/1.8 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; color: #1e293b; background: #fff; }
h1, h2, h3, h4 { color: #0f172a; font-weight: 700; line-height: 1.35; margin-top: 1.6em; margin-bottom: 0.6em; }
h1 { font-size: 28px; border-bottom: 2px solid #087f8c; padding-bottom: 8px; margin-top: 0.5em; }
h2 { font-size: 22px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
h3 { font-size: 18px; }
h4 { font-size: 16px; }
p { margin: 0.8em 0; line-height: 1.8; color: #334155; }
ul, ol { margin: 0.8em 0; padding-left: 24px; color: #334155; }
li { margin: 0.35em 0; }
blockquote { border-left: 4px solid #087f8c; margin: 1.2em 0; padding: 10px 18px; background: #f0fdfa; color: #134e4a; border-radius: 0 8px 8px 0; }
.report-table-wrapper { margin: 1.5em 0; overflow-x: auto; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
.report-table { width: 100%; border-collapse: collapse; font-size: 14px; text-align: left; }
.report-table th { background: #f8fafc; color: #0f172a; font-weight: 600; padding: 10px 14px; border-bottom: 2px solid #cbd5e1; }
.report-table td { padding: 9px 14px; border-bottom: 1px solid #f1f5f9; color: #334155; }
.report-table tr:nth-child(even) { background: #f8fafc; }
.report-table tr:hover { background: #f1f5f9; }
pre { background: #0f172a; color: #f8fafc; padding: 14px 18px; border-radius: 8px; overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13.5px; line-height: 1.5; margin: 1.2em 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.9em; background: #f1f5f9; color: #be185d; padding: 2px 5px; border-radius: 4px; }
pre code { background: transparent; color: inherit; padding: 0; }
.citation { color: #087f8c; font-weight: 600; background: #e6fffa; padding: 1px 5px; border-radius: 4px; border: 1px solid #b2f5ea; font-size: 0.9em; margin: 0 2px; }
a { color: #087f8c; text-decoration: none; }
a:hover { text-decoration: underline; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; line-height: 1.6; }
@media print { body { margin: 0; max-width: none; padding: 0; } .report-table-wrapper { box-shadow: none; } }
</style></head><body><h1>${escapeHtml(artifact.title)}</h1>${markdownToHtml(artifact.content)}${citations ? `<h2>引用资料与证据溯源</h2><ol>${citations}</ol>` : ''}<footer>研报制品 ${artifact.artifactId}<br>生成时间 ${artifact.createdAt}<br>图谱快照 ${artifact.graphId}</footer></body></html>`;
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

  delete(artifactId: string): boolean {
    const changes = this.db.prepare('DELETE FROM report_artifacts WHERE artifact_id=?').run(artifactId).changes;
    this.db.prepare('DELETE FROM analysis_reports WHERE report_id=?').run(artifactId);
    return changes > 0;
  }

  deleteBatch(artifactIds: string[]): number {
    const ids = [...new Set(artifactIds.filter(Boolean))];
    if (!ids.length) return 0;
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM analysis_reports WHERE report_id IN (${placeholders})`).run(...ids);
    return this.db.prepare(`DELETE FROM report_artifacts WHERE artifact_id IN (${placeholders})`).run(...ids).changes;
  }
}

export const reportArtifactService = new ReportArtifactService();
