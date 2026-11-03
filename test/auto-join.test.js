import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { WorkspaceStore, workspaceId } from '../src/workspaces.js'
import { WorkspaceAutoJoin } from '../src/auto-join.js'

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'dsh-autojoin-test-'))
  t.after(async () => {
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()))
    assert.ok(basename(folder).startsWith('dsh-autojoin-test-'))
    await rm(folder, { recursive: true, force: true })
  })
  const store = new WorkspaceStore(join(folder,'settings.json')), workspaces = [], requests = [], uploads = []
  let token = 'fixture-token', onRequest = async () => {}, scopes = ['groups:manage','memory:read','memory:write','sessions:supervise']
  const client = { serverUrl: () => 'http://127.0.0.1:18888', apiToken: () => token, ensureGroup: async () => {} }
  const catalog = { workspaces: () => structuredClone(workspaces), workspace: id => {
    const w = workspaces.find(w => w.dsh_workspace_id === id); if (!w) throw new Error('Native workspace removed'); return structuredClone(w)
  } }
  const request = async (connection,path,method='GET',body) => {
    requests.push({path,method,body,token:connection.apiToken})
    await onRequest(path,method)
    return {body:{scopes}}
  }
  const uploader = { start: async (binding,ids) => { uploads.push({binding,ids}); return {id:'upload-'+uploads.length} } }
  const auto = new WorkspaceAutoJoin({store,catalog,client,uploads:uploader,request})
  const add = async (id, ids=[id+'-session']) => {
    const path = join(folder,id); await mkdir(path)
    const w = {dsh_workspace_id:id,workspace_id:workspaceId(path),path,name:id,session_ids:ids}
    workspaces.push(w); return w
  }
  const input = (w,patch={}) => ({...w,server_url:client.serverUrl(),mode:'server',group_id:'manual-group',session_selection:'all',...patch})
  return {store,auto,client,catalog,requests,uploads,workspaces,add,input,
    rotate: () => {token='rotated-token'}, intercept: fn => {onRequest=fn}, readonly: () => {scopes=['memory:read']},
    restored: () => new WorkspaceAutoJoin({store:new WorkspaceStore(store.filename),catalog,client,uploads:uploader,request})}
}

test('off by default; automatic joining preserves manual and pending selections',async t => {
  const f=await fixture(t), manual=await f.add('manual'), pending=await f.add('pending'), fresh=await f.add('fresh')
  await f.store.save(f.input(manual))
  await f.store.save(f.input(pending,{mode:'pending',group_id:''}))
  await f.auto.scan(); assert.equal(f.requests.length,0)
  await f.auto.configure({enabled:true,group_id:'default-group'}); await f.auto.scan()
  const rows=(await f.store.snapshot()).workspaces
  assert.equal(rows.find(w=>w.workspace_id===manual.workspace_id).group_id,'manual-group')
  assert.equal(rows.find(w=>w.workspace_id===pending.workspace_id).mode,'pending')
  const joined=rows.find(w=>w.workspace_id===fresh.workspace_id)
  assert.equal(joined.group_id,'default-group'); assert.equal(joined.auto_joined,true); assert.equal(joined.session_selection,'all')
  assert.equal(f.uploads.length,1); assert.deepEqual(f.uploads[0].ids,['fresh-session'])
})

test('new and empty workspaces join; future sessions inherit without repeating history',async t => {
  const f=await fixture(t)
  await f.auto.configure({enabled:true,group_id:'default-group'}); await f.auto.scan()
  const w=await f.add('future'), empty=await f.add('empty',[])
  await Promise.all([f.auto.scan(),f.auto.ensureSession({id:'future-session'})])
  assert.equal(f.uploads.length,2)
  assert.equal(f.uploads.find(x=>x.binding.workspace_id===empty.workspace_id).ids.length,0)
  w.session_ids.push('later-session')
  await f.auto.ensureSession({id:'later-session'})
  assert.equal((await f.store.binding({id:'later-session',header:{cwd:w.path}})).group_id,'default-group')
  assert.equal(f.uploads.length,2)
})

