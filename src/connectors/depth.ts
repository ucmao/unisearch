import type { ConnectorBudgetModel, ConnectorCapability } from './types';

export type DepthLevel = 'quick' | 'standard' | 'deep';

export const DEPTH_LEVELS: DepthLevel[] = ['quick', 'standard', 'deep'];

export const DEPTH_LABELS: Record<DepthLevel, string> = {
  quick: '快速',
  standard: '标准',
  deep: '深度',
};

export interface DepthPreset {
  maxItems?: number;
  collectComments?: boolean;
}

/**
 * How much of a capability's own budget each depth takes, and how comments
 * scale with it. Absolute item counts are NOT stored here: they belong to the
 * connector manifest, which already declares each capability's ceiling. Keeping
 * a second table of numbers here is what let "深度=100" drift out of sync with
 * manifests that allow 500.
 */
const COMMENT_PRESETS: Record<ConnectorBudgetModel, Record<DepthLevel, DepthPreset>> = {
  scroll_count: {
    quick: { collectComments: false },
    standard: { collectComments: true },
    deep: { collectComments: true },
  },
  true_pagination: {
    quick: { collectComments: false },
    standard: { collectComments: true },
    deep: { collectComments: true },
  },
  // One keyword always yields one answer, and there is nothing to comment on.
  fixed_per_keyword: {
    quick: { collectComments: false },
    standard: { collectComments: false },
    deep: { collectComments: false },
  },
  // Fetches an explicit id/link; depth only toggles whether comments ride along.
  single_target: {
    quick: { collectComments: false },
    standard: { collectComments: true },
    deep: { collectComments: true },
  },
};

/** Only these budget models collect "more of the same" as depth increases. */
const ITEM_BUDGET_MODELS = new Set<ConnectorBudgetModel>(['scroll_count', 'true_pagination']);

/** Fallback share of the capability ceiling when a manifest declares no depthBudget. */
const DEFAULT_BUDGET_RATIO: Record<DepthLevel, number> = { quick: 0.1, standard: 0.25, deep: 0.6 };

export function depthAffectsItemCount(capability: ConnectorCapability): boolean {
  return ITEM_BUDGET_MODELS.has(capability.budgetModel)
    && capability.inputFields.some((field) => field.key === 'max_items');
}

/**
 * Comments follow depth only where the capability actually accepts them. Search
 * engines and URL-resolve declare no comment fields, so promising "含评论"
 * there would be describing a toggle the connector never reads.
 */
export function depthAffectsComments(capability: ConnectorCapability): boolean {
  return capability.budgetModel !== 'fixed_per_keyword'
    && capability.inputFields.some((field) => field.key === 'enable_comments');
}

/**
 * Whether the depth selector means anything at all for this capability. The UI
 * used to offer three buttons on AI Q&A and URL-resolve capabilities where every
 * option produced identical runs.
 */
export function depthIsMeaningful(capability: ConnectorCapability): boolean {
  return depthAffectsItemCount(capability) || depthAffectsComments(capability);
}

function maxItemsField(capability: ConnectorCapability) {
  return capability.inputFields.find((field) => field.key === 'max_items');
}

export function resolveDepthPreset(
  capability: ConnectorCapability,
  depth: DepthLevel | 'custom',
): DepthPreset {
  if (depth === 'custom') return {};
  const preset: DepthPreset = depthAffectsComments(capability)
    ? { ...COMMENT_PRESETS[capability.budgetModel][depth] }
    : {};
  if (!depthAffectsItemCount(capability)) return preset;

  const field = maxItemsField(capability);
  if (!field) return preset;
  const ceiling = typeof field.max === 'number' ? field.max : undefined;
  const floor = typeof field.min === 'number' ? field.min : 1;
  const declared = capability.depthBudget?.[depth];
  const fallback = ceiling !== undefined
    ? Math.round(ceiling * DEFAULT_BUDGET_RATIO[depth])
    : Number(field.default) || undefined;
  const resolved = declared ?? fallback;
  if (resolved === undefined) return preset;
  // The manifest ceiling is authoritative: normalizeConnectorRequest throws on
  // anything above it, which would fail the whole step rather than collect less.
  preset.maxItems = Math.max(floor, ceiling === undefined ? resolved : Math.min(resolved, ceiling));
  return preset;
}

