import type { ConnectorBudgetModel } from './types';

export interface DepthPreset {
  maxItems?: number;
  collectComments?: boolean;
  collectSubComments?: boolean;
}

type DepthLevel = 'quick' | 'standard' | 'deep';

const PRESETS: Record<ConnectorBudgetModel, Record<DepthLevel, DepthPreset>> = {
  scroll_count: {
    quick: { maxItems: 30, collectComments: false, collectSubComments: false },
    standard: { maxItems: 50, collectComments: true, collectSubComments: false },
    deep: { maxItems: 100, collectComments: true, collectSubComments: true },
  },
  true_pagination: {
    quick: { maxItems: 20, collectComments: false, collectSubComments: false },
    standard: { maxItems: 50, collectComments: true, collectSubComments: false },
    deep: { maxItems: 100, collectComments: true, collectSubComments: true },
  },
  // Depth has no meaningful effect here: one keyword always yields one answer.
  fixed_per_keyword: {
    quick: {},
    standard: {},
    deep: {},
  },
  // Fetches an explicit id/link; depth only toggles whether comments ride along.
  single_target: {
    quick: { collectComments: false, collectSubComments: false },
    standard: { collectComments: true, collectSubComments: false },
    deep: { collectComments: true, collectSubComments: true },
  },
};

export function resolveDepthPreset(
  budgetModel: ConnectorBudgetModel,
  depth: DepthLevel | 'custom',
): DepthPreset {
  return depth === 'custom' ? {} : PRESETS[budgetModel][depth];
}
