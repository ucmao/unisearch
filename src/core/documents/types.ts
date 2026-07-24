import { z } from 'zod';

export const DOCUMENT_SCHEMA_VERSION = 1 as const;

export const provenanceSchema = z.object({
  source: z.string().min(1),
  sourceItemId: z.string().optional(),
  sourceUrl: z.string().optional(),
  rawItemId: z.string().min(1),
  runId: z.string().optional(),
  fetchedAt: z.string().datetime(),
}).strict();

export const assetSchema = z.object({
  assetId: z.string().min(1),
  documentId: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio', 'file', 'unknown']),
  url: z.string().min(1),
  mimeType: z.string().optional(),
  localPath: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
}).strict();

export const artifactSchema = z.object({
  artifactId: z.string().min(1),
  documentId: z.string().min(1),
  type: z.enum(['markdown', 'transcript', 'subtitle', 'thumbnail', 'metadata', 'analysis', 'other']),
  processorId: z.string().min(1),
  processorVersion: z.string().min(1),
  inputHash: z.string().min(1),
  content: z.string().default(''),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
}).strict();

export const documentSchema = z.object({
  schemaVersion: z.literal(DOCUMENT_SCHEMA_VERSION),
  documentId: z.string().min(1),
  canonicalKey: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  markdown: z.string(),
  author: z.string(),
  publishedAt: z.union([z.string(), z.number()]).optional(),
  sourceUrl: z.string().optional(),
  language: z.string().default('und'),
  contentHash: z.string().min(1),
  metadata: z.record(z.unknown()).default({}),
  provenance: provenanceSchema,
  assets: z.array(assetSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type Provenance = z.infer<typeof provenanceSchema>;
export type Asset = z.infer<typeof assetSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Document = z.infer<typeof documentSchema>;
