import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { ProcessingCatalog } from '../src/processing.js'
import { normalizeConfig } from '../src/config.js'

const connection = { serverUrl: 'http://memory.invalid', apiToken: 'fixture-key' }
const hash = value => createHash('sha256').update(value).digest('hex')
const episode = (group, id) => 'dsh-selection-' + hash(hash(JSON.stringify([connection.serverUrl, group])) + ':' + id) + ':5:abcdef012345:feedback'
function fixture() {
  const workspaces = [
    { workspace_id: 'w1', dsh_workspace_id: 'd1', name: '项目甲', session_ids: ['s1', 'excluded'] },
    { workspace_id: 'w2', dsh_workspace_id: 'd2', name: '项目乙', session_ids: ['s2'] }
  ]
  const bindings = workspaces.map(w => ({ ...w, mode: 'server', server_url: connection.serverUrl, group_id: 'g', session_selection: 'selected', session_ids: w.workspace_id === 'w1' ? ['s1'] : ['s2'] }))
  const requests = []
  const details = { ma_1: episode('g', 's1'), ma_2: episode('g', 's2'), ma_excluded: episode('g', 'excluded') }
  const runtime = { config: normalizeConfig(), workspaceStore: { snapshot: async () => ({ workspaces: bindings }) },
    catalog: { workspaces: () => workspaces, sessions: async id => ({ sessions: workspaces.find(w => w.dsh_workspace_id === id).session_ids.map(session_id => ({ session_id, title: '讨论-' + session_id })) }) },
    client: { fetchImpl: async (url, init) => { requests.push({ url, init }); const id = url.split('/').at(-1); return new Response(JSON.stringify({ job_id: id, group_id: 'g', episode_key: details[id] }), { status: 200 }) } } }
  const jobs = Object.keys(details).map((job_id, i) => ({ job_id, group_id: 'g', status: 'succeeded', new_memory_count: 1, updated_at: '2026-11-18T00:00:0' + i + 'Z' }))
  return { runtime, requests, jobs, workspaces, bindings }
}

test('restores real project and conversation names for old tasks after a plugin restart', async () => {
  const f = fixture()
  for (let restart = 0; restart < 2; restart++) {
    const catalog = new ProcessingCatalog(f.runtime)
    const result = await catalog.enrich({ jobs: f.jobs }, connection)
    const first = result.jobs.find(j => j.job_id === 'ma_1'), second = result.jobs.find(j => j.job_id === 'ma_2')
    assert.equal(first.title, '项目甲'); assert.equal(first.session_title, '讨论-s1')
    assert.equal(second.title, '项目乙'); assert.equal(second.session_title, '讨论-s2')
    assert.equal(first.status, 'succeeded'); assert.equal(first.new_memory_count, 1)
    assert.equal(result.jobs.find(j => j.job_id === 'ma_excluded').source_resolved, false)
    const count = f.requests.length
    await catalog.enrich({ jobs: f.jobs }, connection, 'd1')
    assert.equal(f.requests.length, count, 'refresh reuses job metadata without extra requests')
  }
})

test('task names follow local renames and never infer a project just because it shares a group', async () => {
  const f = fixture(), catalog = new ProcessingCatalog(f.runtime)
  await catalog.enrich({ jobs: f.jobs }, connection)
  f.workspaces[0].name = '项目甲改名'
  const result = await catalog.enrich({ jobs: f.jobs }, connection)
  assert.equal(result.jobs.find(j => j.job_id === 'ma_1').title, '项目甲改名')
  assert.match(result.jobs.find(j => j.job_id === 'ma_excluded').title, /来源未识别/)
  assert.equal((await catalog.enrich({ jobs: f.jobs }, connection, 'missing-workspace')).jobs.length, 0)
})

test('metadata errors and account changes preserve results without reusing another account cache', async () => {
  const f = fixture(), catalog = new ProcessingCatalog(f.runtime)
  await catalog.enrich({ jobs: f.jobs }, connection)
  let calls = 0
  f.runtime.client.fetchImpl = async (_, init) => { calls++; assert.equal(init.headers.authorization, 'Bearer different-key'); return new Response('{}', { status: 404 }) }
  const result = await catalog.enrich({ jobs: f.jobs }, { ...connection, apiToken: 'different-key' })
  assert.equal(calls, 3)
  assert.ok(result.jobs.every(j => !j.source_resolved && j.status === 'succeeded'))
})

test('overview resolves only eight visible jobs and rejects mismatched detail responses', async () => {
  const f = fixture()
  f.runtime.client.fetchImpl = async () => { f.requests.push(1); return new Response(JSON.stringify({ job_id: 'ma_wrong', group_id: 'g', episode_key: episode('g', 's1') })) }
  const result = await new ProcessingCatalog(f.runtime).enrich({ jobs: Array.from({ length: 200 }, (_, i) => ({ job_id: 'ma_' + i, group_id: 'g', status: 'running' })) }, connection)
  assert.equal(f.requests.length, 8); assert.equal(result.jobs.length, 8)
  assert.ok(result.jobs.every(j => !j.source_resolved))
})
