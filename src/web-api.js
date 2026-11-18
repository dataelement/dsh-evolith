export const STATUS_PATH = '/dsh-memory-bridge/status'
export const CONFIG_PATH = '/dsh-memory-bridge/config'

function isLoopback(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function hasForwardedAddress(req) {
  return Boolean(
    req.headers.forwarded ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-host']
  )
}

/** Restrict the optional UI API to the local DSH Web UI. */
export function isTrustedRequest(req, mutation = false) {
  if (!isLoopback(req.socket.remoteAddress) || hasForwardedAddress(req)) return false
  if (!mutation) return true

  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    const destination = new URL('http://' + host)
    if (destination.host !== host || !['127.0.0.1', '[::1]'].includes(destination.hostname)) return false
    // Desktop 0.14 forwards dsh-app://app requests without an Origin header.
    // A custom header requires a browser preflight for cross-origin requests;
    // this API does not grant CORS access. Never bypass a present, foreign Origin.
    if (origin === undefined) {
      return req.headers['x-dsh-memory-request'] === '1' &&
        !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])
    }
    if (typeof origin !== 'string') return false
    const parsed = new URL(origin)
    return parsed.origin === destination.origin && origin === parsed.origin
  } catch {
    return false
  }
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

export async function readJson(req, maxBytes = 12_288) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('Request body is too large.')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('Request body must be valid JSON.')
  }
}

/** Register the same-origin endpoints consumed by the optional browser half. */
export function registerWebApi(ctx, runtime) {
  ctx.inject(['webServer'], (webCtx) => webCtx.effect(() => {
    const disposeStatus = webCtx.webServer.register({
      kind: 'exact',
      path: STATUS_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' })
          return
        }
        if (!isTrustedRequest(req)) {
          sendJson(res, 403, { error: 'Request rejected.' })
          return
        }
        sendJson(res, 200, runtime.snapshot())
      }
    })

    const disposeConfig = webCtx.webServer.register({
      kind: 'exact',
      path: CONFIG_PATH,
      handler: async (req, res) => {
        if (req.method !== 'PUT') {
          sendJson(res, 405, { error: 'Method not allowed.' })
          return
        }
        if (!isTrustedRequest(req, true)) {
          sendJson(res, 403, { error: 'Request rejected.' })
          return
        }
        try {
          const payload = await readJson(req)
          const hasGroupId = Object.prototype.hasOwnProperty.call(payload, 'group_id')
          const hasApiToken = Object.prototype.hasOwnProperty.call(payload, 'api_token')
          const hasServerUrl = Object.prototype.hasOwnProperty.call(payload, 'server_url')
          if (!hasGroupId && !hasApiToken && !hasServerUrl) {
            sendJson(res, 400, { error: 'group_id, api_token, or server_url is required.' })
            return
          }
          if (hasGroupId && typeof payload.group_id !== 'string') {
            sendJson(res, 400, { error: 'group_id must be a string.' })
            return
          }
          if (hasApiToken && typeof payload.api_token !== 'string') {
            sendJson(res, 400, { error: 'api_token must be a string.' })
            return
          }
          if (hasServerUrl && typeof payload.server_url !== 'string') {
            sendJson(res, 400, { error: 'server_url must be a string.' })
            return
          }
          let snapshot
          if (hasGroupId) snapshot = await runtime.setGroupId(payload.group_id)
          if (hasApiToken) snapshot = await runtime.setApiToken(payload.api_token)
          if (hasServerUrl) snapshot = await runtime.setServerUrl(payload.server_url)
          sendJson(res, 200, snapshot)
        } catch (error) {
          sendJson(res, 400, {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })

    return () => {
      disposeStatus()
      disposeConfig()
    }
  }, 'dsh-memory-bridge: optional web UI API'))
}
