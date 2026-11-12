/**
 * Composer prompt-history plugin, browser half.
 *
 * Registers two composer extension seats and nothing else:
 *
 * - a key handler for ArrowUp/ArrowDown that recalls this Session's previously
 *   submitted prompts (empty draft only; an untouched recall keeps walking);
 * - a submission listener that records each submitted prompt for that recall.
 *
 * The composer stays unaware of trail semantics: it reports submissions and
 * offers the arrows, exactly like any other plugin using these seats.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the Session Controller client service (ctx.sessions) merge.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: the Conversation client service (composer extensions, session input) merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PromptHistory, readPromptHistory, writePromptHistory } from './history.ts'

export { PromptHistory, PROMPT_HISTORY_LIMIT, PROMPT_HISTORY_STORE_KEY, readPromptHistory, writePromptHistory } from './history.ts'
export type { PromptHistoryDirection } from './history.ts'

/** Services this plugin contributes to. */
export const inject = ['composerExtensions', 'sessions']

/** Stable identities of the two seats this plugin installs. */
const KEY_HANDLER_ID = '@deepseek-ai/dsh-client-ui-composer-history/recall'
const SUBMISSION_LISTENER_ID = '@deepseek-ai/dsh-client-ui-composer-history/record'

/**
 * Mount prompt recall over the composer extension seats.
 * @param ctx - client root context carrying `composerExtensions` and `sessions`.
 */
export function apply(ctx: Context): void {
  /** Per-Session trails, materialized on first use. */
  const trails = new Map<SessionId, PromptHistory>()
  const trail = (sessionId: SessionId): PromptHistory => {
    const existing = trails.get(sessionId)
    if (existing !== undefined) return existing
    const created = new PromptHistory(readPromptHistory(sessionId), (prompts) => {
      writePromptHistory(sessionId, prompts)
    })
    trails.set(sessionId, created)
    return created
  }

  /**
   * The Session's composer input facade, resolved through the public service
   * face (the same one any feature plugin reaches).
   */
  const inputFor = (sessionId: SessionId) => {
    const scope = ctx.sessions.scope(sessionId)
    if (scope === undefined) return undefined
    const conversation = scope.get('conversation')
    if (conversation === undefined) return undefined
    return conversation.input.for(scope)
  }

  ctx.effect(() => {
    const offKey = ctx.composerExtensions.registerKeyHandler({
      id: KEY_HANDLER_ID,
      keys: ['up', 'down'],
      run(context, key) {
        const sessionId = context.sessionId
        if (sessionId === undefined) return false
        if (key !== 'up' && key !== 'down') return false
        const input = inputFor(sessionId)
        if (input === undefined) return false
        const next = trail(sessionId).step(key, context.draft)
        if (next === undefined) return false
        input.setDraft(next)
        return true
      },
    })
    const offSubmit = ctx.composerExtensions.registerSubmissionListener({
      id: SUBMISSION_LISTENER_ID,
      receive({ sessionId, text }) {
        if (sessionId === undefined) return
        trail(sessionId).record(text)
      },
    })
    return () => {
      offKey()
      offSubmit()
      trails.clear()
    }
  }, 'ui-composer-history: composer seats')
}
