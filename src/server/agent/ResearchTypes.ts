export type ResearchAction = 'knowledge_query' | 'live_search' | 'direct_web_read' | 'finish';

export interface ResearchStepDecision {
  action: ResearchAction;
  reason: string;
  query?: string;
  urls?: string[];
}

export interface ResearchEvidence {
  id: string;
  key: string;
  title: string;
  excerpt: string;
  source: string;
  sourceUrl?: string;
  publishedAt?: string;
  evidenceType: 'knowledge' | 'search' | 'web_page';
}

export interface ResearchLoopState {
  step: number;
  maxSteps: number;
  searchCalls: number;
  maxSearchCalls: number;
  readUrls: number;
  maxReadUrls: number;
  consecutiveNoEvidence: number;
  elapsedMs: number;
}
