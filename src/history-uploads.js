import { randomUUID } from 'node:crypto'
import { diagnoseError, credentialFingerprint } from './diagnostics.js'

const RETRY_DELAYS = [5000, 15000, 45000, 120000, 300000]
const done = item => ['succeeded', 'empty'].includes(item.status)

/** Only job metadata persists here. Original conversations remain in DSH. */
export class HistoryUploads {
  constructor({ store, catalog, sync, validate, diagnostics, modelReady, connection, retryDelays = RETRY_DELAYS, clock = Date.now }) {
    Object.assign(this, { store, catalog, sync, validate, diagnostics, modelReady, connection, retryDelays, clock })
    this.queue = Promise.resolve(); this.inFlight = new Set(); this.scanning = null; this.mutations = Promise.resolve()
  }
  log(event, job, item, details = {}) {
    return this.diagnostics?.log(event, { stage: 'history', status: item?.status || job.status,
      operation_id: job.id, job_id: job.id, group_id: job.group_id, workspace_id: job.workspace_id,
      session_id: item?.session_id, attempt: item?.attempts || 0 },
      { workspace_name: job.workspace_name || job.name, workspace_path: job.workspace_path || job.path, dsh_workspace_id: job.dsh_workspace_id, ...details }, job)
  }
  async start(binding, sessionIds) {
    const job = { id: 'hu_' + randomUUID().replaceAll('-', ''), workspace_id: binding.workspace_id, dsh_workspace_id: binding.dsh_workspace_id,
      workspace_name: binding.name, workspace_path: binding.path,
      selection_revision: binding.selection_revision, group_id: binding.group_id, server_url: binding.server_url,
      credential_fingerprint: binding.credential_fingerprint, status: 'queued', created_at: this.clock(), updated_at: this.clock(),
      total: sessionIds.length, completed: 0, failed: 0, new_memory_count: 0,
      sessions: sessionIds.map(session_id => ({ session_id, status: 'queued', attempts: 0, automatic_retries: 0 })) }
    await this.store.saveUpload(job); await this.log('history.created', job, null, { selected_session_ids: sessionIds, selection_revision: job.selection_revision })
    this.enqueue(job); return job
  }
  enqueue(job) {
    if (this.inFlight.has(job.id)) return
    this.inFlight.add(job.id)
    this.queue = this.queue.catch(() => {}).then(() => this.run(job)).catch(async error => {
      job.status = 'failed'; job.error = error.message; job.diagnosis = diagnoseError(error)
      for (const item of job.sessions.filter(i => ['queued', 'running'].includes(i.status))) {
        Object.assign(item, { status: 'failed', error: error.message, diagnosis: job.diagnosis, retry_state: 'blocked' })
      }
      this.recount(job)
      await this.save(job); await this.log('history.aborted', job, null, { error: error.message, stack: error.stack, diagnosis: job.diagnosis })
    }).finally(() => this.inFlight.delete(job.id))
  }
  async save(job) { job.updated_at = this.clock(); await this.store.saveUpload(job) }
  async resume() {
    for (const job of (await this.store.snapshot()).history_uploads || []) {
      let changed = false
      for (const item of job.sessions.filter(i => i.status === 'failed' && !i.retry_state)) {
        item.diagnosis = diagnoseError(new Error(item.error || job.error || '同步失败'))
        item.retry_state = item.diagnosis.retry_mode; item.automatic_retries ||= 0
        if (item.retry_state === 'scheduled') item.next_retry_at = this.clock() + this.retryDelays[0]
        changed = true
      }
      if (changed) await this.save(job)
      if (['queued', 'running'].includes(job.status)) this.enqueue(job)
    }
  }
  recount(job) {
    job.total = job.sessions.length
    job.completed = job.sessions.filter(i => done(i) || i.status === 'failed').length
    job.failed = job.sessions.filter(i => i.status === 'failed').length
    job.new_memory_count = job.sessions.reduce((n, i) => n + (i.new_memory_count || 0), 0)
  }
  async run(job) {
    job.status = 'running'; delete job.error; delete job.diagnosis; await this.save(job)
    for (const item of job.sessions) {
      if (done(item) || item.status === 'failed') continue
      await this.validate(job, item.session_id)
      item.status = 'running'; item.attempts = (item.attempts || 0) + 1; item.started_at = this.clock(); delete item.next_retry_at
      await this.save(job); await this.log('history.session.started', job, item)
      try {
        const session = await this.catalog.read(job.dsh_workspace_id, item.session_id)
        if (!session.snapshotEvents().length) item.status = 'empty'
        else {
          const result = await this.sync({ session, history: true, expected: job, diagnosticContext: { operation_id: job.id, attempt: item.attempts, manual_retry: !!item.manual_retry } })
          item.new_memory_count = (item.new_memory_count || 0) + (result.new_memory_count || 0)
          if (!result.ok) { const error = new Error(result.error || '同步失败'); error.diagnosis = result.diagnosis; throw error }
          item.status = 'succeeded'
        }
        delete item.error; delete item.diagnosis; delete item.retry_state; item.completed_at = this.clock()
        await this.log('history.session.completed', job, item, { new_memory_count: item.new_memory_count || 0 })
      } catch (error) {
        item.status = 'failed'; item.error = error.message; item.diagnosis = diagnoseError(error); item.retry_state = item.diagnosis.retry_mode
        if (item.retry_state === 'scheduled') {
          const count = item.automatic_retries || 0
          if (count >= this.retryDelays.length) item.retry_state = 'exhausted'
          else item.next_retry_at = this.clock() + this.retryDelays[count]
        }
        await this.log('history.session.failed', job, item, { error: item.error, stack: error.stack, diagnosis: item.diagnosis,
          retry_state: item.retry_state, next_retry_at: item.next_retry_at, automatic_retries: item.automatic_retries || 0 })
      }
      this.recount(job); await this.save(job)
    }
    this.recount(job); job.status = job.failed ? 'partial_failed' : 'succeeded'; await this.save(job)
    await this.log('history.completed', job, null, { total: job.total, failed: job.failed, new_memory_count: job.new_memory_count })
  }
  exclusive(fn) { const p = this.mutations.catch(() => {}).then(fn); this.mutations = p; return p }
  retry(id, { automatic = false, modelConfigured = false } = {}) {
    return this.exclusive(async () => {
      const job = ((await this.store.snapshot()).history_uploads || []).find(j => j.id === id)
      if (!job) throw new Error('历史任务不存在')
      if (this.inFlight.has(id) || ['queued', 'running'].includes(job.status)) return job
      const candidates = job.sessions.filter(i => i.status === 'failed' && i.retry_state !== 'recovered_elsewhere' && (!automatic ||
        i.retry_state === 'waiting_model' && modelConfigured || i.retry_state === 'scheduled' && i.next_retry_at <= this.clock()))
      for (const item of candidates) await this.validate(job, item.session_id)
      if (!candidates.length) return job
      for (const item of candidates) {
        item.status = 'queued'; item.automatic_retries = automatic ? (item.automatic_retries || 0) + (item.retry_state === 'scheduled' ? 1 : 0) : 0
        item.manual_retry = !automatic
        item.retry_requested_at = this.clock(); delete item.next_retry_at
        await this.log(automatic ? 'retry.automatic' : 'retry.manual', job, item, { prior_error: item.error, diagnosis: item.diagnosis })
      }
      this.recount(job); job.status = 'queued'; await this.save(job); this.enqueue(job); return job
    })
  }
  async retryAll() {
    const jobs = (await this.store.snapshot()).history_uploads || [], result = { retried: [], blocked: [] }
    for (const job of jobs.filter(j => j.failed || j.status === 'failed')) {
      try { const value = await this.retry(job.id); if (['queued', 'running'].includes(value.status)) result.retried.push(job.id) }
      catch (error) { result.blocked.push({ job_id: job.id, error: error.message, diagnosis: diagnoseError(error) }) }
    }
    return result
  }
  trackFailure(binding, sessionId, result) {
    return this.exclusive(async () => {
      const jobs = (await this.store.snapshot()).history_uploads || []
      let job = jobs.find(j => j.workspace_id === binding.workspace_id && j.selection_revision === binding.selection_revision &&
        j.credential_fingerprint === binding.credential_fingerprint && j.sessions.some(i => i.session_id === sessionId && i.status === 'failed' && i.retry_state !== 'recovered_elsewhere'))
      if (!job) {
        job = { id: 'hu_' + randomUUID().replaceAll('-', ''), ...binding, status: 'partial_failed', origin: 'live',
          created_at: this.clock(), updated_at: this.clock(), total: 1, completed: 1, failed: 1, new_memory_count: 0,
          sessions: [{ session_id: sessionId, status: 'failed', attempts: 0, automatic_retries: 0 }] }
      }
      const item = job.sessions.find(i => i.session_id === sessionId)
      item.attempts = (item.attempts || 0) + 1; item.error = result.error
      item.diagnosis = result.diagnosis || diagnoseError(new Error(result.error)); item.retry_state = item.diagnosis.retry_mode
      if (item.retry_state === 'scheduled') {
        if ((item.automatic_retries || 0) >= this.retryDelays.length) item.retry_state = 'exhausted'
        else item.next_retry_at = this.clock() + this.retryDelays[item.automatic_retries || 0]
      }
      await this.save(job); await this.log('live.retry.recorded', job, item, { diagnosis: item.diagnosis, error: item.error })
      return job
    })
  }
  recoveredElsewhere(sessionId, binding) {
    return this.exclusive(async () => {
      if (!binding) return
      for (const job of (await this.store.snapshot()).history_uploads || []) {
        if (this.inFlight.has(job.id) || ['workspace_id', 'group_id', 'selection_revision', 'server_url', 'credential_fingerprint'].some(k => job[k] !== binding[k])) continue
        const items = job.sessions.filter(i => i.session_id === sessionId && i.status === 'failed' && i.retry_state !== 'recovered_elsewhere')
        for (const item of items) { item.retry_state = 'recovered_elsewhere'; item.recovered_at = this.clock() }
        if (items.length) { await this.save(job); await this.log('retry.recovered_by_later_sync', job, items[0]) }
      }
    })
  }
  async tick() {
    if (this.scanning) return this.scanning
    const work = async () => {
      const connection = this.connection?.()
      const jobs = ((await this.store.snapshot()).history_uploads || []).filter(j => !this.inFlight.has(j.id) &&
        (!connection || j.server_url === connection.serverUrl && j.credential_fingerprint === credentialFingerprint(connection.apiToken)) &&
        j.sessions.some(i => i.status === 'failed' && ['waiting_model', 'scheduled'].includes(i.retry_state)))
      let configured = false
      if (jobs.some(j => j.sessions.some(i => i.retry_state === 'waiting_model'))) {
        try { configured = !!(await this.modelReady?.()) } catch { /* Recheck later without uploading conversations. */ }
      }
      for (const job of jobs) {
        try { await this.retry(job.id, { automatic: true, modelConfigured: configured }) }
        catch (error) {
          for (const item of job.sessions.filter(i => i.status === 'failed')) { item.retry_state = 'blocked'; item.diagnosis = diagnoseError(error) }
          job.error = error.message; await this.save(job); await this.log('retry.blocked', job, null, { diagnosis: diagnoseError(error), error: error.message })
        }
      }
    }
    this.scanning = work().finally(() => { this.scanning = null }); return this.scanning
  }
}
