import { isReadReceiptId, receiptIdFromText, stripReceiptMarkers } from './receipt-marker.js'
import { setTimeout as delay } from 'node:timers/promises'
import { randomUUID } from 'node:crypto'
import { diagnoseError, credentialFingerprint, redactDiagnostic } from './diagnostics.js'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function endpoint(serverUrl, path) {
  return `${serverUrl}${path}`
}

async function responseBody(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    const error = new Error(`memory server returned invalid JSON (${response.status})`)
    error.rawResponse = text; error.status = response.status; throw error
  }
}

export class MemoryServerRequestError extends Error {
  constructor(status, body) {
    const detail = JSON.stringify(body).slice(0, 1_000)
    super(`memory server request failed (${status}): ${detail}`)
    this.name = 'MemoryServerRequestError'
    this.status = status
    this.body = body
  }
}

/** HTTP client for the weak-supervision read/session/add boundary. */
export class MemoryClient {
  constructor(config, fetchImpl = globalThis.fetch, diagnostics) {
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('dsh-memory-bridge: a fetch implementation is required')
    }
    this.config = config
    this.fetchImpl = fetchImpl
    this.diagnostics = diagnostics
    this.serverUrlOverride = undefined
    this.apiTokenOverride = undefined
    this.ensuredGroups = new Set()
    this.groupPromises = new Map()
    this.groupCreationUnsupported = false
    this.configurationVersion = 0
  }

  setApiToken(value) {
    const token = String(value ?? '').trim()
    this.apiTokenOverride = token || undefined
    this.configurationVersion += 1
    this.ensuredGroups.clear()
    this.groupPromises.clear()
    this.groupCreationUnsupported = false
  }

  setServerUrl(value) {
    const serverUrl = String(value ?? '').trim().replace(/\/$/, '')
    this.serverUrlOverride = serverUrl || undefined
    this.configurationVersion += 1
    this.ensuredGroups.clear()
    this.groupPromises.clear()
    this.groupCreationUnsupported = false
  }

  serverUrl() {
    return this.serverUrlOverride ?? this.config.serverUrl
  }

  apiToken() {
    return this.apiTokenOverride ?? this.config.apiToken ?? process.env[this.config.apiTokenEnv]
  }

  async request(path, payload, { timeoutMs, signal, method = 'POST', diagnosticContext = {}, quiet = false } = {}) {
    const requestId = 'req_' + randomUUID().replaceAll('-', ''), started = Date.now()
    const context = { ...diagnosticContext, request_id: requestId, stage: path.includes('weak-supervise') ? 'feedback' : path.includes('/read') ? 'read' : path.includes('/add') ? 'extraction' : 'http' }
    const controller = new AbortController()
    const abortFromParent = () => controller.abort(signal.reason)
    if (signal?.aborted) abortFromParent()
    else signal?.addEventListener('abort', abortFromParent, { once: true })

    const timeout = setTimeout(() => {
      controller.abort(new Error(`memory server request timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timeout.unref?.()

    const token = this.apiToken()
    const owner = { server_url: this.serverUrl(), credential_fingerprint: credentialFingerprint(token) }
    try {
      const response = await this.fetchImpl(endpoint(this.serverUrl(), path), {
        method,
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-dsh-request-id': requestId,
          'x-dsh-operation-id': diagnosticContext.operation_id || requestId,
          'x-dsh-plugin-version': '0.16.1',
          ...(diagnosticContext.manual_retry ? { 'x-dsh-retry-mode': 'manual' } : {}),
          ...Object.fromEntries(['session_id', 'workspace_id', 'group_id'].filter(k => diagnosticContext[k]).map(k => ['x-dsh-' + k.replaceAll('_', '-'), String(diagnosticContext[k])])),
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
        signal: controller.signal
      })
      const body = await responseBody(response)
      if (!response.ok) {
        const error = new MemoryServerRequestError(response.status, body); error.requestId = response.headers?.get?.('x-dsh-request-id') || requestId; throw error
      }
      if (!quiet) await this.diagnostics?.log('request.completed', { ...context, status: 'succeeded' }, { path, method, http_status: response.status, duration_ms: Date.now() - started }, owner)
      return body
    } catch (error) {
      error.requestId ||= requestId
      if (!quiet) await this.diagnostics?.log('request.failed', { ...context, status: 'failed', level: 'error' }, redactDiagnostic({ path, method, http_status: error.status, duration_ms: Date.now() - started, input: payload, response: error.body || error.rawResponse, error: error.message, stack: error.stack, diagnosis: diagnoseError(error) }, [token]), owner)
      throw error
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromParent)
    }
  }

  async ensureGroup({ groupId, signal }) {
    if (!groupId) throw new TypeError('memory group creation requires groupId')
    if (!this.config.autoCreateGroups || this.groupCreationUnsupported) return
    if (this.ensuredGroups.has(groupId)) return
    if (this.groupPromises.has(groupId)) return this.groupPromises.get(groupId)

    const configurationVersion = this.configurationVersion
    const operation = this.request(
      this.config.groupsPath,
      { group_id: groupId },
      { timeoutMs: this.config.readTimeoutMs, signal }
    ).catch((error) => {
      if (configurationVersion !== this.configurationVersion) {
        throw new Error('Memory settings changed during group creation; stale response was discarded')
      }
      if (error instanceof MemoryServerRequestError && error.status === 409) return
      if (error instanceof MemoryServerRequestError && (error.status === 404 || error.status === 405)) {
        if (this.apiToken()) {
          throw new Error('This Memory server does not offer account group creation; verify the account-aware server URL')
        }
        // Legacy servers do not expose group creation. Their read endpoint
        // creates or resolves the group using the historical behavior.
        this.groupCreationUnsupported = true
        return
      }
      throw error
    }).then(() => {
      if (configurationVersion === this.configurationVersion) this.ensuredGroups.add(groupId)
    }).finally(() => {
      if (this.groupPromises.get(groupId) === operation) this.groupPromises.delete(groupId)
    })
    this.groupPromises.set(groupId, operation)
    return operation
  }

  async read({ groupId, query, signal, diagnosticContext }) {
    if (!groupId) throw new TypeError('memory read requires groupId')
    const configurationVersion = this.configurationVersion
    await this.ensureGroup({ groupId, signal })
    if (configurationVersion !== this.configurationVersion) {
      throw new Error('Memory settings changed during group creation; retry the request')
    }
    const body = await this.request(
      this.config.readPath,
      { group_id: groupId, query },
      { timeoutMs: this.config.readTimeoutMs, signal, diagnosticContext }
    )
    if (!isRecord(body)) throw new Error('memory read response must be an object')
    if (typeof body.memory_text !== 'string') {
      throw new Error('memory read response must contain memory_text')
    }
    if (configurationVersion !== this.configurationVersion) {
      throw new Error('Memory settings changed during read; stale Memory was discarded')
    }
    return {
      memoryText: stripReceiptMarkers(body.memory_text).slice(0, this.config.maxMemoryChars),
      selectedMemoryIds: Array.isArray(body.selected_memory_ids)
        ? body.selected_memory_ids.map(String)
        : Array.isArray(body.selected_claim_ids)
          ? body.selected_claim_ids.map(String)
        : [],
      readReceiptId: isReadReceiptId(body.read_receipt_id)
        ? body.read_receipt_id
        : receiptIdFromText(body.memory_text),
      receipt: isRecord(body.receipt) ? body.receipt : {}
    }
  }

  async weakSupervise({ session, signal, diagnosticContext }) {
    const body = await this.request(
      this.config.supervisePath,
      session,
      { timeoutMs: this.config.superviseTimeoutMs, signal, diagnosticContext }
    )
    if (!isRecord(body) || !Array.isArray(body.rewarded_traces)) {
      throw new Error('weak-supervision response must contain rewarded_traces')
    }
    return body
  }

  async addTrace({ groupId, trace, signal, onProgress, diagnosticContext }) {
    if (!groupId) throw new TypeError('memory add requires groupId')
    const configurationVersion = this.configurationVersion
    const deadline = Date.now() + this.config.addTimeoutMs
    const remaining = () => {
      if (configurationVersion !== this.configurationVersion) {
        throw new Error('Memory settings changed during add; retry with the current settings')
      }
      const value = deadline - Date.now()
      if (value <= 0) throw new Error(`Memory add did not complete within ${this.config.addTimeoutMs}ms`)
      return value
    }
    let body = await this.request(
      this.config.addPath,
      { group_id: groupId, trace },
      { timeoutMs: remaining(), signal, diagnosticContext }
    )
    remaining()
    // Old services finish synchronously. New services acknowledge a durable
    // job first; acknowledgement alone is not a completed Memory write.
    if (!isRecord(body) || !body.job_id) return body
    const jobId = String(body.job_id)
    if (!/^ma_[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error('Memory add returned an invalid job id')
    const report = () => onProgress?.({ job_id: jobId, status: body.status, created_at: body.created_at, started_at: body.started_at, updated_at: body.updated_at, error: body.error, retry: body.retry, diagnosis: body.diagnosis, request_id: body.request_id })
    report()
    while (body.status === 'queued' || body.status === 'running' || body.status === 'failed' && ['scheduled', 'queued'].includes(body.retry?.state)) {
      await delay(Math.min(this.config.addPollIntervalMs, remaining()), undefined, { signal })
      body = await this.request(
        `${this.config.addJobsPath}/${encodeURIComponent(jobId)}`,
        undefined,
        { timeoutMs: remaining(), signal, method: 'GET', diagnosticContext, quiet: true }
      )
      remaining()
      if (!isRecord(body) || body.job_id !== jobId) throw new Error('Memory add job response did not match the submitted job')
      report()
    }
    if (body.status === 'failed') {
      const error = new Error(`Memory add job failed: ${String(body.error || 'unknown Writer error').slice(0, 1000)}`)
      error.diagnosis = body.retry?.state === 'exhausted' ? { code: 'RETRY_EXHAUSTED', title: '自动重试次数已用完', retry_mode: 'blocked', suggestions: ['查看最新错误并修正后手动重试。'] } : body.diagnosis
      error.retryExhausted = body.retry?.state === 'exhausted'; throw error
    }
    if (body.status !== 'succeeded' || !isRecord(body.result)) throw new Error('Memory add job did not return a completed result')
    return body.result
  }
}
