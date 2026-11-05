import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const credentialFingerprint = value => createHash('sha256').update(value || '').digest('hex')
const secretField = /password|secret|authorization|cookie|api[_-]?key|api[_-]?token|master[_-]?key|credential|^(?:token|access[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?token)$/i
const safeFields = new Set(['credential_kind', 'credential_fingerprint', 'api_key_masked', 'key_id', 'apiTokenEnv'])
export function redactDiagnostic(value, secrets = []) {
  if (Array.isArray(value)) return value.map(x => redactDiagnostic(x, secrets))
  if (value && typeof value === 'object') {
    if (Array.isArray(value.loc) && value.loc.some(k => secretField.test(String(k)) && !safeFields.has(String(k))) && 'input' in value) value = { ...value, input: '[REDACTED]' }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, secretField.test(k) && !safeFields.has(k) ? '[REDACTED]' : redactDiagnostic(v, secrets)]))
  }
  if (typeof value !== 'string') return value
  for (const secret of secrets.filter(x => x && x.length >= 5)) value = value.split(secret).join('[REDACTED]')
  return value.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]').replace(/([?&](?:token|api_key|key|password)=)[^&#\s]+/gi, '$1[REDACTED]').replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]').replace(/((?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|password|authorization)["']?\s*[=:]\s*)(?:"[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s,"'{}]+)/gi, '$1[REDACTED]')
}
export function diagnoseError(error) {
  if (error?.retryExhausted) return { code: 'RETRY_EXHAUSTED', title: '自动重试次数已用完', retry_mode: 'blocked', retryable: false, suggestions: ['修正最新错误后，点击重试失败会话。'] }
  if (error?.body?.diagnosis) return error.body.diagnosis
  if (error?.diagnosis) return error.diagnosis
  const text = String(error?.message || error || '').toLowerCase(), status = error?.status
  const d = (code, title, suggestions, retry_mode = 'blocked') => ({ code, title, suggestions, retry_mode, retryable: ['scheduled', 'waiting_model'].includes(retry_mode) })
  if (/no openai-compatible model provider|model provider not configured|公司模型尚未配置/.test(text)) return d('MODEL_NOT_CONFIGURED', '记忆账号尚未配置模型', ['在记忆管理网页配置当前账号的提炼模型并测试连接。', '模型恢复后会自动继续待重试任务。'], 'waiting_model')
  if (/选择已修改|取消选择|已移出|连接已变化|密钥已变化|connection.*changed|settings changed/.test(text)) return d('SELECTION_CHANGED', '会话选择或连接已变化', ['检查当前账号、记忆组和会话选择，重新确认上传。'])
  if (/insufficient.balance|insufficient_quota|quota.exceeded|余额不足|payment.required/.test(text)) return d('MODEL_QUOTA_EXHAUSTED', '模型额度不足', ['检查模型余额和调用额度，恢复后手动重试。'])
  if (error?.retryExhausted) return d('RETRY_EXHAUSTED', '自动重试次数已用完', ['修正最新错误后，点击重试失败会话。'])
  if ([401, 403].includes(status) || /invalid.*key|unauthorized|invalid.*credential/.test(text)) return d('AUTH_OR_PERMISSION', '密钥或权限不正确', ['检查记忆访问密钥及模型密钥、余额和权限，修正后手动重试。'])
  if (status === 429 || /rate limit|too many requests/.test(text)) return d('RATE_LIMITED', '请求过于频繁', ['等待自动重试，避免重复点击上传。'], 'scheduled')
  if (/timeout|timed out|aborterror|超时/.test(text)) return d('TIMEOUT', '处理超时', ['查看服务器任务状态；系统会复用同一任务重试。'], 'scheduled')
  if (/json|malformed|invalid output|格式恢复失败/.test(text)) return d('MODEL_OUTPUT_INVALID', '模型返回格式不符合要求', ['管理员可在日志中查看模型输入、原始响应和解析错误。'], 'scheduled')
  if (/fetch failed|network|connect|econn|dns|unreachable/.test(text)) return d('NETWORK_UNAVAILABLE', '网络或服务暂时不可用', ['检查公司网络、代理及服务地址，连接恢复后自动重试。'], 'scheduled')
  if (status >= 500) return d('SERVICE_ERROR', '服务处理异常', ['等待自动重试；持续失败时提供请求编号给管理员。'], 'scheduled')
  return d(status === 404 ? 'RESOURCE_NOT_FOUND' : 'UNEXPECTED_ERROR', status === 404 ? '接口或资源不存在' : '处理出现异常', ['根据错误详情检查版本、配置和会话范围，再手动重试。'])
}

/** Errors and metadata persist locally. Exact processing inputs are logged server-side. */
export class DiagnosticOutbox {
  constructor({ filename = process.env.DSH_HOME ? join(process.env.DSH_HOME, 'memory-diagnostics-outbox.json') : undefined, connection, fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { filename, connection, fetchImpl })
    this.events = []; this.queue = Promise.resolve(); this.flushing = null; this.lastError = ''; this.nextFlushAt = 0
    this.ready = this.load().catch(error => { this.lastError = '本地日志文件不可写，原文件未改动：' + error.message; this.loadFailed = true })
  }
  async load() {
    if (!this.filename) return
    try {
      const value = JSON.parse(await readFile(this.filename, 'utf8'))
      if (!Array.isArray(value.events)) throw new Error('日志文件格式不正确')
      this.events = value.events
    } catch (error) {
      if (error.code !== 'ENOENT') {
        if (!(await stat(this.filename)).isFile()) throw new Error('日志路径不是普通文件')
        this.readError = '本地日志读取失败，原文件已保留：' + error.message
        await rename(this.filename, this.filename + '.unreadable-' + Date.now())
      }
    }
  }
  async persist() {
    if (!this.filename) return
    if (this.loadFailed) throw new Error('本地日志暂时无法保存，原文件未改动')
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    const temp = this.filename + '.' + randomUUID() + '.tmp'
    await writeFile(temp, JSON.stringify({ version: 1, events: this.events }), { mode: 0o600, flag: 'wx' }); await rename(temp, this.filename)
  }
  mutate(fn) {
    const operation = this.queue.catch(() => {}).then(async () => { await this.ready; const result = await fn(); await this.persist(); return result })
    this.queue = operation; return operation
  }
  log(event, fields = {}, details = {}, originalOwner) {
    const c = this.connection?.() || {}, owner = credentialFingerprint(c.apiToken)
    return this.mutate(() => {
      const item = redactDiagnostic({ id: 'cli_' + randomUUID().replaceAll('-', ''), event, occurred_at: new Date().toISOString(), ...fields,
        details: { plugin_version: '0.16.0', node_version: process.version, platform: process.platform, architecture: process.arch, ...details } }, [c.apiToken])
      this.events.push({ server_url: originalOwner?.server_url || c.serverUrl, credential_fingerprint: originalOwner?.credential_fingerprint || owner, event: item }); return item.id
    }).catch(error => { this.lastError = error.message })
  }
  async flush() {
    if (this.flushing) return this.flushing
    this.flushing = this.doFlush().finally(() => { this.flushing = null }); return this.flushing
  }
  async doFlush() {
    if (Date.now() < this.nextFlushAt) return
    await this.queue.catch(() => {}); await this.ready
    const c = this.connection?.() || {}; if (!c.apiToken || !c.serverUrl) return
    const fingerprint = credentialFingerprint(c.apiToken)
    const selected = []; let bytes = 0
    for (const item of this.events.filter(x => x.server_url === c.serverUrl && x.credential_fingerprint === fingerprint)) {
      const size = Buffer.byteLength(JSON.stringify(item.event), 'utf8')
      if (selected.length && (selected.length >= 100 || bytes + size > 4 * 1024 * 1024)) break
      selected.push(item); bytes += size
    }
    if (!selected.length) return
    try {
      const r = await this.fetchImpl(c.serverUrl + '/v1/diagnostics/batch', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.apiToken }, body: JSON.stringify({ events: selected.map(x => x.event) }) })
      if (!r.ok) { this.nextFlushAt = Date.now() + (r.status === 404 ? 300000 : 15000); throw new Error('诊断日志上传失败：HTTP ' + r.status) }
      const accepted = new Set((await r.json()).accepted || [])
      await this.mutate(() => { this.events = this.events.filter(x => !accepted.has(x.event.id)) }); this.lastError = ''
    } catch (error) { this.lastError = error.message }
  }
  status() { return { pending_events: this.events.length, last_error: this.lastError || this.readError || null } }
}
