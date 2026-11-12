// @vitest-environment jsdom
// Composer extension seats: plugin key handlers decide before caret behavior,
// submission listeners hear every send, and primary actions can take the
// empty, idle composer's button.
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InboxState } from '@deepseek-ai/dsh-agent/types'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  allowAllAccess, bindSnapshotSelector, conversationSnapshot as conversationFixture, contextMenuHook,
  makeTranslate, sessionSnapshot as sessionFixture,
} from '@deepseek-ai/dsh-client-test-runtime'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { ComposerExtensions } from '../src/client/input/extensions.ts'
import type {
  ComposerPrimaryAction, ComposerSubmission,
} from '../src/client/contract/composer-extensions.ts'
import type { SubmitOutcome } from '../src/client/contract/input.ts'
import { InputBar } from '../src/client/skeleton/InputBar.tsx'
import type { InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import { createComposerFileIntake } from '../src/client/input/file-intake.ts'
import './control-row-dom.ts'

afterEach(cleanup)
beforeEach(() => { localStorage.clear() })

const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']
const SCTX = {} as Context
const SID = 'extensions-session' as SessionId
const ZERO_RECT = (): DOMRect => ({ top: 0, bottom: 0 }) as DOMRect
Range.prototype.getBoundingClientRect = ZERO_RECT

function extensionsForTest(): ComposerExtensions {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  return new ComposerExtensions(ctx)
}

function snapshotOf(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return { ...sessionFixture(SID), ...overrides }
}

interface BenchOptions {
  extensions?: ComposerExtensions
  composerActions?: readonly ComposerPrimaryAction[]
  running?: boolean
  draft?: string
}

function bench(over: BenchOptions = {}) {
  const sink = vi.fn(() => Promise.resolve({ kind: 'success' } as SubmitOutcome))
  const session = createSnapshotStore<SessionSnapshot>(snapshotOf({ running: over.running ?? false }))
  const shell = new SessionInputShell({
    actx: SCTX,
    sessionId: SID,
    defaultSink: sink,
    commandAttachments: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: (token: string) => `${token.trim()} unsupported`,
    },
    inbox: createSnapshotStore<InboxState>({ 'next-turn': [], 'next-step': [] }),
    ...(over.extensions === undefined ? {} : { extensions: () => over.extensions }),
  })
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
  return { view, shell, textarea, sink }
}

describe('composer key handlers', () => {
  it('offers intercepted arrows to plugin handlers with live composer facts', () => {
    const extensions = extensionsForTest()
    const run = vi.fn(() => true)
    extensions.registerKeyHandler({ id: 'test/claim', keys: ['up'], run })
    const { shell } = bench({ extensions, draft: 'work in progress' })
    expect(shell.composerKey('up', null)).toBe(true)
    expect(run).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SID, draft: 'work in progress', empty: false, running: false }),
      'up',
      null,
    )
    // A key the handler did not claim never reaches it.
    expect(shell.composerKey('down', null)).toBe(false)
    expect(run).toHaveBeenCalledOnce()
  })

  it('lets an unclaimed arrow fall through to the caret', () => {
    const extensions = extensionsForTest()
    extensions.registerKeyHandler({ id: 'test/pass', keys: ['up'], run: () => false })
    const { shell } = bench({ extensions })
    expect(shell.composerKey('up', null)).toBe(false)
  })

  it('degrades a throwing handler to uninterested and keeps later handlers', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    afterEach(() => { log.mockRestore() })
    const extensions = extensionsForTest()
    extensions.registerKeyHandler({ id: 'test/thrower', keys: ['up'], run: () => { throw new Error('boom') } })
    const claimed = vi.fn(() => true)
    extensions.registerKeyHandler({ id: 'test/second', keys: ['up'], priority: -1, run: claimed })
    const { shell } = bench({ extensions })
    expect(shell.composerKey('up', null)).toBe(true)
    expect(claimed).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalled()
  })

  it('runs a higher priority handler first and stops at the claim', () => {
    const extensions = extensionsForTest()
    const order: string[] = []
    extensions.registerKeyHandler({
      id: 'test/low', keys: ['up'], priority: 1, run: () => { order.push('low'); return false },
    })
    extensions.registerKeyHandler({
      id: 'test/high', keys: ['up'], priority: 10, run: () => { order.push('high'); return true },
    })
    const { shell } = bench({ extensions })
    expect(shell.composerKey('up', null)).toBe(true)
    expect(order).toEqual(['high'])
  })
})

describe('composer submission listeners', () => {
  it('reports every submitted draft with the addressed Session', async () => {
    const extensions = extensionsForTest()
    const received: ComposerSubmission[] = []
    extensions.registerSubmissionListener({ id: 'test/record', receive: (submission) => { received.push(submission) } })
    const { shell, textarea, sink } = bench({ extensions })
    act(() => { shell.setDraft('sent text') })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(received).toEqual([{ sessionId: SID, text: 'sent text' }])
  })

  it('keeps the send alive when a listener throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    afterEach(() => { log.mockRestore() })
    const extensions = extensionsForTest()
    extensions.registerSubmissionListener({
      id: 'test/thrower',
      receive: () => { throw new Error('listener bug') },
    })
    const seen = vi.fn()
    extensions.registerSubmissionListener({ id: 'test/second', receive: seen })
    const { shell, textarea, sink } = bench({ extensions })
    act(() => { shell.setDraft('still sent') })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await vi.waitFor(() => { expect(sink).toHaveBeenCalledOnce() })
    expect(seen).toHaveBeenCalledWith({ sessionId: SID, text: 'still sent' })
    expect(log).toHaveBeenCalled()
  })

  it('stops reporting after the listener unregisters', () => {
    const extensions = extensionsForTest()
    const seen = vi.fn()
    const off = extensions.registerSubmissionListener({ id: 'test/record', receive: seen })
    extensions.notifySubmission({ sessionId: SID, text: 'one' })
    off()
    extensions.notifySubmission({ sessionId: SID, text: 'two' })
    expect(seen).toHaveBeenCalledOnce()
    expect(seen).toHaveBeenCalledWith({ sessionId: SID, text: 'one' })
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
