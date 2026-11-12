---
description: "Composer prompt recall for the Web GUI: ArrowUp/ArrowDown over the prompts a Session already sent, installed as a client plugin on the composer extension seats."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-composer-history

English | [中文](README.zh.md)

## Summary

Recalls prompts the current Session already sent: ArrowUp on an empty composer fills the last one, further presses walk older, and ArrowDown walks back to the displaced draft. The feature ships as a client plugin and consumes only the composer extension seats `ui-conversation` exposes — a key handler for the arrows and a submission listener for recording — so the composer itself carries no history semantics. Trails are per Session, kept in `localStorage`, capped at 50 entries, and survive a reload.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin beside `ui-conversation` in a Web composition (the `dsh-web-app` bundle already lists it). It registers itself on `ctx.composerExtensions` and needs no configuration.

| Composer state | ArrowUp | ArrowDown |
| --- | --- | --- |
| Empty draft | recalls the newest prompt | nothing |
| Showing an untouched recall | recalls the next older prompt | walks one prompt newer |
| Showing the newest recall | — | restores the draft displaced by the first recall |
| Draft typed by the human (never recalled) | normal caret movement | normal caret movement |
| Draft edited after a recall | recall is abandoned; normal caret movement | normal caret movement |
| Slash or mention menu open, or an IME composing | the menu and the IME keep the arrow | the menu and the IME keep the arrow |

Recording happens on every composer submission, including commands; a consecutive duplicate is collapsed so held recall does not repeat one prompt.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply(ctx)` registers two seats with `ctx.composerExtensions`: a key handler claiming `up`/`down`, and a submission listener. The composer offers arrows to extension key handlers after menu arbitration and before its native caret handling, and reports each submission to every listener; it knows nothing about trails.

The handler resolves the Session's composer input facade through the public service face (`ctx.sessions.scope(id)` → `conversation.input.for(scope)`), asks the trail for the next draft, and applies it with `setDraft`. No state is written when the trail declines the gesture, so an ordinary caret move still happens.

Each Session owns one `PromptHistory`: newest-last entries, consecutive duplicates collapsed, trimmed to 50, persisted under `dsh.promptHistory.<sessionId>`. The recall cursor is abandoned as soon as the draft stops matching the recalled prompt, which is what keeps a recalled-then-edited draft behaving like ordinary typing.

Both seats are registered inside one `ctx.effect`, so disposing the plugin fiber unregisters the handler and the listener and drops every in-memory trail.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-conversation](../ui-conversation/README.md) — owns the composer, the keymap, and the extension seats this plugin consumes (see its Composer extensions section).
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as recall only edits the local draft and nothing is created, queued, or sent until the human submits it.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define the current trail. They are current package constraints, not a comparison with shell history or a task backlog.

- **Local submissions only** — the listener sees prompts submitted from this browser page. A prompt sent from another device, a CLI, or another browser window joins the trail only after a submission in this page; the durable Session log is not scanned.
- **No search or fuzzy matching** — recall is strictly previous/next over the retained trail. There is no reverse search and no filtering while walking.
- **Recall needs an empty draft** — a draft the human is writing is never replaced; there is no completion-style recall inside existing text.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
