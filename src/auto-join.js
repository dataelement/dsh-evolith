import { createHash } from 'node:crypto'
import { normalizeGroupId } from './group-config.js'
import { managementRequest } from './workbench-api.js'

const fingerprint = token => createHash('sha256').update(token || '').digest('hex')

/** Only the native DSH catalog supplies eligible workspaces and session IDs. */
export class WorkspaceAutoJoin {
  constructor({ store, catalog, client, uploads, request = managementRequest }) {
    Object.assign(this, { store, catalog, client, uploads, request })
    this.locks = new Map(); this.settingsQueue = Promise.resolve(); this.scanPromise = null
    this.lastError = ''; this.lastScanAt = null
  }
  connection() { return { serverUrl: this.client.serverUrl(), apiToken: this.client.apiToken() } }
  matches(settings) { const c = this.connection(); return !!c.apiToken && c.serverUrl === settings.server_url && fingerprint(c.apiToken) === settings.credential_fingerprint }
  exclusive(id, fn) {
    const operation = (this.locks.get(id) || Promise.resolve()).catch(() => {}).then(fn)
    this.locks.set(id, operation)
    void operation.finally(() => { if (this.locks.get(id) === operation) this.locks.delete(id) }).catch(() => {})
    return operation
  }
  async status() {
    const saved = await this.store.snapshot(), settings = saved.auto_join || { enabled: false, group_id: '' }
    const paused = settings.enabled && !this.matches(settings)
    return { enabled: !!settings.enabled, group_id: settings.group_id || '',
      status: !settings.enabled ? 'disabled' : paused ? 'paused' : this.scanPromise ? 'running' : this.lastError ? 'failed' : 'ready',
      message: paused ? '连接或密钥已变化，请重新保存自动加入设置' : this.lastError,
      joined_count: saved.workspaces.filter(w => w.auto_joined).length,
      excluded_count: (saved.auto_join_exclusions || []).length, last_scan_at: this.lastScanAt }
  }
  configure(payload) {
    const operation = this.settingsQueue.catch(() => {}).then(async () => {
      if (typeof payload.enabled !== 'boolean') throw new Error('请选择是否启用自动加入')
      const group = normalizeGroupId(String(payload.group_id || '').trim())
      if (group && !/^[a-z0-9][a-z0-9._:-]{2,127}$/.test(group)) throw new Error('默认记忆组编号不支持中文，请使用 3–128 位小写英文字母、数字或 . _ : -')
      const c = this.connection()
      if (payload.enabled) {
        if (!group) throw new Error('请先选择默认记忆组')
        if (!c.apiToken) throw new Error('请先保存访问密钥')
        const { body } = await this.request(c, 'info')
        if (!['groups:manage','memory:read','memory:write','sessions:supervise'].every(s => body.scopes?.includes(s))) {
          const error = new Error('当前密钥权限不足，自动加入需要记忆管理、读写和反馈处理权限'); error.status = 403; throw error
        }
        await this.client.ensureGroup({ groupId: group })
      }
      await this.store.saveAutoJoin({ enabled: payload.enabled, group_id: group,
        server_url: c.serverUrl, credential_fingerprint: fingerprint(c.apiToken) })
      this.lastError = ''
      if (payload.enabled) void this.scan().catch(error => { this.lastError = error.message })
      return this.status()
    })
    this.settingsQueue = operation
    return operation
  }
  async ensureWorkspace(workspace) {
    return this.exclusive(workspace.workspace_id, async () => {
      const saved = await this.store.snapshot(), settings = saved.auto_join
      if (!settings?.enabled || !this.matches(settings) || (saved.auto_join_exclusions || []).includes(workspace.workspace_id)) return
      // Re-read native membership inside the lock. A removed workspace is
      // never resurrected from an old folder path or a stale poll snapshot.
      const w = this.catalog.workspace(workspace.dsh_workspace_id)
      const existing = saved.workspaces.find(item => item.workspace_id === w.workspace_id)
      if (existing && !existing.discovered) return existing
      const c = this.connection(), credential_fingerprint = fingerprint(c.apiToken)
      const input = { path: w.path, name: w.name, mode: 'server', group_id: settings.group_id,
        server_url: c.serverUrl, dsh_workspace_id: w.dsh_workspace_id,
        session_selection: 'all', session_ids: w.session_ids, auto_joined: true, credential_fingerprint }
      const prepared = await this.store.prepare(input)
      await this.client.ensureGroup({ groupId: settings.group_id })
      if (!this.matches(settings)) return
      await this.request(c, 'workspaces', 'PUT', { workspace_id: prepared.workspace_id, name: prepared.name, path_hint: '', group_id: prepared.group_id })
      if (!this.matches(settings)) {
        await this.request(c, 'workspaces/' + encodeURIComponent(prepared.workspace_id) + '?delete_memory=false', 'DELETE')
        return
      }
      const binding = await this.store.save(input)
      await this.uploads.start({ ...binding, credential_fingerprint }, [...new Set(w.session_ids)])
      return binding
    })
  }
  async ensureSession(session) {
    const settings = (await this.store.snapshot()).auto_join
    if (!settings?.enabled || !this.matches(settings)) return
    try {
      const workspace = this.catalog.workspaces().find(w => w.session_ids.includes(String(session.id)))
      if (workspace) return await this.ensureWorkspace(workspace)
    } catch (error) { this.lastError = error.message }
  }
  scan() {
    if (this.scanPromise) return this.scanPromise
    const operation = Promise.resolve().then(async () => {
      const settings = (await this.store.snapshot()).auto_join
      if (!settings?.enabled || !this.matches(settings)) return
      this.lastError = ''
      for (const workspace of this.catalog.workspaces()) {
        try { await this.ensureWorkspace(workspace) } catch (error) { this.lastError = error.message }
      }
      this.lastScanAt = Date.now()
    })
    this.scanPromise = operation
    void operation.finally(() => { if (this.scanPromise === operation) this.scanPromise = null }).catch(() => {})
    return operation
  }
}
