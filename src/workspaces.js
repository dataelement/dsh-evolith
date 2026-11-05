import { readFile, writeFile, mkdir, rename, unlink, stat } from 'node:fs/promises'
import { dirname, join, resolve, basename, isAbsolute } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { normalizeGroupId, normalizeServerUrl } from './group-config.js'

export const workspacePath = value => {
  const path = resolve(String(value))
  return process.platform === 'win32' ? path.toLowerCase() : path
}
export const workspaceId = path => createHash('sha256').update(workspacePath(path)).digest('hex').slice(0, 40)

export class WorkspaceStore {
  constructor(filename = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'memory-workbench.json') : undefined) {
    this.filename = filename
    this.value = { version: 1, selectedOnly: Boolean(filename), workspaces: [] }
    this.ready = this.load()
    this.queue = Promise.resolve()
  }
  async load() {
    if (!this.filename) return
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8'))
      if (![1, 2].includes(value.version) || !Array.isArray(value.workspaces)) throw new Error('Unsupported workspace configuration')
      this.value = value
    } catch (e) { if (e.code !== 'ENOENT') throw e }
  }
  async snapshot() { await this.ready; const value = structuredClone(this.value); delete value.session_bindings; return value }
  async sessionBinding(sessionId) {
    await this.ready
    return structuredClone(this.value.session_bindings?.find(item => item.session_id === String(sessionId)))
  }
  async rememberSession(sessionId, binding) {
    return this.mutate(next => {
      next.session_bindings ??= []
      let item = next.session_bindings.find(item => item.session_id === String(sessionId))
      if (!item) { item = { session_id: String(sessionId), ...binding }; next.session_bindings.push(item) }
      else if (binding.selection_revision !== undefined && binding.selection_revision !== item.selection_revision) Object.assign(item, binding)
      return structuredClone(item)
    })
  }
  async mutate(fn) {
    const operation = this.queue.catch(() => {}).then(async () => {
      await this.ready
      const next = structuredClone(this.value)
      const result = await fn(next)
      if (this.filename) {
        await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
        const temp = this.filename + '.' + randomUUID() + '.tmp'
        try {
          await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
          await rename(temp, this.filename)
        } catch (e) { await unlink(temp).catch(() => {}); throw e }
      }
      this.value = next
      return result
    })
    this.queue = operation
    return operation
  }
  async observe(session) {
    const path = session?.header?.cwd
    if (!path) return
    await this.ready
    const id = workspaceId(path)
    if (this.value.workspaces.some(w => w.workspace_id === id)) return
    await this.mutate(next => {
      if (!next.workspaces.some(w => w.workspace_id === id)) next.workspaces.push({ workspace_id: id, path: resolve(path), name: basename(resolve(path)), mode: 'off', group_id: '', discovered: true })
    })
  }
  async binding(session) {
    await this.observe(session)
    const data = await this.snapshot()
    const path = session?.header?.cwd
    const found = path && data.workspaces.find(w => w.workspace_id === workspaceId(path))
    if (!this.filename && !data.selectedOnly && !found) return null // in-memory legacy test/runtime compatibility
    if (!found || found.mode !== 'server' || found.discovered) return { mode: 'unselected' }
    if (found.session_selection === 'selected' && !found.session_ids?.includes(String(session.id))) return { mode: 'unselected' }
    return found
  }
  async prepare(payload) {
    if (payload.mode && !['server', 'pending'].includes(payload.mode)) throw new Error('请选择线上记忆组，或先保存为待绑定工作区')
    if (typeof payload.path !== 'string' || !isAbsolute(payload.path)) throw new Error('请选择 DSH 工作区，或填写绝对文件夹路径')
    if (!(await stat(payload.path)).isDirectory()) throw new Error('工作区路径必须是现有文件夹')
    const groupId = normalizeGroupId(payload.group_id)
    const mode = payload.mode === 'pending' || !groupId ? 'pending' : 'server'
    const item = { workspace_id: workspaceId(payload.path), path: resolve(payload.path), name: String(payload.name || basename(payload.path)).slice(0, 120),
      mode, group_id: mode === 'server' ? groupId : '', server_url: normalizeServerUrl(payload.server_url), discovered: false }
    if (payload.auto_joined === true) Object.assign(item, { auto_joined: true, credential_fingerprint: String(payload.credential_fingerprint || '') })
    if (payload.session_selection !== undefined) {
      if (!['all', 'selected'].includes(payload.session_selection)) throw new Error('请选择全部会话或指定会话')
      if (!Array.isArray(payload.session_ids) || payload.session_ids.some(x => typeof x !== 'string' || !x || x.length > 256)) throw new Error('无效的会话选择')
      item.session_selection = payload.session_selection
      item.session_ids = [...new Set(payload.session_ids)]
      if (item.session_selection === 'selected' && !item.session_ids.length) throw new Error('请至少选择一个会话')
      item.dsh_workspace_id = String(payload.dsh_workspace_id || '')
      item.workflow = 'server-selection-v1'
    }
    return item
  }
  async save(payload) {
    const item = await this.prepare(payload)
    return this.mutate(next => {
      const previous = next.workspaces.find(w => w.workspace_id === item.workspace_id)
      if (item.workflow) {
        // Removing/rejoining a workspace must not reuse a cached selection id.
        next.selection_revision = Math.max(next.selection_revision || 0, ...next.workspaces.map(w => w.selection_revision || 0)) + 1
        item.selection_revision = next.selection_revision; next.version = 2; next.selectedOnly = true
      }
      next.workspaces = next.workspaces.filter(w => w.workspace_id !== item.workspace_id)
      next.workspaces.push(item)
      next.auto_join_exclusions = (next.auto_join_exclusions || []).filter(id => id !== item.workspace_id)
      return item
    })
  }
  async remove(id) { return this.mutate(next => {
    next.workspaces = next.workspaces.filter(w => w.workspace_id !== id)
    next.auto_join_exclusions = [...new Set([...(next.auto_join_exclusions || []), id])]
  }) }
  async saveAutoJoin(settings) { return this.mutate(next => { next.auto_join = structuredClone(settings); return next.auto_join }) }
  async policy(selectedOnly) {
    if (selectedOnly !== true) throw new Error('仅处理用户已加入的工作区与会话')
    return this.mutate(next => { next.selectedOnly = selectedOnly })
  }
  async saveUpload(job) {
    return this.mutate(next => {
      next.history_uploads ??= []
      next.history_uploads = next.history_uploads.filter(x => x.id !== job.id)
      next.history_uploads.push(structuredClone(job))
      const completed = next.history_uploads.filter(x => x.status === 'succeeded')
      if (completed.length > 30) next.history_uploads = next.history_uploads.filter(x => !completed.slice(0, -30).some(old => old.id === x.id))
    })
  }
}

export async function localConnection(filename = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'memory-local/connection.json') : undefined) {
  if (!filename) throw new Error('DSH_HOME 未配置，无法定位本地 Memory 服务')
  let value
  try { value = JSON.parse(await readFile(filename, 'utf8')) }
  catch (e) { throw new Error('本地 Memory 服务尚未启动，请按使用说明运行本地服务') }
  const url = new URL(value.serverUrl)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !value.apiToken) throw new Error('Invalid local Memory connection')
  return { serverUrl: url.origin, apiToken: String(value.apiToken) }
}
