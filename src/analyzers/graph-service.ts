import crypto from 'crypto';
import type { Database } from 'better-sqlite3';
import type { CanonicalDocument } from '../core/documents/canonical';
import { getDb } from '../database/connection';
import { AnalysisService } from './registry';
import { AnalyticsRepository } from '../database/repository';
import { DocumentEngine } from '../document/document-engine';

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
  return [...new Set(keys.flatMap((key) => textValues(document.attributes[key])).filter((value) => value.length <= 80 && value !== '指定作品' && value !== '指定内容' && !/^https?:\/\//i.test(value) && !/^www\./i.test(value)))];
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
    const entityRules = this.listEntityRulesForScope(scopeType, scopeId);
    const mergeLabels = new Map<string, string>();
    const splitDocuments = new Map<string, string>();
    const ignoreLabels = new Set<string>();
    const linkPairs: Array<{ fromLabel: string; toLabel: string; relation: string; nodeType: string }> = [];
    for (const rule of entityRules) {
      if (rule.operation === 'merge') {
        for (const label of rule.sourceLabels) mergeLabels.set(`${rule.nodeType}:${label.toLocaleLowerCase()}`, rule.targetLabel);
      } else if (rule.operation === 'split') {
        for (const documentId of rule.documentIds) splitDocuments.set(`${rule.nodeType}:${documentId}`, rule.targetLabel);
      } else if (rule.operation === 'ignore') {
        for (const label of rule.sourceLabels) ignoreLabels.add(`${rule.nodeType}:${label.toLocaleLowerCase()}`);
      } else if (rule.operation === 'link') {
        if (rule.sourceLabels.length >= 2) {
          linkPairs.push({ fromLabel: rule.sourceLabels[0], toLabel: rule.sourceLabels[1], relation: rule.targetLabel || 'co_occurs', nodeType: rule.nodeType });
        }
      }
    }

    const correctedLabel = (type: GraphNode['type'], label: string, documentId: string): string => {
      const split = splitDocuments.get(`${type}:${documentId}`);
      if (split) return split;
      let current = label.trim();
      const visited = new Set<string>();
      while (!visited.has(current.toLocaleLowerCase())) {
        visited.add(current.toLocaleLowerCase());
        const merged = mergeLabels.get(`${type}:${current.toLocaleLowerCase()}`);
        if (!merged) break;
        current = merged;
      }
      return current;
    };

    const addNode = (type: GraphNode['type'], label: string, document: CanonicalDocument, metadata: Record<string, unknown> = {}) => {
      const normalized = correctedLabel(type, label, document.documentId);
      if (ignoreLabels.has(`${type}:${normalized.toLocaleLowerCase()}`)) return undefined;
      const id = stableId(type, normalized.toLocaleLowerCase());
      const current = nodes.get(id) || { id, type, label: normalized, weight: 0, documentIds: [], metadata };
      if (!current.documentIds.includes(document.documentId)) {
        current.documentIds.push(document.documentId);
        current.weight += 1;
      }
      nodes.set(id, current);
      return id;
    };
    const addEdge = (from: string | undefined, to: string | undefined, relation: GraphEdge['relation'], document?: CanonicalDocument) => {
      if (!from || !to || from === to) return;
      const id = stableId('edge', `${from}|${relation}|${to}`);
      const current = edges.get(id) || { id, from, to, relation, weight: 0, documentIds: [], evidence: [] };
      if (document && !current.documentIds.includes(document.documentId)) {
        current.documentIds.push(document.documentId);
        current.weight += 1;
        if (current.evidence.length < 5) current.evidence.push({
          documentId: document.documentId,
          title: document.title,
          ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
          excerpt: excerpt(document),
        });
      } else if (!document && current.weight === 0) {
        current.weight = 1;
      }
      edges.set(id, current);
    };

    for (const document of documents) {
      const subjectLabel = document.subject.name || document.subject.id;
      const subjectId = subjectLabel
        ? addNode('subject', subjectLabel, document, { subjectType: document.subject.type, subjectId: document.subject.id })
        : undefined;
      const platformId = addNode('platform', document.platform, document);
      if (subjectId && platformId) addEdge(subjectId, platformId, 'published_on', document);
      if (document.keyword) {
        const trimmed = document.keyword.trim();
        if (trimmed && trimmed !== '指定作品' && trimmed !== '指定内容' && !/^https?:\/\//i.test(trimmed) && !/^www\./i.test(trimmed) && !trimmed.startsWith('作者:') && !trimmed.startsWith('创作者:') && !trimmed.startsWith('UP:')) {
          const keywordId = addNode('keyword', trimmed, document);
          if (subjectId && keywordId) addEdge(subjectId, keywordId, 'matched_keyword', document);
          if (keywordId && platformId) addEdge(keywordId, platformId, 'co_occurs', document);
        }
      }
      for (const topic of topics(document)) {
        const topicId = addNode('topic', topic, document);
        if (subjectId && topicId) addEdge(subjectId, topicId, 'mentions_topic', document);
      }
    }

    for (const link of linkPairs) {
      const fromNode = Array.from(nodes.values()).find((n) => n.label.toLocaleLowerCase() === link.fromLabel.toLocaleLowerCase());
      const toNode = Array.from(nodes.values()).find((n) => n.label.toLocaleLowerCase() === link.toLabel.toLocaleLowerCase());
      if (fromNode && toNode) {
        const edgeId = stableId('edge', `${fromNode.id}|${link.relation}|${toNode.id}`);
        if (!edges.has(edgeId)) {
          edges.set(edgeId, {
            id: edgeId,
            from: fromNode.id,
            to: toNode.id,
            relation: link.relation as any,
            weight: 1,
            documentIds: [],
            evidence: [{ documentId: 'manual', title: '用户自定义关联', excerpt: `手动关联「${fromNode.label}」与「${toNode.label}」（${link.relation}）` }],
          });
        }
      }
    }

    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO graph_snapshots
        (graph_id, scope_type, scope_id, document_count, node_count, edge_count, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(graphId, scopeType, scopeId, documents.length, nodes.size, edges.size,
          JSON.stringify({ projector: 'deterministic.v2', entityRuleCount: entityRules.length, relationTypes: ['published_on', 'matched_keyword', 'co_occurs', 'mentions_topic'] }), now);
      const insertNode = this.db.prepare(`INSERT INTO graph_nodes
        (graph_id, node_id, node_type, label, weight, document_ids_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const node of nodes.values()) insertNode.run(graphId, node.id, node.type, node.label, node.weight, JSON.stringify(node.documentIds), JSON.stringify(node.metadata));
      const insertEdge = this.db.prepare(`INSERT INTO graph_edges
        (graph_id, edge_id, from_node_id, to_node_id, relation_type, weight, document_ids_json, evidence_json, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}')`);
      for (const edge of edges.values()) insertEdge.run(graphId, edge.id, edge.from, edge.to, edge.relation, edge.weight, JSON.stringify(edge.documentIds), JSON.stringify(edge.evidence));
    })();
    return this.get(graphId, scope);
  }

  countDocuments(scope: GraphScope): number {
    try {
      if (scope.runId) {
        const row = this.db.prepare('SELECT COUNT(DISTINCT document_id) as c FROM document_sources WHERE run_id=?').get(scope.runId) as { c: number } | undefined;
        return row?.c || 0;
      }
      if (scope.threadId) {
        const row = this.db.prepare(`
          SELECT COUNT(DISTINCT ds.document_id) as c FROM document_sources ds
          JOIN crawl_runs r ON r.run_id=ds.run_id WHERE r.thread_id=?
        `).get(scope.threadId) as { c: number } | undefined;
        return row?.c || 0;
      }
      if (scope.workflowId) {
        const row = this.db.prepare(`
          SELECT COUNT(DISTINCT ds.document_id) as c FROM document_sources ds
          JOIN crawl_runs r ON r.run_id=ds.run_id
          JOIN workflow_runs w ON w.workflow_id=r.workflow_id
          JOIN documents d ON d.document_id=ds.document_id
          JOIN document_versions dv ON dv.version_id=ds.document_version_id
          WHERE r.workflow_id=? AND (w.incremental_since IS NULL OR d.created_at > w.incremental_since OR dv.created_at > w.incremental_since)
        `).get(scope.workflowId) as { c: number } | undefined;
        return row?.c || 0;
      }
      const row = this.db.prepare('SELECT COUNT(*) as c FROM documents').get() as { c: number } | undefined;
      return row?.c || 0;
    } catch {
      return 0;
    }
  }

  latest(scope: GraphScope): any | null {
    const scopeType = scope.runId ? 'run' : scope.threadId ? 'thread' : scope.workflowId ? 'workflow' : 'all';
    const scopeId = scope.runId || scope.threadId || scope.workflowId || 'all';
    const row = this.db.prepare('SELECT graph_id FROM graph_snapshots WHERE scope_type=? AND scope_id=? ORDER BY created_at DESC LIMIT 1').get(scopeType, scopeId) as any;
    return row ? this.get(row.graph_id, scope) : null;
  }

  get(graphId: string, scope?: GraphScope): any {
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

    const resolvedScope: GraphScope = scope || this.scopeFromSnapshot(snapshot);
    const currentDocumentCount = this.countDocuments(resolvedScope);
    const snapshotDocumentCount = Number(snapshot.document_count || 0);
    const isOutdated = currentDocumentCount !== snapshotDocumentCount;
    const newDocumentCount = Math.max(0, currentDocumentCount - snapshotDocumentCount);

    return {
      id: snapshot.graph_id,
      scopeType: snapshot.scope_type,
      scopeId: snapshot.scope_id,
      documentCount: snapshot.document_count,
      snapshotDocumentCount,
      currentDocumentCount,
      isOutdated,
      newDocumentCount,
      createdAt: snapshot.created_at,
      metadata: JSON.parse(snapshot.metadata_json),
      nodes,
      edges,
    };
  }

  evidence(graphId: string, elementId: string): any {
    const node = this.db.prepare('SELECT * FROM graph_nodes WHERE graph_id=? AND node_id=?').get(graphId, elementId) as any;
    const edge = node ? null : this.db.prepare('SELECT * FROM graph_edges WHERE graph_id=? AND edge_id=?').get(graphId, elementId) as any;
    if (!node && !edge) throw new Error('Graph element not found');
    const documentIds: string[] = JSON.parse((node || edge).document_ids_json || '[]');
    const engine = new DocumentEngine(this.databaseProvider);
    const documents = documentIds.slice(0, 50).flatMap((documentId) => {
      const document = engine.get(documentId);
      return document ? [{
        documentId: document.documentId,
        title: document.title,
        platform: document.platform,
        kind: document.kind,
        sourceUrl: document.sourceUrl,
        excerpt: (document.summary || document.markdown || document.title).replace(/\s+/g, ' ').slice(0, 300),
      }] : [];
    });
    return {
      element: node
        ? { id: node.node_id, type: node.node_type, label: node.label, weight: node.weight }
        : { id: edge.edge_id, type: 'edge', relation: edge.relation_type, weight: edge.weight, from: edge.from_node_id, to: edge.to_node_id },
      documents,
    };
  }

  listEntityRules(graphId: string): any[] {
    const snapshot = this.db.prepare('SELECT scope_type, scope_id FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    if (!snapshot) throw new Error('Graph snapshot not found');
    return this.listEntityRulesForScope(snapshot.scope_type, snapshot.scope_id);
  }

  mergeEntities(graphId: string, nodeIds: string[], targetLabel: string): any {
    const label = targetLabel.trim();
    if (!label) throw new Error('合并后的实体名称不能为空');
    const snapshot = this.db.prepare('SELECT scope_type, scope_id FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    if (!snapshot) throw new Error('Graph snapshot not found');
    const placeholders = nodeIds.map(() => '?').join(',');
    if (!placeholders || nodeIds.length < 2) throw new Error('至少选择两个实体进行合并');
    const nodes = this.db.prepare(`SELECT node_id, node_type, label FROM graph_nodes WHERE graph_id=? AND node_id IN (${placeholders})`)
      .all(graphId, ...nodeIds) as any[];
    if (nodes.length !== new Set(nodeIds).size) throw new Error('选择中包含不存在的图谱实体');
    const types = new Set(nodes.map((node) => node.node_type));
    if (types.size !== 1) throw new Error('只能合并同类型实体');
    const nodeType = String(nodes[0].node_type);
    if (nodeType === 'platform') throw new Error('平台作为物理信源维度，受系统保护不可合并');
    if (!['subject', 'topic', 'keyword'].includes(nodeType)) throw new Error('不支持此类型实体的人工合并');
    this.db.prepare(`INSERT INTO graph_entity_rules
      (rule_id, scope_type, scope_id, node_type, operation, source_labels_json, target_label, document_ids_json, created_at)
      VALUES (?, ?, ?, ?, 'merge', ?, ?, '[]', ?)`)
      .run(crypto.randomUUID(), snapshot.scope_type, snapshot.scope_id, nodeType,
        JSON.stringify(nodes.map((node) => node.label)), label, new Date().toISOString());
    return this.rebuild(this.scopeFromSnapshot(snapshot));
  }

  splitEntity(graphId: string, nodeId: string, documentIds: string[], targetLabel: string): any {
    const label = targetLabel.trim();
    if (!label) throw new Error('拆分后的实体名称不能为空');
    const snapshot = this.db.prepare('SELECT scope_type, scope_id FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    const node = this.db.prepare('SELECT node_type, document_ids_json FROM graph_nodes WHERE graph_id=? AND node_id=?').get(graphId, nodeId) as any;
    if (!snapshot || !node) throw new Error('Graph entity not found');
    const nodeType = String(node.node_type);
    if (nodeType === 'platform') throw new Error('平台作为物理信源维度，受系统保护不可拆分');
    if (!['subject', 'topic'].includes(nodeType)) throw new Error('不支持此类型实体的人工拆分');
    const available = new Set<string>(JSON.parse(node.document_ids_json || '[]'));
    const selected = [...new Set(documentIds.map(String))].filter((documentId) => available.has(documentId));
    if (!selected.length || selected.length >= available.size) throw new Error('拆分必须选择该实体的部分证据文档');
    this.db.prepare(`INSERT INTO graph_entity_rules
      (rule_id, scope_type, scope_id, node_type, operation, source_labels_json, target_label, document_ids_json, created_at)
      VALUES (?, ?, ?, ?, 'split', '[]', ?, ?, ?)`)
      .run(crypto.randomUUID(), snapshot.scope_type, snapshot.scope_id, node.node_type, label, JSON.stringify(selected), new Date().toISOString());
    return this.rebuild(this.scopeFromSnapshot(snapshot));
  }

  ignoreEntity(graphId: string, nodeId: string): any {
    const snapshot = this.db.prepare('SELECT scope_type, scope_id FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    const node = this.db.prepare('SELECT node_type, label FROM graph_nodes WHERE graph_id=? AND node_id=?').get(graphId, nodeId) as any;
    if (!snapshot || !node) throw new Error('Graph entity not found');
    const nodeType = String(node.node_type);
    if (nodeType === 'platform') throw new Error('平台为客观信源节点，受系统保护不可移出');
    if (!['subject', 'topic', 'keyword'].includes(nodeType)) throw new Error('不支持移出此类型实体');
    this.db.prepare(`INSERT INTO graph_entity_rules
      (rule_id, scope_type, scope_id, node_type, operation, source_labels_json, target_label, document_ids_json, created_at)
      VALUES (?, ?, ?, ?, 'ignore', ?, '', '[]', ?)`)
      .run(crypto.randomUUID(), snapshot.scope_type, snapshot.scope_id, node.node_type, JSON.stringify([node.label]), new Date().toISOString());
    return this.rebuild(this.scopeFromSnapshot(snapshot));
  }

  linkEntities(graphId: string, fromNodeId: string, toNodeId: string, relation = 'co_occurs'): any {
    const rel = (relation || 'co_occurs').trim();
    if (!rel) throw new Error('关联关系名称不能为空');
    const snapshot = this.db.prepare('SELECT scope_type, scope_id FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    const fromNode = this.db.prepare('SELECT node_type, label FROM graph_nodes WHERE graph_id=? AND node_id=?').get(graphId, fromNodeId) as any;
    const toNode = this.db.prepare('SELECT node_type, label FROM graph_nodes WHERE graph_id=? AND node_id=?').get(graphId, toNodeId) as any;
    if (!snapshot || !fromNode || !toNode) throw new Error('Graph entities not found');
    this.db.prepare(`INSERT INTO graph_entity_rules
      (rule_id, scope_type, scope_id, node_type, operation, source_labels_json, target_label, document_ids_json, created_at)
      VALUES (?, ?, ?, ?, 'link', ?, ?, '[]', ?)`)
      .run(crypto.randomUUID(), snapshot.scope_type, snapshot.scope_id, fromNode.node_type, JSON.stringify([fromNode.label, toNode.label]), rel, new Date().toISOString());
    return this.rebuild(this.scopeFromSnapshot(snapshot));
  }

  removeEntityRule(graphId: string, ruleId: string): any {
    const snapshot = this.db.prepare('SELECT scope_type, scope_id FROM graph_snapshots WHERE graph_id=?').get(graphId) as any;
    if (!snapshot) throw new Error('Graph snapshot not found');
    const result = this.db.prepare('DELETE FROM graph_entity_rules WHERE rule_id=? AND scope_type=? AND scope_id=?')
      .run(ruleId, snapshot.scope_type, snapshot.scope_id);
    if (!result.changes) throw new Error('Entity rule not found');
    return this.rebuild(this.scopeFromSnapshot(snapshot));
  }

  private listEntityRulesForScope(scopeType: string, scopeId: string): any[] {
    return (this.db.prepare('SELECT * FROM graph_entity_rules WHERE scope_type=? AND scope_id=? ORDER BY created_at')
      .all(scopeType, scopeId) as any[]).map((row) => ({
      ruleId: row.rule_id,
      nodeType: row.node_type,
      operation: row.operation,
      sourceLabels: JSON.parse(row.source_labels_json || '[]'),
      targetLabel: row.target_label,
      documentIds: JSON.parse(row.document_ids_json || '[]'),
      createdAt: row.created_at,
    }));
  }

  private scopeFromSnapshot(snapshot: { scope_type: string; scope_id: string }): GraphScope {
    if (snapshot.scope_type === 'run') return { runId: snapshot.scope_id };
    if (snapshot.scope_type === 'thread') return { threadId: snapshot.scope_id };
    if (snapshot.scope_type === 'workflow') return { workflowId: snapshot.scope_id };
    return {};
  }
}

export const graphService = new GraphService();
