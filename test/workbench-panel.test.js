import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import test from 'node:test'
import { registerWorkbenchApi } from '../src/workbench-api.js'

async function withPanel(run) {
  const routes = []
  let dispose
  const webCtx = {
    webServer: { register(route) { routes.push(route); return () => routes.splice(routes.indexOf(route), 1) } },
    effect(fn) { dispose = fn() }
  }
  const runtime = {
    client: { serverUrl: () => 'http://memory.invalid:28192', apiToken: () => 'fixture-access-key' }
  }
  registerWorkbenchApi({ inject(_names, fn) { fn(webCtx) } }, runtime)
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname
    const route = routes.find(item => item.kind === 'exact' ? item.path === path : path.startsWith(item.path + '/'))
    if (!route) { res.writeHead(404); res.end(); return }
    try { await route.handler(req, res) } catch (error) { res.writeHead(500); res.end(error.message) }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try { await run('http://127.0.0.1:' + server.address().port) }
  finally { dispose(); await new Promise(resolve => server.close(resolve)); assert.equal(routes.length, 0) }
}

test('embedded management page resolves its local modules without placing the access key in HTML', async () => {
  await withPanel(async base => {
    const response = await fetch(base + '/dsh-memory-bridge/panel')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /text\/html/)
    const html = await response.text()
    assert.match(html, /content="\/dsh-memory-bridge\/manager"/)
    assert.doesNotMatch(html, /__API_BASE__|__ASSET_BASE__|fixture-access-key/)
    for (const filename of ['workbench.js', 'workbench.css', 'account.js']) {
      const asset = await fetch(base + '/dsh-memory-bridge/workbench-assets/' + filename)
      assert.equal(asset.status, 200, filename)
      assert.ok((await asset.text()).length > 0)
    }
  })
})

test('embedded page rejects forwarded requests and cannot serve arbitrary package files', async () => {
  await withPanel(async base => {
    const rejected = await fetch(base + '/dsh-memory-bridge/panel', { headers: { 'x-forwarded-for': '198.51.100.5' } })
    assert.equal(rejected.status, 403)
    for (const name of ['package.json', '.env', '%2e%2e%2findex.js']) {
      const response = await fetch(base + '/dsh-memory-bridge/workbench-assets/' + name)
      assert.equal(response.status, 404)
    }
    const post = await fetch(base + '/dsh-memory-bridge/panel', { method: 'POST' })
    assert.equal(post.status, 403)
  })
})
