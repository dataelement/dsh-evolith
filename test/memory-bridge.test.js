import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import test from 'node:test'

import { Session } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { DeepSeekAdapter } from '@deepseek-ai/dsh-llm-deepseek'
import { installMemoryBridge } from '../index.js'
import { groupIdFor, normalizeConfig } from '../src/config.js'
import { GroupConfigStore } from '../src/group-config.js'
import { MemoryClient } from '../src/memory-client.js'
import { MEMORY_MESSAGE_SOURCE_KIND, receiptTraceText } from '../src/receipt-marker.js'
import { sessionEvents } from '../src/session-events.js'
import { transcriptFromEvents } from '../src/trace.js'

const receipt = (n) => `rr_${n.toString(16).padStart(32, '0')}`
const marker = (n) => `<memory_read_receipt>${receipt(n)}</memory_read_receipt>`
const user = (text) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
const assistant = (text) => createAssistantMessage({
  content: [{ type: 'text', text }], source: { provider: 'fixture', model: 'fixture' }
})

function host() {
  const listeners = new Map()
  const warnings = []
  return {
    warnings,
    logger: { warn: (message) => warnings.push(message) },
    commands: { register() {} },
    inject() {},
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    async emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) await listener(...args)
    },
    waterfall(event, payload, fallback) {
      const queue = listeners.get(event) ?? []
      const run = (index) => index === queue.length
        ? Promise.resolve(fallback)
        : queue[index](payload, () => run(index + 1))
      return run(0)
    }
  }
}

function configuration() {
  let value = { groupId: 'team-fixture', apiToken: '', serverUrl: '' }
  const save = async (patch) => { value = { ...value, ...patch }; return value }
  return {
    persistent: true,
    loadConfig: async () => value,
    save: async (groupId) => (await save({ groupId })).groupId,
    saveApiToken: async (apiToken) => (await save({ apiToken })).apiToken,
    saveServerUrl: async (serverUrl) => (await save({ serverUrl })).serverUrl
  }
}

function setup(read = async (_args, n) => ({ memoryText: `Memory ${n}`, readReceiptId: receipt(n) })) {
  const ctx = host()
  const reads = [], syncs = [], adds = []
  const client = {
    setApiToken() {}, setServerUrl() {},
    async read(args) { reads.push(args); return read(args, reads.length) },
    async weakSupervise(args) { syncs.push(args); return { rewarded_traces: [] } },
    async addTrace(args) { adds.push(args) }
  }
  const runtime = installMemoryBridge(ctx, {}, { client, groupConfigStore: configuration() })
  return { ctx, runtime, reads, syncs, adds }
}

async function begin(harness, session, turn, text, extra = {}) {
  const message = user(text)
  const agent = { id: session.id, session }
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  await harness.ctx.emit('agent/inbox/claimed', { agent, message, turn })
  const messages = Object.freeze([message])
  const original = Object.freeze({ kind: 'enter', messages, ...extra })
  const decision = await harness.ctx.waterfall('agent/pre-step', {
    agent, message, turn, step: 1, signal: new AbortController().signal
  }, original)
  for (const admitted of decision.messages) session.append('user/message', admitted, { surfaceOp: 'append' })
  return { agent, original, decision }
}

