export type ChatMessage = {
  role: string;
  content: unknown;
  [key: string]: unknown;
};

export interface ContextBudgetReport {
  maxContextTokens: number;
  reservedOutputTokens: number;
  inputBudgetTokens: number;
  estimatedInputTokensBefore: number;
  estimatedInputTokensAfter: number;
  compactedMessages: number;
  truncatedMessages: number;
  compacted: boolean;
}

export interface ContextBudgetResult {
  messages: ChatMessage[];
  report: ContextBudgetReport;
}

const DEFAULT_MAX_CONTEXT_TOKENS = 64_000;
const MIN_MESSAGE_TOKENS = 256;

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  try { return JSON.stringify(content); } catch { return String(content ?? ''); }
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === 'string') return estimateTextTokens(content);
  if (Array.isArray(content)) {
    return content.reduce((total, part: any) => {
      if (part?.type === 'image_url') return total + 1_024;
      if (typeof part?.text === 'string') return total + estimateTextTokens(part.text);
      return total + estimateTextTokens(contentText(part));
    }, 0);
  }
  return estimateTextTokens(contentText(content));
}

/**
 * A conservative tokenizer-independent estimate. CJK characters generally
 * consume about one token while runs of latin text are closer to four chars.
 */
export function estimateTextTokens(value: string): number {
  if (!value) return 0;
  const cjk = value.match(/[\u3400-\u9fff\uf900-\ufaff]/g)?.length || 0;
  return cjk + Math.ceil((value.length - cjk) / 4);
}

export function estimateMessageTokens(message: ChatMessage): number {
  return 8 + estimateTextTokens(message.role) + estimateContentTokens(message.content);
}

function estimateMessages(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function truncateMiddle(value: string, targetTokens: number): string {
  if (estimateTextTokens(value) <= targetTokens) return value;
  const marker = '\n\n[内容因上下文预算限制已截断]\n\n';
  const targetCharacters = Math.max(64, targetTokens * 2);
  const available = Math.max(32, targetCharacters - marker.length);
  const headLength = Math.ceil(available * 0.7);
  const tailLength = Math.floor(available * 0.3);
  return `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`;
}

/**
 * Apply one request-wide budget instead of letting conversation history,
 * materials and evidence each spend an unrelated character allowance.
 */
export function applyContextBudget(
  input: ChatMessage[],
  options: { maxContextTokens?: number; reservedOutputTokens?: number } = {},
): ContextBudgetResult {
  const maxContextTokens = Math.max(8_192, options.maxContextTokens || DEFAULT_MAX_CONTEXT_TOKENS);
  const reservedOutputTokens = Math.max(512, options.reservedOutputTokens || 3_000);
  const inputBudgetTokens = Math.max(4_096, maxContextTokens - reservedOutputTokens - 1_024);
  const messages = input.map((message) => ({ ...message }));
  const estimatedInputTokensBefore = estimateMessages(messages);
  let currentTokens = estimatedInputTokensBefore;
  let compactedMessages = 0;
  let truncatedMessages = 0;

  if (currentTokens > inputBudgetTokens) {
    const latestUserIndex = messages.map((message) => message.role).lastIndexOf('user');
    for (let index = 0; index < messages.length && currentTokens > inputBudgetTokens; index++) {
      const message = messages[index];
      if (message.role === 'system' || index === latestUserIndex) continue;
      const before = estimateMessageTokens(message);
      const replacement = `[较早的${message.role === 'assistant' ? '助手回复' : '用户消息'}已按上下文预算省略]`;
      if (contentText(message.content) === replacement) continue;
      message.content = replacement;
      currentTokens += estimateMessageTokens(message) - before;
      compactedMessages++;
    }

    while (currentTokens > inputBudgetTokens) {
      const candidates = messages
        .map((message, index) => ({ message, index, tokens: estimateMessageTokens(message) }))
        .filter(({ message, index, tokens }) => (
          typeof message.content === 'string'
          && tokens > MIN_MESSAGE_TOKENS
          && index !== latestUserIndex
        ))
        .sort((left, right) => right.tokens - left.tokens);
      const candidate = candidates[0];
      if (!candidate) break;
      const overshoot = currentTokens - inputBudgetTokens;
      const targetTokens = Math.max(MIN_MESSAGE_TOKENS, candidate.tokens - overshoot - 32);
      const before = estimateMessageTokens(candidate.message);
      candidate.message.content = truncateMiddle(contentText(candidate.message.content), targetTokens);
      const after = estimateMessageTokens(candidate.message);
      if (after >= before) break;
      currentTokens += after - before;
      truncatedMessages++;
    }

    if (currentTokens > inputBudgetTokens && latestUserIndex >= 0) {
      const latest = messages[latestUserIndex];
      const before = estimateMessageTokens(latest);
      latest.content = truncateMiddle(contentText(latest.content), Math.max(1_024, before - (currentTokens - inputBudgetTokens) - 32));
      currentTokens += estimateMessageTokens(latest) - before;
      truncatedMessages++;
    }
  }

  return {
    messages,
    report: {
      maxContextTokens,
      reservedOutputTokens,
      inputBudgetTokens,
      estimatedInputTokensBefore,
      estimatedInputTokensAfter: currentTokens,
      compactedMessages,
      truncatedMessages,
      compacted: compactedMessages > 0 || truncatedMessages > 0,
    },
  };
}
