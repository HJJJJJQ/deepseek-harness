// @vitest-environment jsdom
// The prompt-history plugin over the composer extension seats: trail rules,
// per-Session storage, and the seat wiring (keys recall, submissions record).
import { beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  ComposerExtensionContext, ComposerKeyHandler, ComposerSubmissionListener,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply } from '../src/client/index.ts'
import {
  PromptHistory, PROMPT_HISTORY_LIMIT, PROMPT_HISTORY_STORE_KEY, readPromptHistory, writePromptHistory,
} from '../src/client/history.ts'

const SID = 'history-session' as SessionId

beforeEach(() => { localStorage.clear() })

describe('prompt history trail', () => {
  it('records submitted prompts, skipping a consecutive duplicate', () => {
    const writes: (readonly string[])[] = []
    const history = new PromptHistory([], (prompts) => { writes.push(prompts) })
    history.record('first')
    history.record('first')
    history.record('second')
    expect(history.entries).toEqual(['first', 'second'])
    expect(writes).toEqual([['first'], ['first', 'second']])
    history.record('   ')
    expect(history.entries).toEqual(['first', 'second'])
  })

  it('drops the oldest prompts past the retention limit', () => {
    const history = new PromptHistory()
    for (let index = 0; index < PROMPT_HISTORY_LIMIT + 5; index += 1) history.record(`prompt ${index}`)
    expect(history.entries).toHaveLength(PROMPT_HISTORY_LIMIT)
    expect(history.entries[0]).toBe('prompt 5')
    expect(history.entries.at(-1)).toBe(`prompt ${PROMPT_HISTORY_LIMIT + 4}`)
  })

  it('walks older with up and back to the displaced draft with down', () => {
    const history = new PromptHistory(['one', 'two', 'three'])
    expect(history.step('up', '')).toBe('three')
    expect(history.step('up', 'three')).toBe('two')
    expect(history.step('up', 'two')).toBe('one')
    expect(history.step('up', 'one')).toBeUndefined()
    expect(history.step('down', 'one')).toBe('two')
    expect(history.step('down', 'two')).toBe('three')
    expect(history.step('down', 'three')).toBe('')
    expect(history.step('down', '')).toBeUndefined()
  })

  it('never starts recall from a real draft', () => {
    const history = new PromptHistory(['kept'])
    expect(history.step('up', 'half typed')).toBeUndefined()
    expect(history.step('up', '')).toBe('kept')
    expect(history.step('down', 'kept')).toBe('')
  })

  it('abandons recall once the draft stops matching the recalled prompt', () => {
    const history = new PromptHistory(['one', 'two'])
    expect(history.step('up', '')).toBe('two')
    expect(history.step('up', 'two edited')).toBeUndefined()
    expect(history.step('up', '')).toBe('two')
  })

  it('keeps an empty trail inert', () => {
    const history = new PromptHistory()
    expect(history.step('up', '')).toBeUndefined()
    expect(history.step('down', '')).toBeUndefined()
  })

  it('round-trips through per-Session storage and ignores malformed values', () => {
    writePromptHistory(SID, ['alpha', 'beta'])
    expect(readPromptHistory(SID)).toEqual(['alpha', 'beta'])
    expect(readPromptHistory('other-session' as SessionId)).toEqual([])
    expect(JSON.parse(localStorage.getItem(`${PROMPT_HISTORY_STORE_KEY}.${SID}`) as string)).toEqual(['alpha', 'beta'])
    localStorage.setItem(`${PROMPT_HISTORY_STORE_KEY}.${SID}`, '{not json')
    expect(readPromptHistory(SID)).toEqual([])
  })
})

interface FakeSeats {
  readonly ctx: Context
  readonly handler: ComposerKeyHandler
  readonly listener: ComposerSubmissionListener
  readonly drafts: string[]
  readonly unregistered: string[]
  dispose(): void
}

/** A minimal root context exposing just the two seats the plugin consumes. */
function fakeContext(): FakeSeats {
  const drafts: string[] = []
  const unregistered: string[] = []
  let handler: ComposerKeyHandler | undefined
  let listener: ComposerSubmissionListener | undefined
  const scope = {
    get: (name: string) => name === 'conversation'
      ? { input: { for: () => ({ setDraft: (text: string) => { drafts.push(text) } }) } }
      : undefined,
  }
  const ctx = {
    composerExtensions: {
      registerKeyHandler: (entry: ComposerKeyHandler) => {
        handler = entry
        return () => { unregistered.push(entry.id) }
      },
      registerSubmissionListener: (entry: ComposerSubmissionListener) => {
        listener = entry
        return () => { unregistered.push(entry.id) }
      },
    },
    sessions: { scope: () => scope },
    effect: (run: () => () => void) => { dispose = run() },
  } as unknown as Context
  let dispose: () => void = () => {}
  apply(ctx)
  if (handler === undefined || listener === undefined) throw new Error('plugin registered no seats')
  return { ctx, handler, listener, drafts, unregistered, dispose }
}

const contextOf = (draft: string): ComposerExtensionContext => ({
  sessionId: SID, draft, empty: draft.trim() === '', running: false,
})

describe('prompt-history seat wiring', () => {
  it('records submissions and recalls them through the key handler', () => {
    const seats = fakeContext()
    seats.listener.receive({ sessionId: SID, text: 'remember me' })
    expect(seats.handler.run(contextOf(''), 'up', null)).toBe(true)
    expect(seats.drafts).toEqual(['remember me'])
    expect(seats.handler.run(contextOf('remember me'), 'down', null)).toBe(true)
    expect(seats.drafts).toEqual(['remember me', ''])
  })

  it('passes the arrow through when the trail has nothing to recall', () => {
    const seats = fakeContext()
    expect(seats.handler.run(contextOf(''), 'up', null)).toBe(false)
    expect(seats.drafts).toEqual([])
  })

  it('ignores submissions without a Session and empty text', () => {
    const seats = fakeContext()
    seats.listener.receive({ sessionId: undefined, text: 'orphan' })
    seats.listener.receive({ sessionId: SID, text: '' })
    expect(seats.handler.run(contextOf(''), 'up', null)).toBe(false)
  })

  it('keeps one trail per Session', () => {
    const seats = fakeContext()
    seats.listener.receive({ sessionId: SID, text: 'first session' })
    seats.listener.receive({ sessionId: 'other' as SessionId, text: 'second session' })
    expect(seats.handler.run(contextOf(''), 'up', null)).toBe(true)
    expect(seats.drafts.at(-1)).toBe('first session')
  })

  it('persists the trail so a reload recalls the same prompts', () => {
    const seats = fakeContext()
    seats.listener.receive({ sessionId: SID, text: 'durable prompt' })
    const reloaded = new PromptHistory(readPromptHistory(SID))
    expect(reloaded.step('up', '')).toBe('durable prompt')
  })

  it('releases both seats with the plugin fiber', () => {
    const seats = fakeContext()
    seats.dispose()
    expect(seats.unregistered).toEqual([seats.handler.id, seats.listener.id])
  })

  it('claims only the arrows it declares', () => {
    const seats = fakeContext()
    expect(seats.handler.keys).toEqual(['up', 'down'])
    expect(seats.handler.keys.includes('tab')).toBe(false)
  })
})