async function end(harness, session, turn, text = 'answer') {
  session.append('assistant/message', { turn, step: 1, message: assistant(text), stream: [] }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  const event = session.append('turn/end', { turn, reason: { kind: 'completed' } })
  await harness.ctx.emit('session/event', session, event)
}

test('fresh sessions and every following user turn read once, keeping the existing request prefix', async () => {
  const h = setup()
  const session = Session.create('cache-prefix-test')
  session.append('system/message', { turn: 1, step: 1, message: createSystemMessage('stable system') }, { surfaceOp: 'append' })
  const first = await begin(h, session, 1, 'first query')
  const prefix = structuredClone(session.deriveMessages())
  assert.equal(first.decision.messages.length, 2)
  const memory = first.decision.messages[1]
  assert.equal(memory.source.readReceiptId, receipt(1))
  assert.ok(!JSON.stringify(memory.content).includes('rr_'))
  assert.equal(first.original.messages.length, 1)
  const later = await h.ctx.waterfall('agent/pre-step', { agent: first.agent, turn: 1, step: 2 }, { kind: 'enter', messages: [] })
  assert.deepEqual(later.messages, [])
  await end(h, session, 1)
  const second = await begin(h, session, 2, 'second query')
  assert.equal(second.decision.messages[1].content[0].text.includes('Memory 2'), true)
  assert.deepEqual(session.deriveMessages().slice(0, prefix.length), prefix)
  assert.equal(h.reads.length, 2)
  assert.deepEqual(h.reads.map(x => x.query), ['first query', 'second query'])
  assert.equal(session.snapshotEvents().filter(x => x.type === 'user/message' && x.data.source.kind === MEMORY_MESSAGE_SOURCE_KIND).length, 2)
  const other = Session.create('fresh-session')
  await begin(h, other, 1, 'new conversation')
  assert.equal(h.reads.length, 3)
})

test('re-entering step 1 cannot inject a second copy, and upstream series decisions are retained', async () => {
  const h = setup()
  const s = Session.create('deduplicate')
  const first = await begin(h, s, 1, 'query', { startsRequestSeries: true })
  assert.equal(first.decision.startsRequestSeries, true)
  const again = await h.ctx.waterfall('agent/pre-step', { agent: first.agent, turn: 1, step: 1 }, { kind: 'enter', messages: [] })
  assert.equal(again.messages.length, 0)
  assert.equal(h.reads.length, 1)
})

test('receipt metadata survives Session v4 replay and reconstructs supervision attribution', async () => {
  const h = setup()
  const s = Session.create('durable-receipt')
  await begin(h, s, 1, 'task')
  await end(h, s, 1)
  const seed = JSON.parse(JSON.stringify(s.snapshotEvents()))
  const replay = Session.create(s.id, seed, s.header)
  const result = transcriptFromEvents(replay.snapshotEvents())
  assert.deepEqual(result.messages.map(x => x.role), ['user', 'system', 'assistant'])
  assert.equal(result.messages[1].content, marker(1))
  assert.equal(h.syncs[0].session.messages[1].content, marker(1))
  assert.ok(!result.messages.some(x => String(x.content).includes('Memory 1')))
})

test('legacy event access and historical receipt-in-content records remain readable', () => {
  const message = { role: 'user', content: [{ type: 'text', text: marker(2) }], source: { kind: 'plugin', plugin: 'dsh-memory-bridge' } }
  assert.equal(receiptTraceText(message, x => x.content[0].text), marker(2))
  assert.equal(receiptTraceText({ ...message, source: { kind: 'user' } }, x => x.content[0].text), '')
  assert.deepEqual(sessionEvents({ events: [1, 2] }), [1, 2])
  assert.deepEqual(sessionEvents({ snapshotEvents: () => [3] }), [3])
})

test('Memory errors and empty responses leave the original admitted request unchanged', async () => {
  for (const read of [async () => { throw new Error('temporary outage') }, async () => ({ memoryText: marker(3) })]) {
    const h = setup(read), s = Session.create('advisory')
    const { decision, original } = await begin(h, s, 1, 'continue normally')
    assert.equal(decision, original)
    assert.equal(s.deriveMessages().length, 1)
  }
})

test('only human input triggers retrieval and a rejected step adds no Memory', async () => {
  const h = setup(), s = Session.create('rejection')
  const agent = { session: s, id: s.id }
  await h.ctx.emit('agent/inbox/claimed', { agent, message: { ...user('synthetic'), source: { kind: 'tool' } }, turn: 1 })
  const noDraft = await h.ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1 }, { kind: 'enter', messages: [] })
  assert.equal(noDraft.messages.length, 0)
  await h.ctx.emit('agent/inbox/claimed', { agent, message: user('human'), turn: 1 })
  const rejected = { kind: 'reject' }
  assert.equal(await h.ctx.waterfall('agent/pre-step', { agent, turn: 1, step: 1 }, rejected), rejected)
  assert.equal(h.reads.length, 0)
})

test('group ids work with account validation while explicit and anonymous groups remain stable', () => {
  const session = { header: { cwd: '/fixture/workspace', agentPreset: 'default' } }
  const config = normalizeConfig({})
  const legacy = groupIdFor(session, config)
  assert.match(legacy, /^dsh:[0-9a-f]{64}$/)
  const authenticated = groupIdFor(session, config, { authenticated: true })
  assert.match(authenticated, /^[a-z0-9][a-z0-9._-]{2,63}$/)
  assert.equal(authenticated, groupIdFor(session, config, { authenticated: true }))
  assert.equal(groupIdFor(session, normalizeConfig({ groupId: 'saved-team' }), { authenticated: true }), 'saved-team')
})