/** Human-readable scope for one capability, e.g. "每关键词约 50 条，含评论及可见回复". */
export function describeDepth(capability: ConnectorCapability, depth: DepthLevel | 'custom'): string {
  if (depth === 'custom') return '自定义';
  const preset = resolveDepthPreset(capability, depth);
  const parts: string[] = [];
  if (preset.maxItems !== undefined) parts.push(`每关键词约 ${preset.maxItems} 条`);
  if (depthAffectsComments(capability)) {
    parts.push(preset.collectComments ? '含评论及可见回复' : '不采评论');
  }
  return parts.join('，') || '该能力不受采集深度影响';
}

/**
 * Scope summary for a plan spanning several platforms. Item budgets now differ
 * per connector, so a single number would be wrong for mixed plans — show the
 * range instead of pretending everything collects the same amount.
 */
export function describeDepthForCapabilities(
  capabilities: ConnectorCapability[],
  depth: DepthLevel | 'custom',
): string {
  if (depth === 'custom') return '自定义';
  const relevant = capabilities.filter(depthIsMeaningful);
  if (!relevant.length) return '';
  const presets = relevant.map((capability) => resolveDepthPreset(capability, depth));
  const counts = presets.map((preset) => preset.maxItems).filter((value): value is number => value !== undefined);
  const parts: string[] = [];
  if (counts.length) {
    const low = Math.min(...counts);
    const high = Math.max(...counts);
    parts.push(low === high ? `每关键词约 ${low} 条` : `每关键词约 ${low}~${high} 条`);
  }
  if (relevant.some(depthAffectsComments)) {
    const withComments = presets.some((preset) => preset.collectComments);
    parts.push(withComments ? '含评论及可见回复' : '不采评论');
  }
  return parts.join('，');
}

/**
 * The planner prompt's description of the depth levels. Generated here so the
 * prompt can never drift from the behaviour again — it used to promise "前三页 /
 * 前5页 / 前10页" while the backend was budgeting by item count.
 */
export function depthPromptGuide(): string {
  // Deliberately qualitative: the actual item budget differs per connector
  // (a "标准" 微博 run and a "标准" 百度 run collect different amounts), so any
  // number or percentage stated here would be wrong for some platform.
  const SCALE: Record<DepthLevel, string> = {
    quick: '小样本摸底，取各平台预算中的最小档',
    standard: '常规调研用量，取中间档',
    deep: '尽量多地覆盖，取各平台允许范围内的较大档',
  };
  const lines = DEPTH_LEVELS.map((level) => {
    const comments = COMMENT_PRESETS.scroll_count[level];
    const commentText = comments.collectComments
      ? '并在有评论的平台采集评论及可见回复' : '且不采集评论';
    return `${level}=${DEPTH_LABELS[level]}：${SCALE[level]}，${commentText}`;
  });
  return [
    '采集深度只输出 collectionDepth 一个字段，具体条数、评论开关、起始页一律由后端按各连接器自身的上限推导，不要自行输出条数或页数。',
    ...lines.map((line) => `- ${line}`),
    '判断规则：未特别说明，或用户说“随便看看/先摸个底/快一点”时用 quick，以便尽快返回首批结果；明确说“标准/常规”用 standard；说“深挖/尽量多/全面”用 deep。评论一旦采集就连带回复，用户提“要看评论回复”不构成选 deep 的理由。用户如果明确给出条数或起始页，写入 connectorOptions[平台代码] 的 max_items / start_page，不要借此改动 collectionDepth。',
  ].join('\n');
}
