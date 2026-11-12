// @vitest-environment jsdom
// Submitted-prompt recall: the per-Session trail, its cursor rules, and the
// composer gesture that drives it (ArrowUp/ArrowDown at the contenteditable,
// plus plugin key handlers winning before recall).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  PromptHistory, PROMPT_HISTORY_LIMIT, PROMPT_HISTORY_STORE_KEY, readPromptHistory, writePromptHistory,
} from '../src/client/input/prompt-history.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { ComposerExtensions } from '../src/client/input/extensions.ts'
import type { ComposerKeyHandler } from '../src/client/contract/composer-extensions.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import type { SubmitOutcome } from '../src/client/contract/input.ts'
import type { ComposerPrimaryAction } from '../src/client/contract/composer-extensions.ts'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  allowAllAccess, bindSnapshotSelector, conversationSnapshot as conversationFixture, makeTranslate,
  sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import { contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { createComposerFileIntake } from '../src/client/input/file-intake.ts'
import './control-row-dom.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
// jsdom implements no Range geometry; the composer measures the caret when it
// reinstates its own selection after a programmatic draft write.
const ZERO_RECT = (): DOMRect => ({ top: 0, bottom: 0 }) as DOMRect
Range.prototype.getBoundingClientRect = ZERO_RECT

const SCTX = {} as Context
const SID = 'history-session' as SessionId

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

  it('restores a non-empty displaced draft after walking down past the newest', () => {
    const history = new PromptHistory(['kept'])
    expect(history.step('up', 'half typed')).toBeUndefined()
    expect(history.step('up', '')).toBe('kept')
    expect(history.step('down', 'kept')).toBe('')
  })

  it('abandons recall once the draft stops matching the recalled prompt', () => {
    const history = new PromptHistory(['one', 'two'])
    expect(history.step('up', '')).toBe('two')
    expect(history.step('up', 'two edited')).toBeUndefined()
    // The trail is still usable from an empty composer afterwards.
    expect(history.step('up', '')).toBe('two')
  })

  it('keeps an empty trail inert', () => {
    const history = new PromptHistory()
    expect(history.step('up', '')).toBeUndefined()
    expect(history.step('down', '')).toBeUndefined()
  })
})

describe('prompt history persistence', () => {
  it('round-trips through storage per Session', () => {
    writePromptHistory(SID, ['alpha', 'beta'])
    expect(readPromptHistory(SID)).toEqual(['alpha', 'beta'])
    expect(readPromptHistory('other-session' as SessionId)).toEqual([])
    expect(JSON.parse(localStorage.getItem(`${PROMPT_HISTORY_STORE_KEY}.${SID}`) as string)).toEqual(['alpha', 'beta'])
  })

  it('ignores malformed storage', () => {
    localStorage.setItem(`${PROMPT_HISTORY_STORE_KEY}.${SID}`, '{not json')
    expect(readPromptHistory(SID)).toEqual([])
    localStorage.setItem(`${PROMPT_HISTORY_STORE_KEY}.${SID}`, JSON.stringify(['ok', 4, null, '  ']))
    expect(readPromptHistory(SID)).toEqual(['ok'])
  })
})

interface BenchOptions {
  running?: boolean
  keyHandlers?: readonly ComposerKeyHandler[]
  composerActions?: readonly ComposerPrimaryAction[]
  draft?: string
}

function snapshotOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { ...sessionFixture(SID), ...overrides }
}

function bench(over: BenchOptions = {}) {
  const sink = vi.fn(() => Promise.resolve({ kind: 'success' } as SubmitOutcome))
  const session = createSnapshotStore<SessionSnapshot>(snapshotOf({ running: over.running ?? false }))
  const extensions = {
    keyHandlersFor: (key: string) => (over.keyHandlers ?? []).filter(handler => handler.keys.includes(key as never)),
  } as unknown as ComposerExtensions
  const shell = new SessionInputShell({
    actx: SCTX,
    defaultSink: sink,
    commandAttachments: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: (token: string) => `${token.trim()} unsupported`,
    },
    inbox: createSnapshotStore<InboxState>({ 'next-turn': [], 'next-step': [] }),
    extensions: () => extensions,
  })
  shell.bindPromptHistory(SID)
  if (over.draft !== undefined) shell.setDraft(over.draft)
  const composerActions = createSnapshotStore<readonly ComposerPrimaryAction[]>(over.composerActions ?? [])
  const props: InputBarProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    sessionId: SID,
    SessionProvider: ({ children }) => children,
    useSession: bindSnapshotSelector(session),
    useConversation: bindSnapshotSelector(createSnapshotStore(conversationFixture())),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore(new Map())),
    useSessionRetainInfo: () => undefined,
    useResource,
    useSessions: bindSnapshotSelector(createSnapshotStore<SessionListState>({
      ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
    })),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore({
      items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    })),
    ...allowAllAccess,
    useContextMenu: contextMenuHook(),
    useAccess: () => true,
    useProjection: ((_key: string, selector: (v: unknown) => unknown = v => v) => selector(undefined)),
    useInput: bindSnapshotSelector(shell.state),
    inputActions: shell.actions,
    keyboard: shell,
    addFiles: () => null,
    useFileUploads: bindSnapshotSelector(createSnapshotStore({})),
    retryFileUpload: undefined,
    registerFileIntake: createComposerFileIntake(),
    removeAttachment: (id) => { shell.removeAttachment(id) },
    resolveDraftAttachments: () => [],
    toggleCommandMenu: vi.fn(),
    useBusyEnter: bindSnapshotSelector(createSnapshotStore<'queue' | 'steer'>('queue')),
    retry: vi.fn(),
    useStopShortcut: bindSnapshotSelector(createSnapshotStore<readonly string[]>(['Esc', 'Esc'])),
    useNotices: bindSnapshotSelector(shell.notices),
    useLexicon: bindSnapshotSelector(shell.lexicon),
    useMenuLauncher: bindSnapshotSelector(createSnapshotStore<string | null>(null)),
    useComposerActions: bindSnapshotSelector(composerActions),
    stop: vi.fn(),
    t: makeTranslate(zh, commonZh),
    renderSlot: (() => null) as never,
    variant: 'composer',
    occurrence: 'main',
  }
  const view = render(<InputBar {...props} />)
  const textarea = view.container.querySelector('[contenteditable]') as HTMLElement
  return { view, shell, textarea, sink, composerActions }
}

