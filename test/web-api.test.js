import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTrustedRequest, registerWebApi } from '../src/web-api.js'
import { registerWorkbenchApi } from '../src/workbench-api.js'
import { GroupConfigStore } from '../src/group-config.js'

test('desktop forwarding accepts a marked local mutation while preserving origin and proxy checks', () => {
  const trusted = (headers, address = '127.0.0.1') => isTrustedRequest({ headers: { host: '127.0.0.1:1234', ...headers }, socket: { remoteAddress: address } }, true)
  assert.equal(trusted({ origin: 'http://127.0.0.1:1234' }), true)
  assert.equal(trusted({ 'x-dsh-memory-request': '1' }), true)
  assert.equal(trusted({ host: '[::1]:1234', origin: 'http://[::1]:1234' }, '::1'), true)
  for (const headers of [
    {}, { origin: '' }, { origin: 'null' }, { origin: 'dsh-app://app' },
    { origin: 'http://127.0.0.1:9999' }, { origin: 'https://attacker.invalid' },
    { host: 'attacker.invalid' }, { host: '127.0.0.1:1234/path' },
    { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    { forwarded: 'for=192.0.2.1' }, { 'x-forwarded-for': '192.0.2.1' },
    { 'x-forwarded-host': '127.0.0.1:1234' }, { 'x-real-ip': '192.0.2.1' }
  ]) {
    // Absence alone still fails; a marker never overrides a foreign origin.
    assert.equal(trusted(headers), false, JSON.stringify(headers))
    if (Object.keys(headers).length) assert.equal(trusted({ 'x-dsh-memory-request': '1', ...headers }), false, JSON.stringify(headers))
  }
  assert.equal(trusted({ 'x-dsh-memory-request': '1' }, '192.0.2.1'), false)
})

test('both configuration routes persist desktop saves, retain a blank key, and reject foreign writes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-web-config-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new GroupConfigStore(join(dir, 'memory-bridge.json'))
  let value = await store.saveConfig({ serverUrl: 'http://memory.invalid:8000', apiToken: 'fixture-key', groupId: 'existing-group' })
  const snapshot = () => ({ server: { url: value.serverUrl, token_configured: Boolean(value.apiToken) } })
  const runtime = { snapshot, client: { serverUrl: () => value.serverUrl, apiToken: () => value.apiToken },
    workspaceStore: { snapshot: async () => ({ workspaces: [] }) },
    async setServerUrl(serverUrl) { value = await store.saveConfig({ serverUrl }); return snapshot() },
    async setApiToken(apiToken) { value = await store.saveConfig({ apiToken }); return snapshot() } }
  const routes = []
  const ctx = { inject: (_, fn) => fn({ effect: fn => fn(), webServer: { register: r => { routes.push(r); return () => {} } } }) }
  registerWebApi(ctx, runtime); registerWorkbenchApi(ctx, runtime)
  const server = createServer((req, res) => routes.find(r => r.kind === 'prefix' ? req.url.startsWith(r.path + '/') : req.url === r.path).handler(req, res)).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const base = 'http://127.0.0.1:' + server.address().port
  for (const path of ['/dsh-memory-bridge/config', '/dsh-memory-bridge/manager/registry']) {
    const response = await fetch(base + path, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-dsh-memory-request': '1' }, body: JSON.stringify({ server_url: 'http://memory.invalid:9000' }) })
    assert.equal(response.status, 200)
    assert.doesNotMatch(await response.text(), /fixture-key/)
    const rejected = await fetch(base + path, { method: 'PUT', headers: { origin: 'https://attacker.invalid', 'x-dsh-memory-request': '1' }, body: JSON.stringify({ server_url: 'http://attacker.invalid' }) })
    assert.equal(rejected.status, 403)
  }
  const blank = await fetch(base + '/dsh-memory-bridge/manager/registry', { method: 'PUT', headers: { 'x-dsh-memory-request': '1' }, body: JSON.stringify({ api_token: '' }) })
  assert.equal(blank.status, 200)
  assert.deepEqual(await new GroupConfigStore(store.filename).loadConfig(), { serverUrl: 'http://memory.invalid:9000', apiToken: 'fixture-key', groupId: 'existing-group' })
  const preflight = await fetch(base + '/dsh-memory-bridge/manager/registry', { method: 'OPTIONS', headers: { origin: 'https://attacker.invalid', 'access-control-request-headers': 'x-dsh-memory-request', 'access-control-request-method': 'PUT' } })
  assert.equal(preflight.status, 403)
  assert.equal(preflight.headers.has('access-control-allow-origin'), false)
})
