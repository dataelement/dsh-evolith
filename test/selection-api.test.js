import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceStore, workspaceId } from '../src/workspaces.js'
import { WorkspaceAutoJoin } from '../src/auto-join.js'
import { registerWorkbenchApi } from '../src/workbench-api.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'selection-api-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const requests = [], routes = []
  let allowed = true
  const upstream = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    requests.push({ path: req.url, body: raw && JSON.parse(raw) })
    res.writeHead(allowed ? 200 : 403, { 'content-type': 'application/json' })
    res.end(JSON.stringify(allowed ? req.url.endsWith('/info') ? { scopes:['groups:manage','memory:read','memory:write','sessions:supervise'] } : { ok: true } : { detail: 'Forbidden group' }))
  }).listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  t.after(() => { upstream.closeAllConnections(); upstream.close() })
  const upstreamUrl = 'http://127.0.0.1:' + upstream.address().port
  const store = new WorkspaceStore(join(dir, 'settings.json'))
  const w = { dsh_workspace_id: 'dsh-id', workspace_id:workspaceId(dir), path: dir, name: 'Selected workspace', session_ids: ['one', 'two'], session_count: 2 }
  const runtime = { workspaceStore: store, catalog: {
    workspaces: () => [w], workspace: id => { if (id !== w.dsh_workspace_id) throw new Error('Unknown workspace'); return w },
    sessions: async () => ({ ...w, sessions: w.session_ids.map(session_id => ({ session_id, title: session_id })) })
  }, client: { serverUrl: () => upstreamUrl, apiToken: () => 'test-token', ensureGroup: async ({ groupId }) => { requests.push({ groupId }) } },
  uploads: { start: async (binding, ids) => {
    const job = { id: 'upload', ...binding, sessions: ids.map(session_id => ({ session_id })), total: ids.length, status: 'queued' }
    await store.saveUpload(job); return job
  } } }
  runtime.autoJoin = new WorkspaceAutoJoin({store,catalog:runtime.catalog,client:runtime.client,uploads:runtime.uploads})
  registerWorkbenchApi({ inject: (deps, fn) => fn({ effect: fn => fn(), webServer: { register: route => { routes.push(route); return () => {} } } }) }, runtime)
  const host = createServer((req, res) => {
    const route = routes.find(x => x.kind === 'prefix' ? req.url.startsWith(x.path) : req.url === x.path)
    if (!route) { res.writeHead(404); res.end(); return }
    route.handler(req, res)
  }).listen(0, '127.0.0.1')
  await once(host, 'listening')
  t.after(() => { host.closeAllConnections(); host.close() })
  const base = 'http://127.0.0.1:' + host.address().port
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(base + '/dsh-memory-bridge/manager/' + path, { method, headers: { origin: base, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    return { status: response.status, body: await response.json() }
  }
  return { store, requests, call, base, upstreamUrl, auto:runtime.autoJoin, w, forbid: () => { allowed = false }, input: { dsh_workspace_id: w.dsh_workspace_id, group_id: 'chosen-group', session_selection: 'all', session_ids: [] } }
}

test('auto-join HTTP settings, catalog, manual override and removal share the same lifecycle', async t => {
  const f=await fixture(t)
  assert.equal((await f.call('auto-join')).body.enabled,false)
  assert.equal((await f.call('auto-join','PUT',{enabled:true,group_id:'automatic-group'})).status,200)
  await f.auto.scan()
  let catalog=(await f.call('catalog')).body
  assert.equal(catalog.bindings[0].group_id,'automatic-group')
  assert.equal(catalog.bindings[0].auto_joined,true)
  assert.equal(catalog.uploads.length,1)
  assert.equal((await f.call('selection','PUT',f.input)).status,202)
  await f.auto.scan()
  assert.equal((await f.call('catalog')).body.bindings[0].group_id,'chosen-group')
  assert.equal((await f.call('workspaces/'+f.w.workspace_id,'DELETE')).status,200)
  await f.auto.scan()
  catalog=(await f.call('catalog')).body
  assert.deepEqual(catalog.bindings,[])
  assert.equal(catalog.auto_join.excluded_count,1)
  assert.equal((await f.call('auto-join','PUT',{enabled:false,group_id:'automatic-group'})).body.status,'disabled')
})

test('invalid or unauthorized automatic settings never save an enabled policy',async t=>{
  const f=await fixture(t)
  assert.equal((await f.call('auto-join','PUT',{enabled:true,group_id:'中文组'})).status,400)
  assert.equal((await f.call('auto-join','PUT',{enabled:true,group_id:''})).status,400)
  f.forbid()
  assert.equal((await f.call('auto-join','PUT',{enabled:true,group_id:'blocked-group'})).status,403)
  assert.equal((await f.call('auto-join')).body.enabled,false)
  assert.deepEqual((await f.store.snapshot()).workspaces,[])
})

test('the only plugin portal entry redirects to the same server workbench without a token', async t => {
  const f = await fixture(t)
  const r = await fetch(f.base + '/dsh-memory-bridge/workbench', { redirect: 'manual' })
  assert.equal(r.status, 303)
  assert.equal(r.headers.get('location'), f.upstreamUrl + '/workbench')
  assert.equal(r.headers.get('location').includes('test-token'), false)
  assert.deepEqual(f.requests, [])
  assert.equal((await fetch(f.base + '/dsh-memory-bridge/workbench', { method: 'POST' })).status, 403)
})

test('selection rejects foreign workspace/session IDs before any server side effect', async t => {
  const f = await fixture(t)
  assert.equal((await f.call('selection', 'PUT', { ...f.input, dsh_workspace_id: 'foreign' })).status, 400)
  assert.equal((await f.call('selection', 'PUT', { ...f.input, session_selection: 'selected', session_ids: ['foreign'] })).status, 400)
  assert.deepEqual(f.requests, []); assert.deepEqual((await f.store.snapshot()).workspaces, [])
  assert.equal((await f.call('workspaces', 'PUT', { mode: 'local' })).status, 410)
  assert.equal((await f.call('upload', 'POST', {})).status, 410)
  assert.equal((await f.call('groups?location=local')).status, 400)
})

test('all uses authoritative DSH IDs, and a duplicate pending join reuses its upload', async t => {
  const f = await fixture(t)
  const first = await f.call('selection', 'PUT', f.input)
  assert.equal(first.status, 202); assert.deepEqual(first.body.upload.sessions.map(x => x.session_id), ['one', 'two'])
  const repeated = await f.call('selection', 'PUT', f.input)
  assert.equal(repeated.status, 202); assert.equal(repeated.body.reused, true)
  assert.equal(f.requests.length, 2); assert.equal(f.requests[1].body.path_hint, '')
  assert.equal((await f.store.snapshot()).history_uploads.length, 1)
})

test('server permission rejection never commits a selection or starts history upload', async t => {
  const f = await fixture(t); f.forbid()
  assert.equal((await f.call('selection', 'PUT', f.input)).status, 403)
  const saved = await f.store.snapshot()
  assert.deepEqual(saved.workspaces, []); assert.equal(saved.history_uploads, undefined)
})
