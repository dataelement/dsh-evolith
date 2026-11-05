import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HistoryUploads } from '../src/history-uploads.js'
import { DiagnosticOutbox, credentialFingerprint, redactDiagnostic, diagnoseError } from '../src/diagnostics.js'
import { MemoryClient } from '../src/memory-client.js'
import { normalizeConfig } from '../src/config.js'

const binding = { workspace_id: 'w', dsh_workspace_id: 'dsh-w', group_id: 'g', selection_revision: 'r1', server_url: 'http://memory', credential_fingerprint: credentialFingerprint('owner-token') }
function fixture(options = {}) {
  let now = 1000, configured = false, allowed = true
  const jobs = [], calls = [], logs = []
  const store = { snapshot: async () => ({ history_uploads: structuredClone(jobs) }), saveUpload: async job => {
    const index = jobs.findIndex(x => x.id === job.id); index < 0 ? jobs.push(structuredClone(job)) : jobs[index] = structuredClone(job)
  } }
  const common = { store, clock: () => now, retryDelays: [5, 15, 45, 120, 300],
    catalog: { read: async (_, id) => ({ id, snapshotEvents: () => [1] }) },
    validate: async () => { if (!allowed) throw new Error('连接已变化，请重新确认后上传') },
    modelReady: async () => configured, connection: () => ({ serverUrl: 'http://memory', apiToken: 'owner-token' }),
    diagnostics: { log: async (...args) => logs.push(args) },
    sync: async ({ session }) => { calls.push(session.id); return options.sync ? options.sync(session.id) : configured ? { ok: true, new_memory_count: 1 } : { ok: false, error: 'no OpenAI-compatible model provider is configured for this account' } }
  }
  const uploader = new HistoryUploads(common)
  return { jobs, calls, logs, uploader, restart: () => new HistoryUploads(common), ready: () => { configured = true }, advance: x => { now += x }, block: () => { allowed = false } }
}

test('one account with five workspaces pauses missing models and resumes all five after configuration', async () => {
  const f = fixture()
  for (let i = 0; i < 5; i++) await f.uploader.start({ ...binding, workspace_id: 'w' + i }, ['s' + i])
  await f.uploader.queue
  assert.equal(f.calls.length, 5)
  assert.ok(f.logs.filter(x=>x[0]==='history.created').every(x=>x[1].workspace_id.startsWith('w') && x[2].dsh_workspace_id==='dsh-w'))
  assert.ok(f.jobs.every(j => j.sessions[0].retry_state === 'waiting_model'))
  await f.uploader.tick(); await f.uploader.queue
  assert.equal(f.calls.length, 5)
  const restored = f.restart(); await restored.resume(); f.ready()
  await restored.tick(); await restored.queue
  assert.equal(f.calls.length, 10)
  assert.ok(f.jobs.every(j => j.status === 'succeeded' && j.new_memory_count === 1))
})

test('a transient failure has exactly five additional automatic attempts and then requires manual retry', async () => {
  const f = fixture({ sync: () => ({ ok: false, error: 'network connection failed' }) })
  await f.uploader.start(binding, ['s']); await f.uploader.queue
  for (let i = 0; i < 8; i++) { f.advance(1000); await f.uploader.tick(); await f.uploader.queue }
  assert.equal(f.calls.length, 6)
  assert.equal(f.jobs[0].sessions[0].automatic_retries, 5)
  assert.equal(f.jobs[0].sessions[0].retry_state, 'exhausted')
  await f.uploader.retry(f.jobs[0].id); await f.uploader.queue
  assert.equal(f.calls.length, 7)
})

test('manual retry keeps successful sessions, counts and prevents duplicate submissions', async () => {
  let recovered = false
  const f = fixture({ sync: id => id === 'good' || recovered ? { ok: true, new_memory_count: 2 } : { ok: false, error: 'network error' } })
  const job = await f.uploader.start(binding, ['good', 'bad']); await f.uploader.queue
  recovered = true
  await Promise.all([f.uploader.retry(job.id), f.uploader.retry(job.id), f.uploader.tick()]); await f.uploader.queue
  assert.deepEqual(f.calls, ['good', 'bad', 'bad'])
  assert.equal(f.jobs[0].new_memory_count, 4)
})

test('neutral completion is never retried and a changed binding never uploads', async () => {
  const f = fixture({ sync: () => ({ ok: true, new_memory_count: 0 }) })
  const job = await f.uploader.start(binding, ['neutral']); await f.uploader.queue
  await f.uploader.tick(); await f.uploader.retry(job.id); await f.uploader.queue
  assert.deepEqual(f.calls, ['neutral'])
  const g = fixture(); await g.uploader.start(binding, ['s']); await g.uploader.queue
  g.ready(); g.block(); await g.uploader.tick(); await g.uploader.queue
  assert.equal(g.calls.length, 1)
  assert.equal(g.jobs[0].sessions[0].retry_state, 'blocked')
})

