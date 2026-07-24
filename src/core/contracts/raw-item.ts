import { z } from 'zod';

export const RAW_ITEM_SCHEMA_VERSION = 1 as const;

export const rawItemKindSchema = z.enum([
  'post',
  'article',
  'video',
  'image',
  'comment',
  'profile',
  'search_result',
  'ai_answer',
  'job',
  'complaint',
]);

export type RawItemKind = z.infer<typeof rawItemKindSchema>;

export const rawItemHintsSchema = z.object({
  title: z.string().optional(),
  text: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.union([z.string(), z.number()]).optional(),
  mediaUrls: z.array(z.string()).optional(),
  coverUrl: z.string().optional(),
}).strict();

export const rawItemSchema = z.object({
  schemaVersion: z.literal(RAW_ITEM_SCHEMA_VERSION),
  id: z.string().min(1),
  source: z.string().min(1),
  kind: rawItemKindSchema,
  sourceItemId: z.string().optional(),
  sourceUrl: z.string().optional(),
  parentId: z.string().optional(),
  fetchedAt: z.string().datetime(),
  hints: rawItemHintsSchema,
  payload: z.unknown(),
  metadata: z.record(z.unknown()).default({}),
});

export type RawItem = z.infer<typeof rawItemSchema>;
export type RawItemHints = z.infer<typeof rawItemHintsSchema>;

export function parseRawItem(value: unknown): RawItem {
  return rawItemSchema.parse(value);
}
