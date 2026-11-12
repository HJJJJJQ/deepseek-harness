/** Manual continuation after the human stops a turn (empty retry admission). */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AgentCancelCause } from '@deepseek-ai/dsh-agent'
import { expect, it, onTestFinished } from 'vitest'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'
import { createSessionTestRemote } from './test-remote.ts'

async function setup(cause: AgentCancelCause) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  // Turn 1 streams partial output and hangs until the human stops it; the
  // continuation then runs as turn 2.
  const adapter = new MockAdapter(['hang', textResponse('continued')])
  ctx.effect(() => ctx.llm.registerAdapter(['mock'], adapter))
  const remote = await createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }), cwd: '/workspace',
  })
  const agent = await ctx.agentLoop.create(SessionId(`manual-continuation-${cause.kind}`), {
    provider: 'mock', model: 'mock',
  })
  // Stop the first turn only after its user message was admitted: a cancel
  // before admission leaves no human work to continue from.
  let stopped = false
  ctx.on('session/event', (_session, event) => {
    if (stopped || event.type !== 'user/message' || event.data.source.kind !== 'user') return
    stopped = true
    void Promise.resolve().then(() => { agent.cancel(cause) })
  })
  const request = (id: string): SessionPromptRequest => ({
    sessionId: agent.id, requestId: id as SessionRequestId, content: [], mode: 'queue',
  })
  const continuation = (): number | null =>
    ctx.sessionProjections.snapshot(agent.session).values.conversationContinuation as number | null
  return { ctx, remote, agent, adapter, request, continuation }
}

it('offers an empty continuation after the human stops a turn', async () => {
  const { agent, remote, adapter, request, continuation } = await setup({ kind: 'user' })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(continuation()).not.toBeNull()

  expect((await remote.prompt(request('continue-after-stop'))).ok).toBe(true)
  await agent.whenIdle()

  expect(adapter.requests).toHaveLength(2)
  // The continuation re-asks with no new human text: the empty retry message
  // is the only addition, so the model resumes instead of answering a prompt.
  expect(adapter.requests[1]!.messages.filter(message => message.role === 'user').map(message => message.content))
    .toEqual([[{ type: 'text', text: 'original task' }], []])
  const events = agent.session.snapshotEvents()
  expect(events.flatMap(event => event.type === 'turn/end' ? [event.data.reason.kind] : []))
    .toEqual(['aborted', 'completed'])
  expect(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).toHaveLength(1)
  expect(continuation()).toBeNull()
})

it.each<AgentCancelCause>([
  { kind: 'parent' }, { kind: 'hook', reason: 'stop-hook' }, { kind: 'disposed' },
])('does not offer a continuation for a non-human stop (%j)', async (cause) => {
  const { agent, remote, adapter, request, continuation } = await setup(cause)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'original task' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(continuation()).toBeNull()
  expect((await remote.prompt(request('continue-without-stop'))).ok).toBe(false)
  expect(adapter.requests).toHaveLength(1)
})
