import { randomUUID } from 'node:crypto'

/** Durable metadata only. Original messages remain in the DSH session store. */
export class HistoryUploads {
  constructor({ store, catalog, sync, validate }) {
    Object.assign(this, { store, catalog, sync, validate })
    this.queue = Promise.resolve()
  }
  async start(binding, sessionIds) {
    const job = { id: 'hu_' + randomUUID().replaceAll('-', ''), workspace_id: binding.workspace_id, dsh_workspace_id: binding.dsh_workspace_id, selection_revision: binding.selection_revision, group_id: binding.group_id, server_url: binding.server_url,
      credential_fingerprint: binding.credential_fingerprint, status: 'queued', created_at: Date.now(), updated_at: Date.now(), total: sessionIds.length, completed: 0, failed: 0, new_memory_count: 0,
      sessions: sessionIds.map(session_id => ({ session_id, status: 'queued' })) }
    await this.store.saveUpload(job)
    this.enqueue(job)
    return job
  }
  enqueue(job) { this.queue = this.queue.catch(() => {}).then(() => this.run(job)).catch(async error => { job.status = 'failed'; job.error = error.message; await this.save(job) }) }
  async save(job) { job.updated_at = Date.now(); await this.store.saveUpload(job) }
  async resume() {
    for (const job of (await this.store.snapshot()).history_uploads || []) if (['queued', 'running'].includes(job.status)) this.enqueue(job)
  }
  async run(job) {
    job.status = 'running'; await this.save(job)
    for (const item of job.sessions) {
      if (['succeeded', 'empty', 'failed'].includes(item.status)) continue
      await this.validate(job, item.session_id)
      item.status = 'running'; await this.save(job)
      try {
        const session = await this.catalog.read(job.dsh_workspace_id, item.session_id)
        if (!session.snapshotEvents().length) item.status = 'empty'
        else {
          const result = await this.sync({ session, history: true, expected: job })
          item.new_memory_count = result.new_memory_count || 0
          job.new_memory_count += item.new_memory_count
          if (!result.ok) throw new Error(result.error || '同步失败，可重新提交；已有条目会去重')
          item.status = 'succeeded'
        }
      } catch (error) { item.status = 'failed'; item.error = error.message; job.failed++ }
      job.completed++; await this.save(job)
    }
    job.status = job.failed ? 'partial_failed' : 'succeeded'; await this.save(job)
  }
}