test('recovery of another credential or selection cannot stop an original owner retry', async () => {
  const f = fixture(); await f.uploader.start(binding, ['s']); await f.uploader.queue
  await f.uploader.recoveredElsewhere('s', { ...binding, credential_fingerprint: 'other' })
  assert.equal(f.jobs[0].sessions[0].retry_state, 'waiting_model')
  await f.uploader.recoveredElsewhere('s', binding)
  assert.equal(f.jobs[0].sessions[0].retry_state, 'recovered_elsewhere')
  f.ready(); await f.uploader.tick(); await f.uploader.queue
  assert.equal(f.calls.length, 1)
})

test('diagnostic outbox survives restart, redacts secrets and keeps owners separate', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'memory-diagnostics-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const filename = join(dir, 'outbox.json'); let connection = { serverUrl: 'http://memory', apiToken: 'owner-token' }, sent = []
  const options = { filename, connection: () => connection, fetchImpl: async (_, request) => {
    const events = JSON.parse(request.body).events; sent.push(...events)
    return { ok: true, json: async () => ({ accepted: events.map(x => x.id) }) }
  } }
  const first = new DiagnosticOutbox(options)
  await first.log('request.failed', { session_id: 's' }, { text: 'Bearer owner-token, password=secret-value', api_key: 'hidden', input: '完整处理上下文'.repeat(1000) })
  const local = await readFile(filename, 'utf8')
  assert.ok(!local.includes('owner-token') && !local.includes('secret-value') && !local.includes('hidden'))
  const restored = new DiagnosticOutbox(options); await restored.ready
  connection = { ...connection, apiToken: 'another-token' }; await restored.flush()
  assert.equal(sent.length, 0); assert.equal(restored.status().pending_events, 1)
  connection.apiToken = 'owner-token'; await Promise.all([restored.flush(), restored.flush()])
  assert.equal(sent.length, 1); assert.equal(restored.status().pending_events, 0)
  assert.equal(sent[0].details.input.length, '完整处理上下文'.repeat(1000).length)
})

test('unreadable local logs are preserved and new events remain recordable', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'memory-diag-broken-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const filename = join(dir, 'outbox.json'); await writeFile(filename, '{broken')
  const outbox = new DiagnosticOutbox({ filename, connection: () => ({}) }); await outbox.log('new.event')
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).events.length, 1)
  assert.match(outbox.status().last_error, /原文件已保留/)
})

test('secret fields and exhausted server tasks cannot accidentally enable more automatic retries', () => {
  assert.equal(redactDiagnostic({ nested: { authorization: 'anything' } }).nested.authorization, '[REDACTED]')
  assert.equal(diagnoseError({ retryExhausted: true, diagnosis: { retry_mode: 'scheduled' } }).retry_mode, 'blocked')
  assert.equal(redactDiagnostic({loc:['body','password'],input:'a'}).input,'[REDACTED]')
  assert.ok(!redactDiagnostic('broken JSON {"password":"test secret"').includes('test secret'))
})

test('large diagnostic batches split without truncating or dropping events', async () => {
  const batches = [], text = 'x'.repeat(2500000)
  const box = new DiagnosticOutbox({ connection: () => ({ serverUrl:'http://memory', apiToken:'owner-token' }), fetchImpl: async (_, request) => {
    const events = JSON.parse(request.body).events; batches.push(events)
    return { ok:true, json: async () => ({ accepted: events.map(x => x.id) }) }
  } })
  await box.log('first',{}, { input:text }); await box.log('second',{}, { input:text })
  await box.flush(); assert.equal(box.status().pending_events,1)
  await box.flush(); assert.equal(box.status().pending_events,0)
  assert.deepEqual(batches.map(x=>x.length),[1,1])
  assert.ok(batches.every(x=>x[0].details.input.length===text.length))
})

test('a server job missing its model pauses promptly instead of blocking the remaining workspaces', async () => {
  let calls=0
  const diagnosis=diagnoseError(new Error('no OpenAI-compatible model provider is configured'))
  const client=new MemoryClient(normalizeConfig({serverUrl:'http://memory',addTimeoutMs:20}), async()=>{
    calls++;return new Response(JSON.stringify({job_id:'ma_paused',status:'failed',error:'missing model',retry:{state:'waiting_model'},diagnosis}),{status:200})
  })
  await assert.rejects(client.addTrace({groupId:'g',trace:{}}),error=>error.diagnosis.code==='MODEL_NOT_CONFIGURED')
  assert.equal(calls,1)
})