describe('composer recall gesture', () => {
  it('recalls the last submitted prompt with ArrowUp and clears it with ArrowDown', async () => {
    const { shell, textarea, sink } = bench()
    act(() => { shell.setDraft('build the thing') })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('') })
    expect(sink).toHaveBeenCalledOnce()
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })

    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(shell.snapshot.draft).toBe('build the thing')
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    expect(shell.snapshot.draft).toBe('')
  })

  it('walks the trail backwards and forwards without leaving recall', async () => {
    const { shell, textarea, sink } = bench()
    for (const prompt of ['one', 'two']) {
      act(() => { shell.setDraft(prompt) })
      fireEvent.keyDown(textarea, { key: 'Enter' })
      await vi.waitFor(() => { expect(sink).toHaveBeenCalledTimes(prompt === 'one' ? 1 : 2) })
      await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    }
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(shell.snapshot.draft).toBe('two')
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(shell.snapshot.draft).toBe('one')
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(shell.snapshot.draft).toBe('one')
    fireEvent.keyDown(textarea, { key: 'ArrowDown' })
    expect(shell.snapshot.draft).toBe('two')
  })

  it('leaves a real draft and its caret alone', () => {
    const { shell, textarea } = bench({ draft: 'work in progress' })
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(shell.snapshot.draft).toBe('work in progress')
  })

  it('lets a plugin key handler claim the arrow before recall runs', async () => {
    const claimed = vi.fn(() => true)
    const { shell, textarea, sink } = bench({
      keyHandlers: [{ id: 'test-claim', keys: ['up'], run: claimed }],
    })
    act(() => { shell.setDraft('trail prompt') })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('') })
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(sink).toHaveBeenCalledOnce()
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(claimed).toHaveBeenCalledOnce()
    expect(shell.snapshot.draft).toBe('')
  })

  it('ignores a throwing handler and falls back to recall', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    afterEach(() => { log.mockRestore() })
    const { shell, textarea, sink } = bench({
      keyHandlers: [{
        id: 'test-thrower',
        keys: ['up'],
        run: () => { throw new Error('plugin bug') },
      }],
    })
    act(() => { shell.setDraft('survives') })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(shell.snapshot.draft).toBe('') })
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(sink).toHaveBeenCalledOnce()
    fireEvent.keyDown(textarea, { key: 'ArrowUp' })
    expect(shell.snapshot.draft).toBe('survives')
    expect(log).toHaveBeenCalled()
  })
})

describe('composer primary action seat', () => {
  const action = (label: string, run = vi.fn(), available = () => true): ComposerPrimaryAction => ({
    id: `action-${label}`,
    available,
    label: () => label,
    icon: () => <span data-testid={`icon-${label}`} />,
    run,
  })

  it('offers a registered action on an empty, idle composer', () => {
    const run = vi.fn()
    const { view } = bench({ composerActions: [action('继续', run)] })
    const button = view.getByRole('button', { name: '继续' })
    expect(button.hasAttribute('disabled')).toBe(false)
    expect(view.getByTestId('icon-继续')).not.toBeNull()
    fireEvent.click(button)
    expect(run).toHaveBeenCalledOnce()
  })

  it.each([
    { draft: 'typed work' },
    { running: true },
  ])('leaves the seat to the composer with %j', (options) => {
    const { view } = bench({ composerActions: [action('继续')], ...options })
    expect(view.queryByRole('button', { name: '继续' })).toBeNull()
  })

  it('offers the first available action by priority', () => {
    const first = action('第一')
    const second = { ...action('第二'), priority: -1 }
    const skipped = { ...action('跳过'), available: () => false, priority: 10 }
    const { view } = bench({ composerActions: [skipped, first, second] })
    expect(view.getByRole('button', { name: '第一' })).not.toBeNull()
    expect(view.queryByRole('button', { name: '跳过' })).toBeNull()
  })
})
