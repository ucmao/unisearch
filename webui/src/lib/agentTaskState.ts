export type ComposerMode = 'send' | 'stop-message' | 'stop-plan'

export function resolveComposerMode(input: {
  messagePending: boolean
  planRunning: boolean
  hasInput: boolean
}): ComposerMode {
  if (input.messagePending) return 'stop-message'
  if (input.planRunning && !input.hasInput) return 'stop-plan'
  return 'send'
}
