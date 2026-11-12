/**
 * Root registry behind the composer extension seats (see the contract module):
 * `ctx.composerExtensions` is the client-plugin handle for claiming a composer
 * keystroke or offering a primary action for an empty, idle composer.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  ComposerExtensionContext, ComposerKey, ComposerKeyHandler, ComposerPrimaryAction,
} from '../contract/composer-extensions.ts'

/** One registration plus its tie-breaking order. */
interface Registered<T> {
  readonly entry: T
  readonly order: number
}

/** Higher priority first, registration order breaking ties. */
function byPriority<T extends { readonly priority?: number | undefined }>(
  left: Registered<T>,
  right: Registered<T>,
): number {
  return (right.entry.priority ?? 0) - (left.entry.priority ?? 0) || left.order - right.order
}

/**
 * Composer extension registry (root singleton, provided as
 * `composerExtensions`). Registration returns its own disposer so a plugin
 * fiber owns the lifetime; the stores publish ordered snapshots for React.
 */
export class ComposerExtensions extends Service {
  private readonly keys: Registered<ComposerKeyHandler>[] = []
  private readonly actions: Registered<ComposerPrimaryAction>[] = []
  private order = 0

  /** Live primary actions, already ordered by priority. */
  readonly primaryActions: SnapshotStore<readonly ComposerPrimaryAction[]> = createSnapshotStore<
    readonly ComposerPrimaryAction[]
  >([])

  /** @param ctx - owning root context. */
  constructor(ctx: Context) {
    super(ctx, 'composerExtensions')
    ctx.effect(() => () => {
      this.keys.length = 0
      this.actions.length = 0
      this.publishActions()
    }, 'composerExtensions: release registrations')
  }

  /**
   * Claim composer keystrokes.
   * @param handler - the handler to offer matching keys to.
   * @returns the unregister disposer.
   */
  registerKeyHandler(handler: ComposerKeyHandler): () => void {
    const registered: Registered<ComposerKeyHandler> = { entry: handler, order: this.order++ }
    this.keys.push(registered)
    this.keys.sort(byPriority)
    return () => {
      const index = this.keys.indexOf(registered)
      if (index >= 0) this.keys.splice(index, 1)
    }
  }

  /**
   * Offer an additional primary button for the empty, idle composer.
   * @param action - the provider to consult.
   * @returns the unregister disposer.
   */
  registerPrimaryAction(action: ComposerPrimaryAction): () => void {
    const registered: Registered<ComposerPrimaryAction> = { entry: action, order: this.order++ }
    this.actions.push(registered)
    this.actions.sort(byPriority)
    this.publishActions()
    return () => {
      const index = this.actions.indexOf(registered)
      if (index < 0) return
      this.actions.splice(index, 1)
      this.publishActions()
    }
  }

  /**
   * Handlers interested in one key, highest priority first.
   * @param key - the intercepted composer key.
   * @returns ordered handlers that claim this key.
   */
  keyHandlersFor(key: ComposerKey): readonly ComposerKeyHandler[] {
    return this.keys.map(record => record.entry).filter(handler => handler.keys.includes(key))
  }

  /**
   * The first registered primary action that applies right now.
   * @param context - composer facts at render time.
   * @returns the winning action, or undefined when none applies.
   */
  primaryActionFor(context: ComposerExtensionContext): ComposerPrimaryAction | undefined {
    for (const { entry } of this.actions) {
      try {
        if (entry.available(context)) return entry
      } catch (error) {
        console.error(`[ui-conversation] composer action "${entry.id}" availability failed:`, error)
      }
    }
    return undefined
  }

  /** Publish the ordered action list to React. */
  private publishActions(): void {
    this.primaryActions.set(this.actions.map(record => record.entry))
  }
}
