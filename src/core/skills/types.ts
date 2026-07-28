import { z } from 'zod';

export const skillDefinitionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(['core', 'business']).default('core'),
  icon: z.string().min(1).default('sparkles'),
  mentionable: z.boolean().default(false),
  inputs: z.array(z.object({
    key: z.string().min(1),
    required: z.boolean().default(false),
    description: z.string().default(''),
  }).strict()),
  workflow: z.object({
    connectorCapabilities: z.array(z.string()).default([]),
    itemProcessors: z.array(z.string()).default([]),
    analyzers: z.array(z.string()).default([]),
    exporters: z.array(z.string()).default([]),
    outputs: z.array(z.string()).default([]),
  }).strict(),
  defaults: z.object({
    platforms: z.array(z.string()).default([]),
    capability: z.enum(['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve']).default('keyword_search'),
    collectionDepth: z.enum(['quick', 'standard', 'deep']).default('quick'),
    analysis: z.array(z.string()).default([]),
    outputs: z.array(z.string()).default(['csv']),
  }).strict().optional(),
  execution: z.object({
    autoStartWhenExplicitlyInvoked: z.boolean().default(false),
    autoAnalyzeOnCompletion: z.boolean().default(false),
  }).strict().default({
    autoStartWhenExplicitlyInvoked: false,
    autoAnalyzeOnCompletion: false,
  }),
  analysisInstructions: z.string().default(''),
  limitations: z.array(z.string()).default([]),
}).strict();

export type SkillDefinition = z.infer<typeof skillDefinitionSchema>;
