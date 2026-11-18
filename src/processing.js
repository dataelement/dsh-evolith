import { createHash } from 'node:crypto'
import { MemoryClient } from './memory-client.js'

const busy = status => ['queued', 'running', 'extracting', 'saving', 'judging'].includes(status)
const newestFirst = (a, b) => Number(busy(b.status)) - Number(busy(a.status)) || new Date(b.updated_at || 0) - new Date(a.updated_at || 0)

/** Reconstruct display names from selected local metadata, never conversation text.
 * Old /processing responses lack a session ID, but add-job details retain the
 * episode key. The selection ID uses the same formula as index.js's submission.
 */
export class ProcessingCatalog {
  constructor(runtime) { this.runtime = runtime; this.owner = ''; this.details = new Map() }

  async enrich(body, connection, selectedWorkspace = '') {
    const runtime = this.runtime
    const owner = createHash('sha256').update(JSON.stringify([connection.serverUrl, connection.apiToken])).digest('hex')
    if (owner !== this.owner) { this.owner = owner; this.details = new Map() }
    const cache = this.details
    const client = new MemoryClient({ ...runtime.config, ...connection }, runtime.client.fetchImpl)
    const registry = await runtime.workspaceStore.snapshot()
    const workspaces = runtime.catalog.workspaces()
    const bindings = registry.workspaces.filter(b => b.mode === 'server' && !b.discovered &&
      (!b.server_url || b.server_url === connection.serverUrl))
    const groups = new Set(bindings.filter(b => !selectedWorkspace || b.dsh_workspace_id === selectedWorkspace).map(b => b.group_id))
    const sources = new Map()
    for (const binding of bindings) {
      const workspace = workspaces.find(w => w.workspace_id === binding.workspace_id)
      if (!workspace) continue
      const scope = createHash('sha256').update(JSON.stringify([connection.serverUrl, binding.group_id])).digest('hex')
      for (const sessionId of workspace.session_ids) {
        if (binding.session_selection === 'selected' && !binding.session_ids?.includes(sessionId)) continue
        const source = { session_id: sessionId, workspace_id: workspace.workspace_id,
          dsh_workspace_id: workspace.dsh_workspace_id, workspace_name: workspace.name }
        const scoped = 'dsh-selection-' + createHash('sha256').update(scope + ':' + sessionId).digest('hex')
        sources.set(binding.group_id + ':' + scoped, source)
        sources.set(binding.group_id + ':' + sessionId, source)
      }
    }
    // The settings overview displays eight records. Resolve only that visible
    // group/workspace scope, so polling never fans out over the full job history.
    const jobs = (body.jobs || []).filter(j => groups.has(j.group_id)).sort(newestFirst).slice(0, 8)
    const local = new Map((runtime.snapshot?.().sessions || []).filter(s => s.processing?.job_id)
      .map(s => [s.processing.job_id, s]))
    const named = await Promise.all(jobs.map(async job => {
      const current = local.get(job.job_id)
      let source = current && sources.get(job.group_id + ':' + current.session_id)
      if (!source) {
        let detail = job
        if (!detail.episode_key && !detail.session_id && /^ma_[a-zA-Z0-9_-]+$/.test(job.job_id)) {
          if (!cache.has(job.job_id)) {
            const pending = client.request(runtime.config.addJobsPath + '/' + encodeURIComponent(job.job_id), undefined,
              { method: 'GET', timeoutMs: runtime.config.readTimeoutMs, quiet: true })
              .then(value => value?.job_id === job.job_id && value?.group_id === job.group_id ? value : undefined)
              .catch(() => undefined)
            cache.set(job.job_id, pending)
          }
          detail = await cache.get(job.job_id)
          if (!detail) cache.delete(job.job_id)
        }
        const sessionId = detail?.session_id || /^(.*):\d+:[a-f0-9]{12}:feedback$/.exec(detail?.episode_key || '')?.[1]
        source = sessionId && sources.get(job.group_id + ':' + sessionId)
      }
      return { ...job, ...(source || {}), source_resolved: Boolean(source) }
    }))
    const titles = new Map()
    await Promise.all([...new Set(named.map(j => j.dsh_workspace_id).filter(Boolean))].map(async id => {
      try {
        for (const session of (await runtime.catalog.sessions(id)).sessions) titles.set(session.session_id, session.title)
      } catch { /* A removed/unavailable title must not hide the job's result. */ }
    }))
    return { ...body, jobs: named.map(job => ({ ...job, session_title: titles.get(job.session_id),
      title: job.workspace_name || '组内历史记录（来源未识别）' })) }
  }
}
