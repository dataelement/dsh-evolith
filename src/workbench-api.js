import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { isTrustedRequest, readJson, sendJson } from './web-api.js'
import { ProcessingCatalog } from './processing.js'

const BASE = '/dsh-memory-bridge/manager'
const ASSETS = '/dsh-memory-bridge/workbench-assets'
const STATIC = new URL('../static/', import.meta.url)
const joined = item => ['server', 'pending'].includes(item.mode) && !item.discovered

export async function managementRequest(connection, path, method = 'GET', payload) {
  const response = await fetch(connection.serverUrl + '/v1/workbench/' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${connection.apiToken}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {})
  })
  const text = await response.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { throw new Error('Memory 服务未返回正确 JSON，请检查服务版本和地址') }
  if (!response.ok) {
    const error = new Error(response.status === 404 ? '未找到管理接口或目标数据；完整工作台需要 Memory 服务端 0.7.0' : String(body?.detail || body?.error || response.status))
    error.status = response.status
    throw error
  }
  return { status: response.status, body }
}

export function registerWorkbenchApi(ctx, runtime) {
  const processing = new ProcessingCatalog(runtime)
  ctx.inject(['webServer'], webCtx => webCtx.effect(() => {
    const serverConnection = () => ({ serverUrl: runtime.client.serverUrl(), apiToken: runtime.client.apiToken() })
    const exclusive = (id, fn) => runtime.autoJoin ? runtime.autoJoin.exclusive(id, fn) : fn()
    const connectionFor = async mode => {
      if (mode !== 'server') throw new Error('新版仅支持线上 Memory')
      const connection = serverConnection()
      if (!connection.apiToken) throw new Error('请先在 DSH 设置 → 记忆保存服务器访问密钥')
      return connection
    }
    const serve = async (req, res, filename) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) return sendJson(res, 403, { error: 'Request rejected' })
      let data = await readFile(new URL(filename, STATIC), 'utf8')
      if (filename.endsWith('.html')) data = data.replaceAll('__API_BASE__', BASE).replaceAll('__ASSET_BASE__', ASSETS)
      res.writeHead(200, { 'content-type': filename.endsWith('.html') ? 'text/html; charset=utf-8' : filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
      res.end(data)
    }
    const disposers = [webCtx.webServer.register({ kind: 'exact', path: '/dsh-memory-bridge/panel', handler: (req, res) => serve(req, res, 'workbench.html') }),
      webCtx.webServer.register({ kind: 'exact', path: '/dsh-memory-bridge/workbench', handler: (req, res) => {
      if (req.method !== 'GET' || !isTrustedRequest(req)) return sendJson(res, 403, { error: 'Request rejected' })
      const target = new URL('/workbench', serverConnection().serverUrl)
      res.writeHead(303, { location: target.href, 'cache-control': 'no-store' })
      res.end()
    } }),
      webCtx.webServer.register({ kind: 'prefix', path: ASSETS, handler: (req, res) => {
        const filename = new URL(req.url, 'http://127.0.0.1').pathname.slice(ASSETS.length + 1)
        if (!['workbench.js', 'workbench.css', 'account.js'].includes(filename)) return sendJson(res, 404, { error: 'Not found' })
        return serve(req, res, filename)
      } }),
      webCtx.webServer.register({ kind: 'prefix', path: BASE, handler: async (req, res) => {
        if (!isTrustedRequest(req, req.method !== 'GET')) return sendJson(res, 403, { error: 'Request rejected' })
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          const path = url.pathname.slice(BASE.length + 1)
          if (path.split('/').some(p => ['..', '.'].includes(decodeURIComponent(p)) || /[\\/]/.test(decodeURIComponent(p)))) throw new Error('Invalid API path')
          const mode = url.searchParams.get('location') || 'server'
          const payload = req.method === 'GET' ? undefined : await readJson(req, 5 * 1024 * 1024)
          if (path === 'catalog' && req.method === 'GET') {
            const saved = await runtime.workspaceStore.snapshot()
            return sendJson(res, 200, { workspaces: runtime.catalog.workspaces().map(({ session_ids, ...item }) => item), bindings: saved.workspaces.filter(joined), uploads: saved.history_uploads || [], auto_join: runtime.autoJoin ? await runtime.autoJoin.status() : { enabled: false, group_id: '', status: 'disabled' } })
          }
          if (path === 'retries' && req.method === 'POST') return sendJson(res, 202, await runtime.uploads.retryAll())
          if (/^uploads\/[^/]+\/retry$/.test(path) && req.method === 'POST') {
            return sendJson(res, 202, { upload: await runtime.uploads.retry(decodeURIComponent(path.split('/')[1])) })
          }
          if (path === 'diagnostic-status' && req.method === 'GET') return sendJson(res, 200, runtime.diagnostics?.status() || {})
          if (path === 'auto-join') {
            if (!runtime.autoJoin) return sendJson(res, 501, { error: '请更新记忆插件后再使用自动加入' })
            if (req.method === 'GET') return sendJson(res, 200, await runtime.autoJoin.status())
            if (req.method === 'PUT') return sendJson(res, 200, await runtime.autoJoin.configure(payload))
            return sendJson(res, 405, { error: 'Method not allowed' })
          }
          if (path.startsWith('catalog/') && req.method === 'GET') return sendJson(res, 200, await runtime.catalog.sessions(decodeURIComponent(path.slice(8))))
          if (path === 'selection' && req.method === 'PUT') {
            const w = runtime.catalog.workspace(String(payload.dsh_workspace_id || ''))
            return await exclusive(w.workspace_id, async () => {
            const scope = payload.session_selection
            if (!['all', 'selected'].includes(scope)) throw new Error('请选择要加入记忆的会话')
            const ids = scope === 'all' ? w.session_ids : payload.session_ids
            if (!Array.isArray(ids) || ids.some(id => !w.session_ids.includes(id))) throw new Error('所选会话不属于该工作区，请刷新后重选')
            const groupId = String(payload.group_id || '').trim()
            const input = { path: w.path, name: w.name, mode: groupId ? 'server' : 'pending', group_id: groupId, server_url: runtime.client.serverUrl(), dsh_workspace_id: w.dsh_workspace_id, session_selection: scope, session_ids: ids }
            const prepared = await runtime.workspaceStore.prepare(input)
            const prior = await runtime.workspaceStore.snapshot()
            const existing = prior.workspaces.find(x => x.workspace_id === prepared.workspace_id)
            if (prepared.mode === 'pending') {
              if (existing?.mode === 'server') {
                const conn = await connectionFor('server')
                if (existing.server_url && existing.server_url !== conn.serverUrl) throw new Error('请先恢复原服务器连接，再解除记忆组绑定')
                await managementRequest(conn, `workspaces/${encodeURIComponent(existing.workspace_id)}?delete_memory=false`, 'DELETE')
              }
              const binding = await runtime.workspaceStore.save(input)
              return sendJson(res, 200, { binding, upload: null, awaiting_group: true })
            }
            const connection = await connectionFor('server')
            const credential_fingerprint = createHash('sha256').update(connection.apiToken).digest('hex')
            const pending = prior.history_uploads?.find(j => ['queued', 'running'].includes(j.status) && j.workspace_id === prepared.workspace_id && j.selection_revision === existing?.selection_revision && j.group_id === prepared.group_id && j.server_url === prepared.server_url && j.credential_fingerprint === credential_fingerprint && j.sessions.length === ids.length && j.sessions.every(x => ids.includes(x.session_id)))
            if (pending && existing.session_selection === scope) return sendJson(res, 202, { binding: existing, upload: pending, reused: true })
            if (String(payload.group_name || '').trim()) {
              try { await managementRequest(connection, 'groups', 'POST', { group_id: prepared.group_id, name: String(payload.group_name).trim(), description: '' }) }
              catch (error) { if (error.status !== 409) throw error }
            } else await runtime.client.ensureGroup({ groupId: prepared.group_id })
            await managementRequest(connection, 'workspaces', 'PUT', { workspace_id: prepared.workspace_id, name: prepared.name, path_hint: '', group_id: prepared.group_id })
            const binding = await runtime.workspaceStore.save(input)
            const job = await runtime.uploads.start({ ...binding, credential_fingerprint }, [...new Set(ids)])
            return sendJson(res, 202, { binding, upload: job })
            })
          }
          if (path === 'registry') {
            if (req.method === 'PUT') {
              if (typeof payload.selectedOnly === 'boolean') await runtime.workspaceStore.policy(payload.selectedOnly)
              if (typeof payload.server_url === 'string') await runtime.setServerUrl(payload.server_url)
              if (typeof payload.api_token === 'string' && payload.api_token) await runtime.setApiToken(payload.api_token)
            } else if (req.method !== 'GET') throw new Error('Method not allowed')
            const registry = await runtime.workspaceStore.snapshot()
            return sendJson(res, 200, { ...registry, workspaces: registry.workspaces.filter(joined), selectedOnly: true, server_url: runtime.client.serverUrl(), token_configured: Boolean(runtime.client.apiToken()), host_managed: true, online_only: true })
          }
          if (path === 'workspaces') {
            if (req.method === 'GET') return sendJson(res, 200, { workspaces: (await runtime.workspaceStore.snapshot()).workspaces.filter(joined), host_managed: true })
            return sendJson(res, 410, { error: '请在 DSH 设置 → 记忆选择工作区、会话和 Group ID 后加入' })
          }
          if (path.startsWith('workspaces/') && req.method === 'DELETE') {
            const id = decodeURIComponent(path.slice('workspaces/'.length))
            return await exclusive(id, async () => {
            const registry = await runtime.workspaceStore.snapshot()
            const item = registry.workspaces.find(w => w.workspace_id === id)
            if (!item) return sendJson(res, 404, { error: '工作区绑定不存在' })
            const deleteMemory = url.searchParams.get('delete_memory') === 'true'
            if (item.mode === 'server') {
              const conn = await connectionFor(item.mode)
              if (item.server_url && item.server_url !== conn.serverUrl) throw new Error('请先恢复该工作区绑定的服务器地址')
              await managementRequest(conn, `workspaces/${encodeURIComponent(id)}?delete_memory=${deleteMemory}`, 'DELETE')
            }
            await runtime.workspaceStore.remove(id)
            return sendJson(res, 200, { workspace_removed: true, memory_deleted: deleteMemory })
            })
          }
          if (path === 'upload') return sendJson(res, 410, { error: '本地上传入口已移除，请在 DSH 设置 → 记忆选择工作区与会话' })
          if (!/^(info|groups(?:\/.*)?|events|model-provider|usage|processing)$/.test(path)) return sendJson(res, 404, { error: 'Not found' })
          if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return sendJson(res, 405, { error: 'Method not allowed' })
          const connection = await connectionFor(mode)
          url.searchParams.delete('location')
          const selectedWorkspace = path === 'processing' ? url.searchParams.get('workspace_id') || '' : ''
          if (path === 'processing') url.searchParams.delete('workspace_id')
          const query = url.searchParams.toString()
          const result = await managementRequest(connection, path + (query ? '?' + query : ''), req.method, payload)
          if (result.status === 204) { res.writeHead(204); res.end(); return }
          if (path === 'processing' && req.method === 'GET') return sendJson(res, result.status, await processing.enrich(result.body, connection, selectedWorkspace))
          return sendJson(res, result.status, { ...result.body, ...(path === 'info' ? { host_managed: true } : {}) })
        } catch (error) {
          sendJson(res, error.status || 400, { error: error.message })
        }
      } })]
    return () => disposers.forEach(dispose => dispose())
  }, 'dsh-memory-bridge: workbench'))
}
