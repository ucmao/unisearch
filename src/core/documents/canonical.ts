import { z } from 'zod';
import { assetSchema, provenanceSchema } from './types';
import { rawItemKindSchema } from '../contracts/raw-item';

export const CANONICAL_DOCUMENT_SCHEMA_VERSION = 2 as const;

export const subjectTypeSchema = z.enum([
  'creator',
  'publisher',
  'company',
  'merchant',
  'ai_platform',
  'forum',
  'unknown',
]);

export const canonicalSubjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  type: subjectTypeSchema,
}).strict();

export const citationSchema = z.object({
  title: z.string().optional(),
  url: z.string().min(1),
  source: z.string().optional(),
}).strict();

/**
 * The v2 connector-facing document contract. It deliberately lives beside the
 * persisted v1 Document until the database batch switches over atomically.
 * Connector mappers may only emit this shape; consumers must not infer business
 * fields from raw payload aliases.
 */
export const canonicalDocumentSchema = z.object({
  schemaVersion: z.literal(CANONICAL_DOCUMENT_SCHEMA_VERSION),
  documentId: z.string().min(1),
  canonicalKey: z.string().min(1),
  kind: rawItemKindSchema,
  platform: z.string().min(1),
  originalPlatform: z.string().optional(),
  sourceItemId: z.string().optional(),
  parentSourceItemId: z.string().optional(),
  sourceUrl: z.string().optional(),
  keyword: z.string().optional(),
  rank: z.number().int().nonnegative().optional(),
  title: z.string(),
  summary: z.string(),
  markdown: z.string(),
  subject: canonicalSubjectSchema,
  publishedAt: z.union([z.string(), z.number()]).optional(),
  sourceUpdatedAt: z.union([z.string(), z.number()]).optional(),
  fetchedAt: z.string().datetime(),
  language: z.string().default('und'),
  metrics: z.record(z.number().nonnegative().nullable()).default({}),
  attributes: z.record(z.unknown()).default({}),
  citations: z.array(citationSchema).default([]),
  assets: z.array(assetSchema).default([]),
  provenance: provenanceSchema,
  contentHash: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type SubjectType = z.infer<typeof subjectTypeSchema>;
export type CanonicalSubject = z.infer<typeof canonicalSubjectSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type CanonicalDocument = z.infer<typeof canonicalDocumentSchema>;
