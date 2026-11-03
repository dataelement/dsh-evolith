import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore, workspaceId } from '../src/workspaces.js'
import { installMemoryBridge } from '../index.js'
import { DshCatalog } from '../src/dsh-catalog.js'
import { HistoryUploads } from '../src/history-uploads.js'
import { transcriptFromEvents } from '../src/trace.js'

const url = 'http://127.0.0.1:18888'
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-selection-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'settings.json'), store = new WorkspaceStore(file), calls = []
  const registry = { list: () => [{ id: 'workspace', path: dir, title: 'Fixture', sessionIds: ['a', 'b', 'future'] }] }
  let token = 'fixture-key'
  const client = { serverUrl: () => url, apiToken: () => token, setServerUrl() {}, setApiToken() {}, async weakSupervise({ session }) { calls.push(session); return { rewarded_traces: [] } }, async addTrace() { calls.push('add'); return { added_memory_ids: [] } } }
  const listeners = new Map()
  const ctx = { workspaceRegistry: registry, on: (name, listener) => listeners.set(name, listener), inject() {}, commands: { register() {} }, logger: { warn() {} } }
  const runtime = installMemoryBridge(ctx, { serverUrl: url }, { workspaceStore: store, client, clientForTarget: () => client, groupConfigStore: { loadConfig: async () => ({}) } })
  const save = (patch = {}) => store.save({ path: dir, mode: 'server', group_id: 'first', server_url: url, dsh_workspace_id: 'workspace', session_selection: 'all', session_ids: ['a', 'b'], ...patch })
  const session = id => ({ id, header: { cwd: dir }, snapshotEvents: () => [] })
  return { dir, file, store, runtime, save, session, calls, client, ctx, listeners, rotate: () => { token = 'rotated-key' } }
}

test('only server bindings can be saved; no-selection and legacy local settings never upload', async t => {
  const f = await fixture(t)
  await assert.rejects(f.save({ mode: 'local' }), /请选择线上记忆组/)
  await assert.rejects(f.save({ mode: 'off' }), /请选择线上记忆组/)
  await f.runtime.syncSession({ session: f.session('a') }); assert.deepEqual(f.calls, [])
  await writeFile(f.file, JSON.stringify({ version: 1, selectedOnly: false, workspaces: [{ path: f.dir, workspace_id: workspaceId(f.dir), mode: 'local', group_id: 'old-local' }] }))
  const old = new WorkspaceStore(f.file)
  assert.equal((await old.binding(f.session('a'))).mode, 'unselected')
  assert.equal((await old.snapshot()).workspaces[0].group_id, 'old-local')
})

test('all includes future sessions; explicit subset excludes and immediately stops a cached session', async t => {
  const f = await fixture(t); await f.save()
  assert.equal((await f.runtime.resolveTarget(f.session('future'))).groupId, 'first')
  assert.equal((await f.runtime.resolveTarget(f.session('a'))).groupId, 'first')
  await f.save({ session_selection: 'selected', session_ids: ['b'] })
  assert.equal((await f.runtime.resolveTarget(f.session('a'))).mode, 'unselected')
  await f.runtime.syncSession({ session: f.session('a') }); assert.deepEqual(f.calls, [])
  assert.equal((await f.runtime.resolveTarget(f.session('b'))).groupId, 'first')
  await assert.rejects(f.save({ session_selection: 'selected', session_ids: [] }), /至少选择/)
})

test('explicit group selection takes effect for existing selected sessions and survives reload', async t => {
  const f = await fixture(t); await f.save()
  const a = f.session('a'), original = await f.runtime.resolveTarget(a)
  await f.save({ group_id: 'replacement' })
  const updated = await f.runtime.resolveTarget(a)
  assert.equal(updated.groupId, 'replacement'); assert.notEqual(updated.scope, original.scope)
  const reloaded = new WorkspaceStore(f.file)
  assert.equal((await reloaded.binding(a)).group_id, 'replacement')
  assert.equal((await reloaded.sessionBinding('a')).group_id, 'replacement')
  assert.equal('session_bindings' in await reloaded.snapshot(), false)
  f.rotate(); await assert.rejects(f.runtime.resolveTarget(a), /连接或账号/)
  await f.save({ group_id: 'replacement' }); assert.equal((await f.runtime.resolveTarget(a)).groupId, 'replacement')
})

test('membership in the DSH workspace, rather than stale cwd alone, gates uploads', async t => {
  const f = await fixture(t); await f.save()
  assert.equal((await f.runtime.resolveTarget(f.session('not-in-workspace'))).mode, 'unselected')
})

test('remove and rejoin never reuse a cached group, and duplicate adds are not new Memory', async t => {
  const f = await fixture(t); const first = await f.save()
  const a = f.session('a'); await f.runtime.resolveTarget(a)
  await f.store.remove(first.workspace_id)
  const rejoined = await f.save({ group_id: 'rejoined' })
  assert.notEqual(rejoined.selection_revision, first.selection_revision)
  assert.equal((await f.runtime.resolveTarget(a)).groupId, 'rejoined')
  f.client.weakSupervise = async () => ({ rewarded_traces: [{ trace_id: 'duplicate', feedback_message_index: 2 }] })
  f.client.addTrace = async () => ({ duplicate: true, added_memory_ids: ['already-saved'] })
  assert.equal((await f.runtime.syncSession({ session: a, history: true })).new_memory_count, 0)
})

