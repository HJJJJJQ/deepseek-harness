/**
 * Composer extension seats for client plugins.
 *
 * Two shapes cover the gestures a plugin otherwise could not reach without
 * forking the composer:
 *
 * - {@link ComposerKeyHandler} sees an intercepted key (arrows, Enter, …)
 *   after menu arbitration passed and before the composer's own caret
 *   behavior, so a plugin can claim ArrowUp for prompt recall, or Enter for a
 *   custom submission gesture.
 * - {@link ComposerPrimaryAction} replaces the primary button while the
 *   composer is empty and idle, which is where continuation, regeneration, or
 *   any "start this for me" action belongs. Stop and ordinary Send keep that
 *   seat while a turn runs or a draft exists.
 *
 * Handlers run in descending priority, registration order breaking ties; the
 * first one that answers owns the gesture. A throwing handler is treated as
 * uninterested so one plugin cannot break the composer.
 */
import type { ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Keys the composer intercepts before falling back to native editing. */
export type ComposerKey = 'up' | 'down' | 'enter' | 'escape' | 'tab' | 'tabBack'

/** Facts a composer extension reads when it is asked to act. */
export interface ComposerExtensionContext {
  /** Addressed Session, absent in the inert (no-session) composer. */
  readonly sessionId: SessionId | undefined
  /** Current plain draft text. */
  readonly draft: string
  /** Whether the draft is empty and carries no attachments. */
  readonly empty: boolean
  /** Whether a turn is running in this Session. */
  readonly running: boolean
}

/** One plugin-claimed composer keystroke. */
export interface ComposerKeyHandler {
  /** Stable identity for diagnostics and de-duplication. */
  readonly id: string
  /** Keys this handler is offered; every other key never reaches it. */
  readonly keys: readonly ComposerKey[]
  /** Higher runs first (default 0). */
  readonly priority?: number | undefined
  /**
   * @param context - composer facts at keystroke time.
   * @param key - the intercepted key, already limited to {@link keys}.
   * @param event - the originating DOM event, when the engine supplied one.
   * @returns true = consumed (the composer preventDefaults and stops).
   */
  run(context: ComposerExtensionContext, key: ComposerKey, event: KeyboardEvent | null): boolean
}

/** One plugin-provided primary button for an empty, idle composer. */
export interface ComposerPrimaryAction {
  /** Stable identity for diagnostics and de-duplication. */
  readonly id: string
  /** Higher is offered first (default 0). */
  readonly priority?: number | undefined
  /**
   * Whether this action applies right now. Consulted only while the composer
   * is empty, idle, unlocked, and in the plain phase.
   */
  available(context: ComposerExtensionContext): boolean
  /** Button label and accessible name. */
  label(): string
  /** Button glyph. */
  icon(): ReactNode
  /** Perform the action when the button is pressed. */
  run(context: ComposerExtensionContext): void
}
