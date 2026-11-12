/**
 * Submitted-prompt history for the composer: the drafts a Session already
 * sent, newest last, recalled with ArrowUp/ArrowDown while the composer is
 * empty (or still showing an untouched recall). Storage is per Session so each
 * conversation keeps its own trail, and a reload keeps the trail alive.
 *
 * The plugin owns the trail; the composer only reports submissions and offers
 * the recall keystroke through its extension seats.
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Storage key prefix; the Session id is the persistence suffix. */
export const PROMPT_HISTORY_STORE_KEY = 'dsh.promptHistory'

/** Retained prompts per Session (the oldest are dropped first). */
export const PROMPT_HISTORY_LIMIT = 50

/** Recall direction: up walks older, down walks back toward the newest. */
export type PromptHistoryDirection = 'up' | 'down'

/**
 * Read one Session's submitted prompts, oldest first.
 * @param sessionId - Session-scoped persistence suffix.
 * @returns stored prompts, or an empty list when storage is absent or invalid.
 */
export function readPromptHistory(sessionId: SessionId): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(`${PROMPT_HISTORY_STORE_KEY}.${sessionId}`)
    if (raw === null) return []
    const stored: unknown = JSON.parse(raw)
    if (!Array.isArray(stored)) return []
    return stored
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .slice(-PROMPT_HISTORY_LIMIT)
  } catch (_error: unknown) {
    // Unavailable browser storage or malformed JSON has no usable history.
    return []
  }
}

/**
 * Persist one Session's submitted prompts.
 * @param sessionId - Session-scoped persistence suffix.
 * @param prompts - oldest-first prompt texts.
 */
export function writePromptHistory(sessionId: SessionId, prompts: readonly string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(`${PROMPT_HISTORY_STORE_KEY}.${sessionId}`, JSON.stringify(prompts))
  } catch (_error: unknown) {
    // A full or blocked storage keeps the in-memory trail only.
  }
}

/**
 * One Session's prompt trail plus its recall cursor.
 *
 * The cursor is deliberately abandoned as soon as the draft stops matching the
 * recalled prompt: an edited recall is ordinary typing again, so the next
 * ArrowUp moves the caret instead of jumping to an older prompt.
 */
export class PromptHistory {
  private prompts: readonly string[]
  /** Index into {@link prompts} while recalling, or -1 when idle. */
  private cursor = -1
  /** The draft displaced by the first recall; ArrowDown past the newest restores it. */
  private savedDraft = ''

  /**
   * @param initial - already persisted prompts, oldest first.
   * @param persist - writer for every accepted change (absent keeps it in memory).
   */
  constructor(
    initial: readonly string[] = [],
    private readonly persist: (prompts: readonly string[]) => void = () => {},
  ) {
    this.prompts = [...initial]
  }

  /** The retained prompts, oldest first (recall order, not display order). */
  get entries(): readonly string[] {
    return this.prompts
  }

  /** Leave recall mode without touching the draft. */
  reset(): void {
    this.cursor = -1
    this.savedDraft = ''
  }

  /**
   * Record one submitted prompt, skipping a consecutive duplicate.
   * @param text - the submitted draft text.
   */
  record(text: string): void {
    const clean = text.trim() === '' ? '' : text
    if (clean !== '' && this.prompts.at(-1) !== clean) {
      const next = [...this.prompts, clean]
      this.prompts = next.length > PROMPT_HISTORY_LIMIT ? next.slice(-PROMPT_HISTORY_LIMIT) : next
      this.persist(this.prompts)
    }
    this.reset()
  }

  /**
   * Recall one prompt in a direction.
   * @param direction - up walks older, down walks newer.
   * @param draft - the composer's current text.
   * @returns the draft to show, or undefined to leave the keystroke to the caret.
   */
  step(direction: PromptHistoryDirection, draft: string): string | undefined {
    if (this.prompts.length === 0) return undefined
    if (direction === 'up') {
      if (this.cursor >= 0) {
        // Only an untouched recall may continue backwards.
        if (draft !== this.prompts[this.cursor]) {
          this.reset()
          return undefined
        }
        if (this.cursor === 0) return undefined
        this.cursor -= 1
        return this.prompts[this.cursor]
      }
      // Recall starts from an empty composer only: a real draft keeps its caret.
      if (draft.trim() !== '') return undefined
      this.savedDraft = draft
      this.cursor = this.prompts.length - 1
      return this.prompts[this.cursor]
    }
    if (this.cursor < 0) return undefined
    if (draft !== this.prompts[this.cursor]) {
      this.reset()
      return undefined
    }
    if (this.cursor < this.prompts.length - 1) {
      this.cursor += 1
      return this.prompts[this.cursor]
    }
    const saved = this.savedDraft
    this.reset()
    return saved
  }
}