test('deselection during classification prevents any subsequent add', async t => {
  const f = await fixture(t); await f.save()
  let finish, entered
  const ready = new Promise(resolve => { entered = resolve })
  f.client.weakSupervise = async () => { entered(); return new Promise(resolve => { finish = resolve }) }
  const work = f.runtime.syncSession({ session: f.session('a'), history: true })
  await ready; await f.save({ session_selection: 'selected', session_ids: ['b'] })
  finish({ rewarded_traces: [{ trace_id: 'fixture', feedback_message_index: 2 }] })
  assert.equal((await work).ok, false); assert.ok(!f.calls.includes('add'))
})

test('deselection while a read is in flight does not inject the stale Memory result', async t => {
  const f = await fixture(t); await f.save()
  let finish, entered
  const ready = new Promise(resolve => { entered = resolve })
  f.client.read = async () => { entered(); return new Promise(resolve => { finish = resolve }) }
  const agent = { id: 'a', session: f.session('a') }, message = { content: [{ type: 'text', text: 'query' }], source: { kind: 'user' } }
  await f.listeners.get('agent/inbox/claimed')({ agent, message, turn: 1 })
  const decision = { kind: 'enter', messages: [message] }
  const pending = f.listeners.get('agent/pre-step')({ agent, turn: 1, step: 1 }, async () => decision)
  await ready; await f.save({ session_selection: 'selected', session_ids: ['b'] })
  finish({ memoryText: 'previous selection', selectedMemoryIds: [] })
  assert.equal(await pending, decision)
})

test('new group ignores foreign read receipts without altering stored messages', () => {
  const old = { type: 'user/message', data: { source: { kind: 'plugin:dsh-memory-bridge', readReceiptId: 'rr_' + '1'.repeat(32), memoryTargetScope: 'old' }, content: [{ type: 'text', text: 'old memory' }] } }
  const prefix = structuredClone(old)
  assert.deepEqual(transcriptFromEvents([old], 50000, 'new').messages, [])
  assert.deepEqual(old, prefix)
  assert.equal(transcriptFromEvents([old], 50000, 'old').messages.length, 1)
  const legacy = structuredClone(old); legacy.data.source = { kind: 'plugin', plugin: 'dsh-memory-bridge', readReceiptId: old.data.source.readReceiptId }
  assert.deepEqual(transcriptFromEvents([legacy], 50000, 'new').messages, [])
})

test('catalog returns only titles/ids and reads only explicitly selected completed turns', async t => {
  const f = await fixture(t), read = []
  f.ctx.sessionQuery = { readTitleSnapshots: async ids => ids.map(id => ({ status: 'fulfilled', value: { title: { text: 'Title ' + id }, session: { createdAt: 1 } } })), readSession: async id => { read.push(id); return { session: { id }, events: [{ type: 'turn/end', data: { turn: 1 } }, { type: 'user/message', data: { content: 'not completed' } }] } } }
  const catalog = new DshCatalog(f.ctx), meta = await catalog.sessions('workspace')
  assert.equal(meta.sessions[0].title, 'Title a'); assert.deepEqual(read, [])
  await assert.rejects(catalog.read('workspace', 'foreign'), /不属于|移出/)
  const result = await catalog.read('workspace', 'a'); assert.equal(result.snapshotEvents().length, 1); assert.deepEqual(read, ['a'])
})

test('history upload resumes interrupted work, stores no transcript, and reports zero new memory truthfully', async t => {
  const f = await fixture(t); const binding = await f.save()
  const seen = []
  const uploader = new HistoryUploads({ store: f.store, catalog: { read: async (w, id) => { seen.push(id); return { id, snapshotEvents: () => [1] } } }, sync: async () => ({ ok: true, new_memory_count: 0 }), validate: async () => {} })
  await f.store.saveUpload({ id: 'recover', workspace_id: binding.workspace_id, dsh_workspace_id: 'workspace', status: 'running', total: 2, completed: 1, failed: 0, new_memory_count: 0, sessions: [{ session_id: 'a', status: 'succeeded' }, { session_id: 'b', status: 'running' }] })
  await uploader.resume(); await uploader.queue
  const job = (await new WorkspaceStore(f.file).snapshot()).history_uploads[0]
  assert.deepEqual(seen, ['b']); assert.equal(job.completed, 2); assert.equal(job.status, 'succeeded'); assert.equal(job.new_memory_count, 0)
  assert.ok(!JSON.stringify(job).includes('content'))
})

test('a partial failure still reports the claims that were successfully added earlier', async t => {
  const f = await fixture(t), binding = await f.save()
  const uploader = new HistoryUploads({ store: f.store, catalog: { read: async () => ({ snapshotEvents: () => [1] }) }, validate: async () => {}, sync: async () => ({ ok: false, new_memory_count: 2, error: 'later add failed' }) })
  await uploader.start(binding, ['a']); await uploader.queue
  const job = (await f.store.snapshot()).history_uploads[0]
  assert.equal(job.status, 'partial_failed'); assert.equal(job.new_memory_count, 2); assert.equal(job.sessions[0].error, 'later add failed')
})