test('manual removal persists as exclusion; explicit rejoin clears it',async t => {
  const f=await fixture(t), w=await f.add('one')
  await f.auto.configure({enabled:true,group_id:'default-group'}); await f.auto.scan()
  await f.auto.exclusive(w.workspace_id,()=>f.store.remove(w.workspace_id))
  const restored=f.restored(); await restored.scan()
  assert.equal((await f.store.snapshot()).workspaces.length,0); assert.equal(f.uploads.length,1)
  await f.store.save(f.input(w))
  assert.deepEqual((await f.store.snapshot()).auto_join_exclusions,[])
  await restored.scan()
  assert.equal((await f.store.snapshot()).workspaces[0].group_id,'manual-group')
})

test('changing the default affects later joins; disabling retains previous bindings',async t => {
  const f=await fixture(t), a=await f.add('a')
  await f.auto.configure({enabled:true,group_id:'first-group'}); await f.auto.scan()
  await f.auto.configure({enabled:true,group_id:'second-group'}); await f.auto.scan()
  const b=await f.add('b'); await f.auto.scan()
  let rows=(await f.store.snapshot()).workspaces
  assert.equal(rows.find(w=>w.workspace_id===a.workspace_id).group_id,'first-group')
  assert.equal(rows.find(w=>w.workspace_id===b.workspace_id).group_id,'second-group')
  await f.auto.configure({enabled:false,group_id:'second-group'})
  await f.add('c'); await f.auto.scan()
  assert.equal((await f.store.snapshot()).workspaces.length,2)
})

test('concurrent poll/session checks create exactly one binding and history job',async t => {
  const f=await fixture(t); await f.add('one')
  await f.auto.configure({enabled:true,group_id:'default-group'})
  await Promise.all(Array.from({length:12},()=>f.auto.ensureSession({id:'one-session'})))
  await f.auto.scan()
  assert.equal(f.uploads.length,1)
  assert.equal(f.requests.filter(r=>r.path==='workspaces').length,1)
})

test('manual selection wins when it races an already started automatic join',async t => {
  const f=await fixture(t), w=await f.add('one')
  let release,announce
  const blocked=new Promise(resolve=>{release=resolve}), started=new Promise(resolve=>{announce=resolve})
  f.intercept(async (path,method)=>{if(path==='workspaces'&&method==='PUT'){announce();await blocked}})
  await f.auto.configure({enabled:true,group_id:'default-group'}); await started
  const manual=f.auto.exclusive(w.workspace_id,()=>f.store.save(f.input(w)))
  release(); await manual; await f.auto.scan()
  assert.equal((await f.store.snapshot()).workspaces[0].group_id,'manual-group')
  assert.equal((await f.store.snapshot()).workspaces[0].auto_joined,undefined)
})

test('credential changes pause automatic joining and roll back a stale in-flight binding',async t => {
  const f=await fixture(t); await f.add('one')
  let release,announce
  const blocked=new Promise(resolve=>{release=resolve}), started=new Promise(resolve=>{announce=resolve})
  f.intercept(async(path,method)=>{if(path==='workspaces'&&method==='PUT'){announce();await blocked}})
  await f.auto.configure({enabled:true,group_id:'default-group'}); await started
  f.rotate(); release(); await f.auto.scan()
  assert.equal((await f.auto.status()).status,'paused')
  assert.equal((await f.store.snapshot()).workspaces.length,0); assert.equal(f.uploads.length,0)
  assert.equal(f.requests.filter(r=>r.method==='DELETE').length,1)
})

test('insufficient scopes and invalid defaults do not save an enabled policy',async t => {
  const f=await fixture(t); await f.add('one'); f.readonly()
  await assert.rejects(f.auto.configure({enabled:true,group_id:'default-group'}),/权限不足/)
  await assert.rejects(f.auto.configure({enabled:true,group_id:''}),/选择默认/)
  await assert.rejects(f.auto.configure({enabled:true,group_id:'中文编号'}))
  assert.equal((await f.auto.status()).enabled,false); assert.equal(f.uploads.length,0)
})

test('first session is checked against native membership, never only a folder path',async t => {
  const f=await fixture(t)
  await f.auto.configure({enabled:true,group_id:'default-group'}); await f.auto.scan()
  const w=await f.add('one')
  await f.auto.ensureSession({id:'foreign-session',header:{cwd:w.path}})
  assert.equal(f.uploads.length,0)
  await f.auto.ensureSession({id:'one-session',header:{cwd:w.path}})
  assert.equal(f.uploads.length,1)
})
