import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import type { CanonicalDocument } from '../core/documents/canonical';
import { getDb } from '../database/connection';
import { AnalysisService } from './registry';
import { AnalyticsRepository } from '../database/repository';

export type GraphScope = { threadId?: string; workflowId?: string; runId?: string };

export interface GraphNode {
  id: string;
  type: 'subject' | 'keyword' | 'platform' | 'topic';
  label: string;
  weight: number;
  documentIds: string[];
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  relation: 'published_on' | 'matched_keyword' | 'co_occurs' | 'mentions_topic';
  weight: number;
  documentIds: string[];
  evidence: Array<{ documentId: string; title: string; sourceUrl?: string; excerpt: string }>;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${crypto.createHash('sha1').update(value).digest('hex').slice(0, 20)}`;
}

function textValues(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,，、;；|]/).map((item) => item.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(textValues);
  return [];
}

function topics(document: CanonicalDocument): string[] {
  const keys = ['brand', 'company', 'merchant', 'tags', 'categories', 'primaryCategory', 'language'];
  return [...new Set(keys.flatMap((key) => textValues(document.attributes[key])).filter((value) => value.length <= 80))];
}

function excerpt(document: CanonicalDocument): string {
  return (document.summary || document.markdown || document.title).replace(/\s+/g, ' ').trim().slice(0, 220);
}

export class GraphService {
  constructor(private readonly databaseProvider: () => Database = getDb) {}
  private get db(): Database { return this.databaseProvider(); }

  rebuild(scope: GraphScope): any {
    const scopeType = scope.runId ? 'run' : scope.threadId ? 'thread' : scope.workflowId ? 'workflow' : 'all';
    const scopeId = scope.runId || scope.threadId || scope.workflowId || 'all';
    const documents = scope.runId
      ? new AnalyticsRepository(this.databaseProvider).queryDocuments({ run_id: scope.runId, page_size: 1_000_000 }).items
      : new AnalysisService(this.databaseProvider).documents(scope.threadId ? undefined : scope.workflowId, scope.threadId) as CanonicalDocument[];
    const graphId = crypto.randomUUID();
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, GraphEdge>();

    const addNode = (type: GraphNode['type'], label: string, document: CanonicalDocument, metadata: Record<string, unknown> = {}) => {
      const normalized = label.trim();
      const id = stableId(type, normalized.toLocaleLowerCase());
      const current = nodes.get(id) || { id, type, label: normalized, weight: 0, documentIds: [], metadata };
      if (!current.documentIds.includes(document.documentId)) {
        current.documentIds.push(document.documentId);
        current.weight += 1;
      }
      nodes.set(id, current);
      return id;
    };
    const addEdge = (from: string, to: string, relation: GraphEdge['relation'], document: CanonicalDocument) => {
      const id = stableId('edge', `${from}|${relation}|${to}`);
      const current = edges.get(id) || { id, from, to, relation, weight: 0, documentIds: [], evidence: [] };
      if (!current.documentIds.includes(document.documentId)) {
        current.documentIds.push(document.documentId);
        current.weight += 1;
        if (current.evidence.length < 5) current.evidence.push({
          documentId: document.documentId,
          title: document.title,
          ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
          excerpt: excerpt(document),
        });
      }
      edges.set(id, current);
    };

    for (const document of documents) {
      const subjectLabel = document.subject.name || document.subject.id;
      const subjectId = subjectLabel
        ? addNode('subject', subjectLabel, document, { subjectType: document.subject.type, subjectId: document.subject.id })
        : undefined;
      const platformId = addNode('platform', document.platform, document);
      if (subjectId) addEdge(subjectId, platformId, 'published_on', document);
      if (document.keyword) {
        const keywordId = addNode('keyword', document.keyword, document);
        if (subjectId) addEdge(subjectId, keywordId, 'matched_keyword', document);
        addEdge(keywordId, platformId, 'co_occurs', document);
      }
      for (const topic of topics(document)) {
        const topicId = addNode('topic', topic, document);
        if (subjectId) addEdge(subjectId, topicId, 'mentions_topic', document);
      }
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO graph_snapshots
        (graph_id, scope_type, scope_id, document_count, node_count, edge_count, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(graphId, scopeType, scopeId, documents.length, nodes.size, edges.size,
          JSON.stringify({ projector: 'deterministic.v1', relationTypes: ['published_on', 'matched_keyword', 'co_occurs', 'mentions_topic'] }), now);
      const insertNode = this.db.prepare(`INSERT INTO graph_nodes
        (graph_id, node_id, node_type, label, weight, document_ids_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const node of nodes.values()) insertNode.run(graphId, node.id, node.type, node.label, node.weight, JSON.stringify(node.documentIds), JSON.stringify(node.metadata));
      const insertEdge = this.db.prepare(`INSERT INTO graph_edges
        (graph_id, edge_id, from_node_id, to_node_id, relation_type, weight, document_ids_json, evidence_json, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`);
      for (const edge of edges.values()) insertEdge.run(graphId, edge.id, edge.from, edge.to, edge.relation, edge.weight, JSON.stringify(edge.documentIds), JSON.stringify(edge.evidence));
    })();
    return this.get(graphId);
  }

  latest(scope: GraphScope): any | null {
    const scopeType = scope.runId ? 'run' : scope.threadId ? 'thread' : scope.workflowId ? 'workflow' : 'all';
    const scopeId = scope.runId || scope.threadId || scope.workflowId || 'all';
    const row = this.db.prepare('SELECT graph_id FROM graph_snapshots WHERE scope_type=? AND scope_id=? ORDER BY created_at DESC LIMIT 1').get(scopeType, scopeId) as any;
    return row ? this.get(row.graph_id) : null;
  }

  get(graphId: string): any {
    const snapshot = this.db.prepare('SELECT * FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    if (!snapshot) throw new Error('Graph snapshot not found');
    const nodes = (this.db.prepare('SELECT * FROM graph_nodes WHERE graph_id=? ORDER BY weight DESC, label').all(graphId) as any[]).map((row) => ({
      id: row.node_id, type: row.node_type, label: row.label, weight: row.weight,
      documentIds: JSON.parse(row.document_ids_json), metadata: JSON.parse(row.metadata_json),
    }));
    const edges = (this.db.prepare('SELECT * FROM graph_edges WHERE graph_id=? ORDER BY weight DESC').all(graphId) as any[]).map((row) => ({
      id: row.edge_id, from: row.from_node_id, to: row.to_node_id, relation: row.relation_type, weight: row.weight,
      documentIds: JSON.parse(row.document_ids_json), evidence: JSON.parse(row.evidence_json),
    }));
    return {
      id: snapshot.graph_id,
      scopeType: snapshot.scope_type,
      scopeId: snapshot.scope_id,
      documentCount: snapshot.document_count,
      createdAt: snapshot.created_at,
      metadata: JSON.parse(snapshot.metadata_json),
      nodes,
      edges,
    };
  }
}

export const graphService = new GraphService();
