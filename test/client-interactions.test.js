import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'

// Execute the shipped client and its actual button handlers with a small hook
// host. HTTP responses and optional DSH services are the only substitutes.
async function fixture({ services = {}, local = [], remote = [], tokenConfigured = true } = {}) {
  let definition, component, cursor = 0
  const cells = [], calls = [], opened = []
  const react = {
    Fragment: 'fragment', createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value }] },
    useEffect() {}, useCallback: fn => fn, useRef: initial => ({ current: initial })
  }
  const workspace = { workspace_id: 'w', dsh_workspace_id: 'd', name: '真实项目名', path: '/fixture/project', session_count: 1 }
  const data = { workspaces: [workspace], bindings: [{ ...workspace, group_id: 'g', mode: 'server', session_selection: 'all' }], uploads: [] }
  runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    URL, window: { __ModuleLoader__: { load: value => { definition = value } }, open: (...args) => opened.push(args) },
    document: { querySelector: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options })
      const value = url.endsWith('/status') ? { server: { url: 'http://memory.invalid:28192', token_configured: tokenConfigured }, sessions: local }
        : url.endsWith('/catalog') ? data : url.includes('/processing') ? { jobs: remote }
        : url.endsWith('/groups') ? { groups: [{ group_id: 'g', name: '组名' }] } : {}
      return { ok: true, json: async () => value }
    }
  })
  definition.factory(() => react).apply({
    get: name => services[name], effect: fn => fn(), locale: { register() {}, bind: () => () => '记忆' },
    slots: { inject: (_, fn) => fn(), register: (_, view) => { component = view } }
  })
  const render = () => { cursor = 0; return component() }
  const nodes = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : []
  const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree ?? '')
  const button = (tree, label) => nodes(tree).find(n => n.type === 'button' && text(n) === label)
  await button(render(), '刷新').props.onClick()
  return { render, nodes, text, button, calls, opened }
}

test('memory management opens the real server in the official DSH browser without passing a credential', async () => {
  const tabs = []
  const f = await fixture({ services: { sidebarRight: { openTab: (...args) => tabs.push(args) }, sidebarRightTabs: { get: kind => kind === 'browser' && {} } } })
  f.button(f.render(), '记忆管理').props.onClick()
  assert.equal(tabs[0][0], 'browser')
  assert.equal(tabs[0][1].params.url, 'http://memory.invalid:28192/workbench')
  assert.equal(f.opened.length, 0)
  const external = f.nodes(f.render()).find(n => n.type === 'a' && f.text(n) === '系统浏览器打开')
  assert.equal(external.props.href, 'http://memory.invalid:28192/workbench')
  assert.equal(external.props.rel, 'noopener noreferrer')
})

test('older DSH without a browser service can still open memory management externally', async () => {
  const f = await fixture()
  f.button(f.render(), '记忆管理').props.onClick()
  assert.deepEqual(f.opened[0], ['http://memory.invalid:28192/workbench', '_blank', 'noopener,noreferrer'])
})

test('a browser service error is visible and the external alternative stays available', async () => {
  const f = await fixture({ services: { sidebarRight: { openTab() { throw new Error('no active session') } }, sidebarRightTabs: { get: () => ({}) } } })
  f.button(f.render(), '记忆管理').props.onClick()
  assert.match(f.text(f.render()), /内置浏览器未能打开.*no active session/)
  assert.ok(f.nodes(f.render()).some(n => n.type === 'a' && n.props.href === 'http://memory.invalid:28192/workbench'))
})

test('the shipped save handler marks mutations and leaves the stored key untouched when empty', async () => {
  const f = await fixture()
  const password = f.nodes(f.render()).find(n => n.type === 'input' && n.props.type === 'password')
  assert.equal(password.props.placeholder, '****')
  assert.equal(password.props.value, '')
  assert.match(f.text(f.render()), /已保存/)
  const input = f.nodes(f.render()).find(n => n.type === 'input' && n.props.type === 'url')
  input.props.onChange({ target: { value: 'http://memory.invalid:9000' } })
  await f.button(f.render(), '保存连接配置').props.onClick()
  const call = f.calls.find(c => c.options.method === 'PUT')
  assert.equal(call.url, '/dsh-memory-bridge/manager/registry')
  assert.equal(call.options.headers['x-dsh-memory-request'], '1')
  assert.deepEqual(JSON.parse(call.options.body), { server_url: 'http://memory.invalid:9000' })
})

test('settings keeps connection and collapsed local errors without legacy panels', async () => {
  const f = await fixture()
  const tree = f.render(), text = f.text(tree)
  assert.match(text, /线上服务连接/)
  assert.match(text, /本地错误日志/)
  assert.doesNotMatch(text, /记忆处理状态|已加入的工作区|会话处理与失败重试|真实项目名/)
  const detail = f.nodes(tree).find(n => n.type === 'details')
  assert.ok(detail)
  assert.ok(!detail.props.open)
  assert.ok(!f.calls.some(c => /processing|catalog|groups/.test(c.url)))
})

test('an unconfigured memory key has an explicit empty prompt', async () => {
  const f = await fixture({tokenConfigured:false})
  const input = f.nodes(f.render()).find(n => n.type === 'input' && n.props.type === 'password')
  assert.equal(input.props.placeholder, '请输入访问密钥')
  assert.equal(input.props.value, '')
  assert.doesNotMatch(f.text(f.render()), /已保存/)
})
