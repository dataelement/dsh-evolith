import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export function defaultGroupConfigPath(env = process.env) {
  const dshHome = String(env.DSH_HOME ?? '').trim()
  return dshHome ? join(dshHome, 'memory-bridge.json') : undefined
}

export function normalizeGroupId(value) {
  const groupId = String(value ?? '').trim()
  if (groupId.length > 256 || /[\u0000-\u001f\u007f]/.test(groupId)) {
    throw new TypeError('group_id must be at most 256 printable characters')
  }
  return groupId
}

export function normalizeApiToken(value) {
  const apiToken = String(value ?? '').trim()
  if (apiToken.length > 8_192 || /[\u0000-\u001f\u007f]/.test(apiToken)) {
    throw new TypeError('Memory API Key must be at most 8192 printable characters')
  }
  return apiToken
}

export function normalizeServerUrl(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error()
    parsed.pathname = parsed.pathname.replace(/\/$/, '')
    return parsed.toString().replace(/\/$/, '')
  } catch {
    throw new TypeError('Memory Server URL must be an http(s) origin or base URL')
  }
}

export class GroupConfigStore {
  constructor(filename = defaultGroupConfigPath()) {
    this.filename = filename
    this.writePromise = Promise.resolve()
  }

  get persistent() {
    return Boolean(this.filename)
  }

  async loadConfig() {
    if (!this.filename) return { groupId: '', apiToken: '', serverUrl: '' }
    try {
      const parsed = JSON.parse(await readFile(this.filename, 'utf8'))
      return {
        groupId: normalizeGroupId(parsed?.groupId),
        apiToken: normalizeApiToken(parsed?.apiToken),
        serverUrl: normalizeServerUrl(parsed?.serverUrl)
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return { groupId: '', apiToken: '', serverUrl: '' }
      throw error
    }
  }

  async load() {
    return (await this.loadConfig()).groupId
  }

  async saveConfig(patch = {}) {
    if (!this.filename) {
      throw new Error('DSH_HOME is unavailable; Memory settings cannot be persisted')
    }
    const operation = this.writePromise.catch(() => undefined).then(async () => {
      const current = await this.loadConfig()
      const next = {
        groupId: patch.groupId === undefined
          ? current.groupId
          : normalizeGroupId(patch.groupId),
        apiToken: patch.apiToken === undefined
          ? current.apiToken
          : normalizeApiToken(patch.apiToken),
        serverUrl: patch.serverUrl === undefined
          ? current.serverUrl
          : normalizeServerUrl(patch.serverUrl)
      }
      const payload = { groupId: next.groupId }
      if (next.apiToken) payload.apiToken = next.apiToken
      if (next.serverUrl) payload.serverUrl = next.serverUrl

      const directory = dirname(this.filename)
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const temporary = `${this.filename}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx'
        })
        await rename(temporary, this.filename)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        throw error
      }
      return next
    })
    this.writePromise = operation
    return operation
  }

  async save(value) {
    return (await this.saveConfig({ groupId: value })).groupId
  }

  async saveApiToken(value) {
    return (await this.saveConfig({ apiToken: value })).apiToken
  }

  async saveServerUrl(value) {
    return (await this.saveConfig({ serverUrl: value })).serverUrl
  }
}
