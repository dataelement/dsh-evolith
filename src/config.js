import { createHash } from 'node:crypto'

const DEFAULTS = Object.freeze({
  enabled: true,
  serverUrl: 'http://192.168.106.20:28192',
  groupsPath: '/v1/memory/groups',
  readPath: '/v1/memory/read',
  supervisePath: '/v1/sessions/weak-supervise',
  addPath: '/v1/memory/add',
  addJobsPath: '/v1/memory/add-jobs',
  readTimeoutMs: 2_000,
  superviseTimeoutMs: 120_000,
  addTimeoutMs: 600_000,
  addPollIntervalMs: 5_000,
  maxMemoryChars: 12_000,
  maxMessageChars: 50_000,
  maxPendingTracesPerSession: 50,
  username: 'dsh-user',
  apiTokenEnv: 'DSH_MEMORY_API_TOKEN',
  autoCreateGroups: true,
  scopeNamespace: 'dsh'
})

function optionalGroupId(value, name) {
  if (value === undefined || value === null) return undefined
  const resolved = String(value).trim()
  if (!resolved) return undefined
  if (resolved.length > 256 || /[\u0000-\u001f\u007f]/.test(resolved)) {
    throw new TypeError(`dsh-memory-bridge: ${name} must be at most 256 printable characters`)
  }
  return resolved
}

function positiveInteger(value, fallback, name) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`dsh-memory-bridge: ${name} must be a positive integer`)
  }
  return resolved
}

function endpointPath(value, fallback, name) {
  const resolved = value === undefined ? fallback : String(value).trim()
  if (!resolved.startsWith('/') || resolved.includes('://')) {
    throw new TypeError(`dsh-memory-bridge: ${name} must be an absolute HTTP path`)
  }
  return resolved
}

/** Validate and freeze the deployment configuration once at plugin load. */
export function normalizeConfig(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('dsh-memory-bridge: config must be an object')
  }

  const enabled = input.enabled === undefined ? DEFAULTS.enabled : input.enabled
  if (typeof enabled !== 'boolean') {
    throw new TypeError('dsh-memory-bridge: enabled must be boolean')
  }

  const rawServerUrl = String(input.serverUrl ?? DEFAULTS.serverUrl).trim()
  let serverUrl
  try {
    const parsed = new URL(rawServerUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
    parsed.pathname = parsed.pathname.replace(/\/$/, '')
    serverUrl = parsed.toString().replace(/\/$/, '')
  } catch {
    throw new TypeError('dsh-memory-bridge: serverUrl must be an http(s) URL')
  }

  const apiToken = input.apiToken === undefined ? undefined : String(input.apiToken)
  const apiTokenEnv = String(input.apiTokenEnv ?? DEFAULTS.apiTokenEnv).trim()
  if (!apiTokenEnv) {
    throw new TypeError('dsh-memory-bridge: apiTokenEnv must not be empty')
  }
  const autoCreateGroups = input.autoCreateGroups === undefined
    ? DEFAULTS.autoCreateGroups
    : input.autoCreateGroups
  if (typeof autoCreateGroups !== 'boolean') {
    throw new TypeError('dsh-memory-bridge: autoCreateGroups must be boolean')
  }

  const groupId = optionalGroupId(input.groupId ?? input.scopeId, 'groupId')
  if (input.groupId !== undefined && input.scopeId !== undefined) {
    const legacyGroupId = optionalGroupId(input.scopeId, 'scopeId')
    if (groupId !== legacyGroupId) {
      throw new TypeError('dsh-memory-bridge: groupId and legacy scopeId must match')
    }
  }
  const scopeNamespace = String(input.scopeNamespace ?? DEFAULTS.scopeNamespace).trim()
  if (!scopeNamespace) {
    throw new TypeError('dsh-memory-bridge: scopeNamespace must not be empty')
  }

  return Object.freeze({
    enabled,
    serverUrl,
    groupsPath: endpointPath(input.groupsPath, DEFAULTS.groupsPath, 'groupsPath'),
    readPath: endpointPath(input.readPath, DEFAULTS.readPath, 'readPath'),
    supervisePath: endpointPath(
      input.supervisePath,
      DEFAULTS.supervisePath,
      'supervisePath'
    ),
    addPath: endpointPath(input.addPath, DEFAULTS.addPath, 'addPath'),
    addJobsPath: endpointPath(input.addJobsPath, DEFAULTS.addJobsPath, 'addJobsPath'),
    readTimeoutMs: positiveInteger(input.readTimeoutMs, DEFAULTS.readTimeoutMs, 'readTimeoutMs'),
    superviseTimeoutMs: positiveInteger(
      input.superviseTimeoutMs,
      DEFAULTS.superviseTimeoutMs,
      'superviseTimeoutMs'
    ),
    addTimeoutMs: positiveInteger(input.addTimeoutMs, DEFAULTS.addTimeoutMs, 'addTimeoutMs'),
    addPollIntervalMs: positiveInteger(input.addPollIntervalMs, DEFAULTS.addPollIntervalMs, 'addPollIntervalMs'),
    maxMemoryChars: positiveInteger(input.maxMemoryChars, DEFAULTS.maxMemoryChars, 'maxMemoryChars'),
    maxMessageChars: positiveInteger(
      input.maxMessageChars,
      DEFAULTS.maxMessageChars,
      'maxMessageChars'
    ),
    maxPendingTracesPerSession: positiveInteger(
      input.maxPendingTracesPerSession,
      DEFAULTS.maxPendingTracesPerSession,
      'maxPendingTracesPerSession'
    ),
    username: String(input.username ?? DEFAULTS.username).trim() || DEFAULTS.username,
    apiToken,
    apiTokenEnv,
    autoCreateGroups,
    groupId,
    // Kept for callers importing the old name; new code and UI use groupId.
    scopeId: groupId,
    scopeNamespace
  })
}

/**
 * Share memory across sessions in the same workspace and agent preset without
 * sending the raw local path to the server. An explicit groupId overrides it.
 */
export function groupIdFor(session, config, { authenticated = false } = {}) {
  if (config.groupId) return config.groupId
  const identity = JSON.stringify({
    cwd: session?.header?.cwd ?? '',
    agentPreset: session?.header?.agentPreset ?? ''
  })
  const digest = createHash('sha256').update(identity).digest('hex')
  if (authenticated) {
    // Account-aware servers accept 3–64 lowercase letters/digits/._-.
    // A colon in the historical anonymous id cannot be created there.
    const prefix = config.scopeNamespace.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 12) || 'dsh'
    return `${prefix}-${digest.slice(0, 48)}`
  }
  return `${config.scopeNamespace}:${digest}`
}

/** @deprecated Use groupIdFor. */
export const scopeIdFor = groupIdFor