test('settings persist with masked status and keep the 0.6 account configuration features', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-memory-settings-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'memory-bridge.json')
  const ctx = host(), calls = []
  const client = { setApiToken: x => calls.push(['token', x]), setServerUrl: x => calls.push(['url', x]) }
  const r = installMemoryBridge(ctx, {}, { client, groupConfigStore: new GroupConfigStore(path) })
  const key = ['fixture', 'credential', 'value'].join('-')
  await r.setApiToken(key)
  await r.setServerUrl('http://127.0.0.1:18091')
  await r.setGroupId('owned-group')
  const state = r.snapshot()
  assert.equal(state.group.configured_id, 'owned-group')
  assert.equal(state.server.url, 'http://127.0.0.1:18091')
  assert.equal(state.server.api_token_masked, '••••alue')
  assert.ok(!JSON.stringify(state).includes(key))
  assert.equal(JSON.parse(await readFile(path, 'utf8')).apiToken, key)
  assert.ok(calls.some(x => x[0] === 'token' && x[1] === key))
})

function response(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

test('queued add is successful only after the durable Writer job finishes', async () => {
  const calls = []
  let polls = 0
  const client = new MemoryClient(normalizeConfig({ apiToken: 'fixture-token', addPollIntervalMs: 1 }), async (url, options) => {
    calls.push({ url, method: options.method, body: options.body, token: options.headers.authorization })
    if (options.method === 'POST') return response({ job_id: 'ma_fixture', status: 'queued', poll_url: 'https://untrusted.example/steal-token' }, 202)
    polls += 1
    return response({ job_id: 'ma_fixture', status: polls === 1 ? 'running' : 'succeeded', result: polls === 1 ? null : { added_memory_ids: ['claim-1'] } })
  })
  const result = await client.addTrace({ groupId: 'owned-group', trace: { trace_id: 'trace' } })
  assert.deepEqual(result.added_memory_ids, ['claim-1'])
  assert.equal(calls.length, 3)
  assert.ok(calls.every(call => call.url.startsWith(client.serverUrl())))
  assert.ok(calls.every(call => call.token === 'Bearer fixture-token'))
  assert.ok(calls.slice(1).every(call => call.method === 'GET' && call.body === undefined))
})

test('a failed durable Writer job remains a pending trace for retry', async () => {
  const h = setup()
  const realClient = new MemoryClient(normalizeConfig({ addPollIntervalMs: 1 }), async (_url, options) => {
    if (options.method === 'POST') return response({ job_id: 'ma_failed', status: 'queued' }, 202)
    return response({ job_id: 'ma_failed', status: 'failed', error: 'fixture Writer failure' })
  })
  h.runtime.client.addTrace = args => realClient.addTrace(args)
  h.runtime.client.weakSupervise = async () => ({ judgment_count: 1, rewarded_trace_count: 1, rewarded_traces: [{ trace_id: 'fixture', episode_key: 'fixture', feedback_message_index: 1 }] })
  const s = Session.create('failed-job')
  await begin(h, s, 1, 'task')
  await end(h, s, 1)
  const snapshot = h.runtime.snapshot()
  assert.equal(snapshot.activity.last_add_ok, false)
  assert.equal(snapshot.sessions[0].added_trace_count, 0)
  assert.equal(snapshot.pending.length, 1)
  assert.match(snapshot.pending[0].last_error, /Writer failure/)
})

test('a successful retry without new feedback replaces the previous failed status', async () => {
  const h = setup(), session = Session.create('retry-after-model-setup')
  h.runtime.client.weakSupervise = async () => { throw new Error('no model provider is configured for this account') }
  await begin(h, session, 1, 'task')
  await end(h, session, 1)
  assert.equal(h.runtime.snapshot().sessions[0].processing.status, 'failed')

  h.runtime.client.weakSupervise = async () => ({ judgment_count: 0, rewarded_trace_count: 0, rewarded_traces: [] })
  const result = await h.runtime.syncSession({ session, history: true })
  const snapshot = h.runtime.snapshot(), processing = snapshot.sessions[0].processing
  assert.equal(result.ok, true)
  assert.equal(snapshot.activity.last_supervise_ok, true)
  assert.equal(processing.status, 'no_changes')
  assert.equal(processing.new_memory_count, 0)
  assert.equal(typeof processing.completed_at, 'number')
  assert.doesNotMatch(processing.message, /no model provider/)
})

test('no new feedback preserves an already completed extraction result', async () => {
  const h = setup(), session = Session.create('preserve-saved-memory-status')
  h.runtime.client.weakSupervise = async () => ({ judgment_count: 1, rewarded_trace_count: 1,
    rewarded_traces: [{ trace_id: 'saved-trace', episode_key: 'saved-trace', feedback_message_index: 1 }] })
  h.runtime.client.addTrace = async () => ({ added_memory_ids: ['saved-memory'] })
  await begin(h, session, 1, 'task')
  await end(h, session, 1)
  const completed = structuredClone(h.runtime.snapshot().sessions[0].processing)
  assert.equal(completed.status, 'saved')

  h.runtime.client.weakSupervise = async () => ({ judgment_count: 0, rewarded_trace_count: 0, rewarded_traces: [] })
  assert.equal((await h.runtime.syncSession({ session, history: true })).ok, true)
  assert.deepEqual(h.runtime.snapshot().sessions[0].processing, completed)
})

test('a retry that still fails reports the current error', async () => {
  const h = setup(), session = Session.create('retry-still-failing')
  let failure = 'no model provider is configured for this account'
  h.runtime.client.weakSupervise = async () => { throw new Error(failure) }
  await begin(h, session, 1, 'task')
  await end(h, session, 1)
  failure = 'model provider rejected the configured credential'
  assert.equal((await h.runtime.syncSession({ session, history: true })).ok, false)
  const processing = h.runtime.snapshot().sessions[0].processing
  assert.equal(processing.status, 'failed')
  assert.equal(processing.message, failure)
})

test('queued adds respect a total deadline and cancellation', async () => {
  const fetch = async () => response({ job_id: 'ma_waiting', status: 'running' }, 202)
  const client = new MemoryClient(normalizeConfig({ addTimeoutMs: 20, addPollIntervalMs: 5 }), fetch)
  await assert.rejects(client.addTrace({ groupId: 'owned-group', trace: {} }), /did not complete/)
  const controller = new AbortController()
  const cancelled = new MemoryClient(normalizeConfig({ addPollIntervalMs: 1000 }), fetch)
  const adding = cancelled.addTrace({ groupId: 'owned-group', trace: {}, signal: controller.signal })
  controller.abort()
  await assert.rejects(adding, /abort/i)
})

test('settings changes during a queued add cannot poll the old job with new credentials', async () => {
  let finish
  const calls = []
  const client = new MemoryClient(normalizeConfig({ apiToken: 'old-token' }), async (_url, options) => {
    calls.push(options)
    return new Promise(resolve => { finish = resolve })
  })
  const adding = client.addTrace({ groupId: 'owned-group', trace: {} })
  client.setApiToken('new-token')
  finish(response({ job_id: 'ma_old', status: 'queued' }, 202))
  await assert.rejects(adding, /settings changed during add/)
  assert.equal(calls.length, 1)
})

test('group/read/supervise/add carry the current Bearer credential; receipts are removed before truncation', async () => {
  const requests = []
  const client = new MemoryClient(normalizeConfig({ maxMemoryChars: 8 }), async (url, options) => {
    requests.push({ url, ...options, payload: JSON.parse(options.body) })
    if (url.endsWith('/read')) return response({ memory_text: '12345678901234567890\n' + marker(9), read_receipt_id: receipt(9) })
    if (url.endsWith('/weak-supervise')) return response({ rewarded_traces: [] })
    return response({ ok: true })
  })
  client.setApiToken('fixture-api-token')
  client.setServerUrl('http://127.0.0.1:18091')
  const read = await client.read({ groupId: 'owned-group', query: 'q' })
  assert.equal(read.memoryText, '12345678')
  assert.equal(read.readReceiptId, receipt(9))
  await client.weakSupervise({ session: { session_id: 'fixture', messages: [] } })
  await client.addTrace({ groupId: 'owned-group', trace: { trace_id: 'trace' } })
  assert.equal(requests.length, 4)
  assert.ok(requests.every(r => r.headers.authorization === 'Bearer fixture-api-token'))
  assert.ok(requests.every(r => r.url.startsWith('http://127.0.0.1:18091/')))
})

test('anonymous legacy group fallback remains available and credentials cannot silently downgrade it', async () => {
  const fetch = async url => url.endsWith('/groups') ? response({}, 404) : response({ memory_text: 'legacy memory' })
  const anonymous = new MemoryClient(normalizeConfig({}), fetch)
  assert.equal((await anonymous.read({ groupId: 'legacy', query: 'q' })).memoryText, 'legacy memory')
  anonymous.setApiToken('fixture-token')
  await assert.rejects(anonymous.read({ groupId: 'owned-group', query: 'q' }), /account-aware server URL/)
  const authenticated = new MemoryClient(normalizeConfig({ apiToken: 'fixture-token' }), fetch)
  await assert.rejects(authenticated.read({ groupId: 'owned-group', query: 'q' }), /account-aware server URL/)
})

test('an in-flight response from previous credentials is discarded and cannot mark new groups as created', async () => {
  let finish
  const client = new MemoryClient(normalizeConfig({}), async url => {
    if (url.endsWith('/groups')) return new Promise(resolve => { finish = resolve })
    return response({ memory_text: 'stale result' })
  })
  client.setApiToken('fixture-token-one')
  const reading = client.read({ groupId: 'owned-group', query: 'q' })
  client.setApiToken('fixture-token-two')
  finish(response({ ok: true }))
  await assert.rejects(reading, /settings changed/)
  assert.equal(client.ensuredGroups.size, 0)
})

test('actual DeepSeek HTTP requests preserve system/history and cache extension fields across turns', async t => {
  const bodies = []
  const server = createServer(async (req, res) => {
    let data = ''
    for await (const part of req) data += part
    bodies.push(JSON.parse(data))
    const event = (name, value) => `event: ${name}\ndata: ${JSON.stringify(value)}\n\n`
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(event('message_start', { type: 'message_start', message: { id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', content: [], usage: { input_tokens: 1, output_tokens: 0 } } }) +
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }) +
      event('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }) +
      event('message_stop', { type: 'message_stop' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const cacheControl = Object.freeze({ type: 'ephemeral' })
  const adapter = new DeepSeekAdapter({
    options: () => ({ baseURL: `http://127.0.0.1:${server.address().port}/v1`, defaults: { thinking: 'disabled' }, maxTokens: 128, defaultContextWindow: 32768, models: [{ id: 'fixture' }], streamIdleTimeoutMs: 3000 }),
    resolveAuth: async () => ({ headers: { authorization: 'Bearer fixture' } }),
    resolveUserId: () => '00000000-0000-4000-8000-000000000001',
    prepareExtensions: async () => ({ fields: { cache_control: cacheControl }, accept: async () => {} })
  })
  const h = setup(), s = Session.create('wire-cache')
  s.append('system/message', { turn: 1, step: 1, message: createSystemMessage('unchanged system') }, { surfaceOp: 'append' })
  for (let turn = 1; turn <= 2; turn += 1) {
    await begin(h, s, turn, `query ${turn}`)
    const request = Object.freeze({ provider: 'fixture', model: 'fixture', messages: Object.freeze(s.deriveMessages()), sessionId: s.id, signal: new AbortController().signal })
    const chunks = []
    for await (const chunk of adapter.stream(request)) chunks.push(chunk)
    assert.equal(chunks.at(-1)?.reason?.kind, 'stop', JSON.stringify(chunks.at(-1)))
    await end(h, s, turn)
  }
  assert.equal(bodies.length, 2)
  assert.deepEqual(bodies[0].cache_control, cacheControl)
  assert.deepEqual(bodies[1].cache_control, cacheControl)
  assert.equal(bodies[0].system, bodies[1].system)
  assert.deepEqual(bodies[1].messages.slice(0, bodies[0].messages.length), bodies[0].messages)
  assert.ok(!JSON.stringify(bodies).includes('rr_'))
  assert.ok(JSON.stringify(bodies[1]).includes('Memory 2'))
})
